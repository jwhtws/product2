import { body, clearCookie, clearFailures, createSession, json, rateLimit, recordFailure, requireAdmin, safeEqualText, sessionCookie } from '../../_lib/auth.js';
import { likePattern, listParams, page, positiveId, taskRange, weekAnchor } from '../../_lib/admin-query.js';

const memoryCache = new Map();

async function cached(key, ttl, loader) {
  const hit = memoryCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  memoryCache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

async function audit(context, action, detail) {
  await context.env.DB.prepare('INSERT INTO admin_logs (action, detail, created_at) VALUES (?, ?, ?)')
    .bind(action, detail, Date.now()).run();
}

async function githubRepository(context, repository, path, options = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'mukdang-admin',
    'x-github-api-version': '2022-11-28',
    ...(options.headers || {})
  };
  const token = context.env.GITHUB_ACTIONS_TOKEN || context.env.GITHUB_READ_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`https://api.github.com/repos/${repository}${path}`, { ...options, headers });
}

const github = (context, path, options = {}) =>
  githubRepository(context, 'jwhtws/product1', path, options);

async function githubFileJson(context, repository, file) {
  try {
    const response = await githubRepository(context, repository, `/contents/${file}?ref=main`);
    if (!response.ok) return null;
    const data = await response.json();
    const bytes = Uint8Array.from(atob(String(data.content || '').replace(/\s/g, '')), character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function remoteJson(url) {
  try {
    const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) return null;
    const text = await response.text();
    if (!['{', '['].includes(text.trimStart()[0])) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const ANALYTICS_PERIODS = {
  day: { format: '%Y-%m-%d', amount: 30, unit: 'day', label: '일별' },
  week: { format: '%Y-W%W', amount: 12, unit: 'week', label: '주별' },
  month: { format: '%Y-%m', amount: 12, unit: 'month', label: '월별' },
  year: { format: '%Y', amount: 5, unit: 'year', label: '연도별' }
};

function weekBucket(dateValue) {
  const date = typeof dateValue === 'string' ? new Date(`${dateValue}T12:00:00Z`) : dateValue;
  const year = date.getUTCFullYear();
  const januaryFirst = new Date(Date.UTC(year, 0, 1));
  const firstMonday = new Date(januaryFirst);
  firstMonday.setUTCDate(1 + ((8 - januaryFirst.getUTCDay()) % 7));
  const week = date < firstMonday ? 0 : Math.floor((date - firstMonday) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function analyticsBuckets(period) {
  const config = ANALYTICS_PERIODS[period];
  const buckets = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  for (let offset = config.amount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    if (config.unit === 'day') date.setUTCDate(date.getUTCDate() - offset);
    if (config.unit === 'week') date.setUTCDate(date.getUTCDate() - offset * 7);
    if (config.unit === 'month') date.setUTCMonth(date.getUTCMonth() - offset, 1);
    if (config.unit === 'year') date.setUTCFullYear(date.getUTCFullYear() - offset, 0, 1);
    buckets.push(config.unit === 'day' ? date.toISOString().slice(0, 10) :
      config.unit === 'week' ? weekBucket(date) :
      config.unit === 'month' ? date.toISOString().slice(0, 7) : date.toISOString().slice(0, 4));
  }
  return buckets;
}

export async function onRequest(context) {
  const path = Array.isArray(context.params.path) ? context.params.path.join('/') : (context.params.path || '');
  const method = context.request.method;

  if (method === 'POST' && path === 'login') {
    const data = await body(context.request);
    const client = context.request.headers.get('cf-connecting-ip') || 'unknown';
    const attemptKey = `admin-login:${client}`;
    const limit = await rateLimit(context.env, attemptKey, 8);
    if (!limit.allowed) return json({ error: '관리자 로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.', code: 'RATE_LIMITED' }, 429);
    if (!context.env.ADMIN_PASSWORD || !(await safeEqualText(data.code, context.env.ADMIN_PASSWORD))) {
      await recordFailure(context.env, attemptKey);
      return json({ error: '관리자 코드가 올바르지 않습니다.' }, 401);
    }
    await clearFailures(context.env, attemptKey);
    const token = await createSession(context.env.SESSION_SECRET, { admin: true }, 60 * 60 * 12);
    await audit(context, '관리자 로그인', 'Cloudflare 관리 콘솔');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('mukdang_admin', token, 60 * 60 * 12) });
  }
  if (method === 'POST' && path === 'logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie('mukdang_admin') });
  }
  const session = await requireAdmin(context);
  if (!session?.admin) return json({ error: '관리자 로그인이 필요합니다.' }, 401);
  if (method === 'GET' && path === 'session') return json({ authenticated: true });

  if (method === 'GET' && path === 'dashboard') {
    const [members, reviews, recent, saved, activities] = await context.env.DB.batch([
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM users'),
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM reviews'),
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM reviews WHERE created_at >= ?').bind(Date.now() - 7 * 86400000),
      context.env.DB.prepare("SELECT COUNT(*) AS count FROM user_data WHERE data_key = 'saved'"),
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM activity_events WHERE created_at >= ?').bind(Date.now() - 86400000)
    ]);
    return json({ members: members.results[0].count, reviews: reviews.results[0].count, recentReviews: recent.results[0].count, savedUsers: saved.results[0].count, dailyActivities: activities.results[0].count });
  }
  if (method === 'GET' && path === 'members') {
    const { cursor, limit, query } = listParams(context.request);
    const where = [], bindings = [];
    if (cursor) { where.push('id < ?'); bindings.push(cursor); }
    if (query) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"); bindings.push(likePattern(query), likePattern(query)); }
    const result = await context.env.DB.prepare(`SELECT id, email, name, role, status, created_at FROM users
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).bind(...bindings, limit + 1).all();
    const resultPage = page(result.results, limit);
    return json({ members: resultPage.items, page: resultPage.page });
  }
  if (method === 'PATCH' && path.startsWith('members/')) {
    const id = positiveId(path.split('/')[1]), data = await body(context.request);
    if (!id) return json({ error: '올바른 회원 ID가 필요합니다.' }, 400);
    if (data.status && ['active', 'suspended'].includes(data.status)) {
      await context.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(data.status, id).run();
      await audit(context, '회원 상태 변경', `회원 ${id}: ${data.status}`);
    } else if (data.role && ['member', 'admin'].includes(data.role)) {
      await context.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(data.role, id).run();
      await audit(context, '회원 권한 변경', `회원 ${id}: ${data.role}`);
    } else return json({ error: '변경할 값이 없습니다.' }, 400);
    return json({ ok: true });
  }
  if (method === 'DELETE' && path.startsWith('members/')) {
    const id = positiveId(path.split('/')[1]);
    if (!id) return json({ error: '올바른 회원 ID가 필요합니다.' }, 400);
    await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    await audit(context, '회원 삭제', `회원 ${id}`);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'reviews') {
    const { cursor, limit, query } = listParams(context.request);
    const where = [], bindings = [];
    if (cursor) { where.push('reviews.id < ?'); bindings.push(cursor); }
    if (query) {
      where.push("(users.name LIKE ? ESCAPE '\\' OR reviews.restaurant_name LIKE ? ESCAPE '\\' OR reviews.text LIKE ? ESCAPE '\\')");
      const pattern = likePattern(query); bindings.push(pattern, pattern, pattern);
    }
    const result = await context.env.DB.prepare(`SELECT reviews.*, users.name AS author FROM reviews
      JOIN users ON users.id = reviews.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY reviews.id DESC LIMIT ?`).bind(...bindings, limit + 1).all();
    const resultPage = page(result.results, limit);
    return json({ reviews: resultPage.items, page: resultPage.page });
  }
  if (method === 'PATCH' && path.startsWith('reviews/')) {
    const id = positiveId(path.split('/')[1]), data = await body(context.request);
    if (!id) return json({ error: '올바른 리뷰 ID가 필요합니다.' }, 400);
    await context.env.DB.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').bind(data.hidden ? 1 : 0, id).run();
    await audit(context, '리뷰 공개 상태 변경', `리뷰 ${id}: ${data.hidden ? '숨김' : '공개'}`);
    return json({ ok: true });
  }
  if (method === 'DELETE' && path.startsWith('reviews/')) {
    const id = positiveId(path.split('/')[1]);
    if (!id) return json({ error: '올바른 리뷰 ID가 필요합니다.' }, 400);
    await context.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
    await audit(context, '리뷰 삭제', `리뷰 ${id}`);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'logs') {
    const { cursor, limit } = listParams(context.request);
    const result = await context.env.DB.prepare(`SELECT * FROM admin_logs ${cursor ? 'WHERE id < ?' : ''}
      ORDER BY id DESC LIMIT ?`).bind(...(cursor ? [cursor, limit + 1] : [limit + 1])).all();
    const resultPage = page(result.results, limit);
    return json({ logs: resultPage.items, page: resultPage.page });
  }
  if (method === 'GET' && path === 'user-data') {
    const { cursor, limit, query } = listParams(context.request);
    const where = [], bindings = [];
    if (cursor) { where.push('id < ?'); bindings.push(cursor); }
    if (query) { where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"); bindings.push(likePattern(query), likePattern(query)); }
    const users = await context.env.DB.prepare(`SELECT id FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ?`).bind(...bindings, limit + 1).all();
    const userPage = page(users.results, limit);
    if (!userPage.items.length) return json({ rows: [], page: userPage.page });
    const ids = userPage.items.map(item => item.id);
    const result = await context.env.DB.prepare(`SELECT user_data.user_id, user_data.data_key, user_data.data_value,
      user_data.updated_at, users.email, users.name FROM user_data JOIN users ON users.id = user_data.user_id
      WHERE user_data.user_id IN (${ids.map(() => '?').join(',')}) ORDER BY users.id DESC, user_data.updated_at DESC`).bind(...ids).all();
    return json({ rows: result.results.map(item => {
      let value = null;
      try { value = JSON.parse(item.data_value); } catch {}
      return { ...item, data_value: undefined, value };
    }), page: userPage.page });
  }
  if (method === 'GET' && path === 'activities') {
    const { cursor, limit } = listParams(context.request);
    const result = await context.env.DB.prepare(`SELECT activity_events.*, users.email, users.name
      FROM activity_events LEFT JOIN users ON users.id = activity_events.user_id
      ${cursor ? 'WHERE activity_events.id < ?' : ''} ORDER BY activity_events.id DESC LIMIT ?`)
      .bind(...(cursor ? [cursor, limit + 1] : [limit + 1])).all();
    const resultPage = page(result.results, limit);
    return json({ activities: resultPage.items, page: resultPage.page });
  }
  if (method === 'GET' && path === 'analytics') {
    const requested = new URL(context.request.url).searchParams.get('period') || 'day';
    const period = ANALYTICS_PERIODS[requested] ? requested : 'day';
    const config = ANALYTICS_PERIODS[period];
    const buckets = analyticsBuckets(period);
    const cutoff = period === 'day' ? Date.now() - 31 * 86400000 :
      period === 'week' ? Date.now() - 13 * 7 * 86400000 :
        period === 'month' ? Date.now() - 370 * 86400000 : Date.now() - 6 * 366 * 86400000;
    const expression = `strftime('${config.format}', datetime(created_at / 1000, 'unixepoch', '+9 hours'))`;
    const [members, reviews, activities, history] = await Promise.all([
      context.env.DB.prepare(`SELECT ${expression} AS bucket, COUNT(*) AS count FROM users
        WHERE created_at >= ? GROUP BY bucket ORDER BY bucket`).bind(cutoff).all(),
      context.env.DB.prepare(`SELECT ${expression} AS bucket, COUNT(*) AS count FROM reviews
        WHERE created_at >= ? GROUP BY bucket ORDER BY bucket`).bind(cutoff).all(),
      context.env.DB.prepare(`SELECT ${expression} AS bucket, COUNT(*) AS count FROM activity_events
        WHERE created_at >= ? GROUP BY bucket ORDER BY bucket`).bind(cutoff).all(),
      cached('restaurant-history', 60_000,
        () => githubFileJson(context, 'jwhtws/product2', 'data/restaurant-change-history.json'))
    ]);
    const maps = [members, reviews, activities].map(result =>
      new Map(result.results.map(item => [item.bucket, Number(item.count)])));
    const restaurantAdded = new Map(), restaurantRemoved = new Map();
    for (const entry of history?.entries || []) {
      const bucket = period === 'day' ? entry.date : period === 'week' ? weekBucket(entry.date) :
        period === 'month' ? entry.date.slice(0, 7) : entry.date.slice(0, 4);
      restaurantAdded.set(bucket, (restaurantAdded.get(bucket) || 0) + Number(entry.addedCount || 0));
      restaurantRemoved.set(bucket, (restaurantRemoved.get(bucket) || 0) + Number(entry.removedCount || 0));
    }
    return json({
      period,
      label: config.label,
      points: buckets.map((bucket, index) => ({
        bucket,
        members: maps[0].get(bucket) || 0,
        reviews: maps[1].get(bucket) || 0,
        activities: maps[2].get(bucket) || 0,
        restaurantAdded: restaurantAdded.get(bucket) || 0,
        restaurantRemoved: restaurantRemoved.get(bucket) || 0
      }))
    });
  }
  if (method === 'GET' && path === 'search-rankings') {
    const url = new URL(context.request.url);
    const period = url.searchParams.get('period') || 'day';
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const anchor = url.searchParams.get('anchor') ||
      (period === 'day' ? today : period === 'week' ? weekAnchor(today) :
        period === 'month' ? today.slice(0, 7) : today.slice(0, 4));
    const range = taskRange(period, anchor);
    if (!range) return json({ error: '올바른 검색 순위 조회 기간이 필요합니다.' }, 400);

    const start = Date.parse(`${range.start}T00:00:00+09:00`);
    const end = Date.parse(`${range.end}T00:00:00+09:00`);
    const previousDate = new Date(`${range.start}T00:00:00Z`);
    if (period === 'day') previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    if (period === 'week') previousDate.setUTCDate(previousDate.getUTCDate() - 7);
    if (period === 'month') previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    if (period === 'year') previousDate.setUTCFullYear(previousDate.getUTCFullYear() - 1);
    const previousAnchor = period === 'day' ? previousDate.toISOString().slice(0, 10) :
      period === 'week' ? weekAnchor(previousDate.toISOString().slice(0, 10)) :
      period === 'month' ? previousDate.toISOString().slice(0, 7) : previousDate.toISOString().slice(0, 4);
    const previousRange = taskRange(period, previousAnchor);
    const previousStart = Date.parse(`${previousRange.start}T00:00:00+09:00`);
    const trendExpression = period === 'day'
      ? "strftime('%H:00', datetime(created_at / 1000, 'unixepoch', '+9 hours'))"
      : period === 'week' || period === 'month'
        ? "strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', '+9 hours'))"
        : "strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch', '+9 hours'))";
    const searchWhere = "event_type = 'search' AND TRIM(detail) != ''";
    const [ranking, summary, previous, trend] = await Promise.all([
      context.env.DB.prepare(`SELECT TRIM(detail) AS term, COUNT(*) AS searches,
        COUNT(DISTINCT user_id) AS members, MAX(created_at) AS last_searched_at
        FROM activity_events WHERE ${searchWhere} AND created_at >= ? AND created_at < ?
        GROUP BY TRIM(detail) COLLATE NOCASE
        ORDER BY searches DESC, last_searched_at DESC, term ASC LIMIT 50`).bind(start, end).all(),
      context.env.DB.prepare(`SELECT COUNT(*) AS searches, COUNT(DISTINCT TRIM(detail) COLLATE NOCASE) AS terms,
        COUNT(DISTINCT user_id) AS members FROM activity_events
        WHERE ${searchWhere} AND created_at >= ? AND created_at < ?`).bind(start, end).first(),
      context.env.DB.prepare(`SELECT COUNT(*) AS searches FROM activity_events
        WHERE ${searchWhere} AND created_at >= ? AND created_at < ?`).bind(previousStart, start).first(),
      context.env.DB.prepare(`SELECT ${trendExpression} AS bucket, COUNT(*) AS searches,
        COUNT(DISTINCT TRIM(detail) COLLATE NOCASE) AS terms FROM activity_events
        WHERE ${searchWhere} AND created_at >= ? AND created_at < ?
        GROUP BY bucket ORDER BY bucket`).bind(start, end).all()
    ]);
    return json({
      period,
      anchor,
      range,
      summary: {
        searches: Number(summary?.searches || 0),
        terms: Number(summary?.terms || 0),
        members: Number(summary?.members || 0),
        previousSearches: Number(previous?.searches || 0)
      },
      ranking: ranking.results.map((item, index) => ({
        rank: index + 1,
        term: item.term,
        searches: Number(item.searches),
        members: Number(item.members),
        lastSearchedAt: Number(item.last_searched_at)
      })),
      trend: trend.results.map(item => ({
        bucket: item.bucket,
        searches: Number(item.searches),
        terms: Number(item.terms)
      }))
    });
  }
  if (method === 'GET' && path === 'user-analytics') {
    const url = new URL(context.request.url);
    const period = url.searchParams.get('period') || 'day';
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const anchor = url.searchParams.get('anchor') ||
      (period === 'day' ? today : period === 'week' ? weekAnchor(today) :
        period === 'month' ? today.slice(0, 7) : today.slice(0, 4));
    const range = taskRange(period, anchor);
    if (!range) return json({ error: '올바른 사용자 행동 조회 기간이 필요합니다.' }, 400);
    const start = Date.parse(`${range.start}T00:00:00+09:00`);
    const end = Date.parse(`${range.end}T00:00:00+09:00`);
    const bucketExpression = period === 'day'
      ? "strftime('%H:00', datetime(created_at / 1000, 'unixepoch', '+9 hours'))"
      : period === 'week' || period === 'month'
        ? "strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', '+9 hours'))"
        : "strftime('%Y-%m', datetime(created_at / 1000, 'unixepoch', '+9 hours'))";
    const [activitySummary, reviewSummary, activeMembers, activityTrend, reviewTrend, userActivity, userReviews] = await Promise.all([
      context.env.DB.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS searches,
        SUM(CASE WHEN event_type = 'save' THEN 1 ELSE 0 END) AS saves,
        SUM(CASE WHEN event_type = 'list' THEN 1 ELSE 0 END) AS lists,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS anonymous
        FROM activity_events WHERE created_at >= ? AND created_at < ?`).bind(start, end).first(),
      context.env.DB.prepare(`SELECT COUNT(*) AS reviews, COUNT(DISTINCT user_id) AS reviewers
        FROM reviews WHERE created_at >= ? AND created_at < ?`).bind(start, end).first(),
      context.env.DB.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT user_id FROM activity_events WHERE user_id IS NOT NULL AND created_at >= ? AND created_at < ?
        UNION SELECT user_id FROM reviews WHERE created_at >= ? AND created_at < ?
      )`).bind(start, end, start, end).first(),
      context.env.DB.prepare(`SELECT ${bucketExpression} AS bucket, COUNT(*) AS activities,
        SUM(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS searches,
        SUM(CASE WHEN event_type = 'save' THEN 1 ELSE 0 END) AS saves,
        SUM(CASE WHEN event_type = 'list' THEN 1 ELSE 0 END) AS lists
        FROM activity_events WHERE created_at >= ? AND created_at < ?
        GROUP BY bucket ORDER BY bucket`).bind(start, end).all(),
      context.env.DB.prepare(`SELECT ${bucketExpression} AS bucket, COUNT(*) AS reviews
        FROM reviews WHERE created_at >= ? AND created_at < ?
        GROUP BY bucket ORDER BY bucket`).bind(start, end).all(),
      context.env.DB.prepare(`SELECT users.id, users.name, users.email, COUNT(*) AS activities,
        SUM(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) AS searches,
        SUM(CASE WHEN event_type = 'save' THEN 1 ELSE 0 END) AS saves,
        SUM(CASE WHEN event_type = 'list' THEN 1 ELSE 0 END) AS lists,
        MAX(activity_events.created_at) AS last_active_at
        FROM activity_events JOIN users ON users.id = activity_events.user_id
        WHERE activity_events.created_at >= ? AND activity_events.created_at < ?
        GROUP BY users.id ORDER BY activities DESC LIMIT 50`).bind(start, end).all(),
      context.env.DB.prepare(`SELECT reviews.user_id, users.name, users.email, COUNT(*) AS reviews,
        MAX(reviews.created_at) AS last_review_at FROM reviews
        JOIN users ON users.id = reviews.user_id
        WHERE reviews.created_at >= ? AND reviews.created_at < ?
        GROUP BY reviews.user_id`).bind(start, end).all()
    ]);
    const reviewByUser = new Map(userReviews.results.map(item => [Number(item.user_id), item]));
    const userRows = new Map(userActivity.results.map(item => [Number(item.id), {
      id: Number(item.id), name: item.name, email: item.email,
      activities: Number(item.activities), searches: Number(item.searches),
      saves: Number(item.saves), lists: Number(item.lists),
      reviews: Number(reviewByUser.get(Number(item.id))?.reviews || 0),
      lastActiveAt: Math.max(Number(item.last_active_at || 0), Number(reviewByUser.get(Number(item.id))?.last_review_at || 0))
    }]));
    for (const item of userReviews.results) {
      const id = Number(item.user_id);
      if (userRows.has(id)) continue;
      userRows.set(id, {
        id, name: item.name, email: item.email, activities: 0, searches: 0, saves: 0, lists: 0,
        reviews: Number(item.reviews), lastActiveAt: Number(item.last_review_at)
      });
    }
    const trend = new Map();
    for (const item of activityTrend.results) trend.set(item.bucket, {
      bucket: item.bucket, activities: Number(item.activities), searches: Number(item.searches),
      saves: Number(item.saves), lists: Number(item.lists), reviews: 0
    });
    for (const item of reviewTrend.results) {
      const point = trend.get(item.bucket) || { bucket: item.bucket, activities: 0, searches: 0, saves: 0, lists: 0, reviews: 0 };
      point.reviews = Number(item.reviews);
      trend.set(item.bucket, point);
    }
    return json({
      period, anchor, range,
      summary: {
        activities: Number(activitySummary?.total || 0),
        searches: Number(activitySummary?.searches || 0),
        saves: Number(activitySummary?.saves || 0),
        lists: Number(activitySummary?.lists || 0),
        anonymous: Number(activitySummary?.anonymous || 0),
        reviews: Number(reviewSummary?.reviews || 0),
        reviewers: Number(reviewSummary?.reviewers || 0),
        activeMembers: Number(activeMembers?.count || 0),
        dwellTracking: false
      },
      trend: [...trend.values()].sort((left, right) => left.bucket.localeCompare(right.bucket)),
      users: [...userRows.values()].sort((left, right) =>
        (right.activities + right.reviews) - (left.activities + left.reviews) || right.lastActiveAt - left.lastActiveAt).slice(0, 50)
    });
  }
  if (method === 'GET' && path === 'tasks') {
    const url = new URL(context.request.url);
    const period = url.searchParams.get('period') || 'day';
    const anchor = url.searchParams.get('anchor') || new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const range = taskRange(period, anchor);
    if (!range) return json({ error: '올바른 조회 기간이 필요합니다.' }, 400);
    const result = await context.env.DB.prepare(`SELECT id, title, memo, due_date, status, priority, created_at, updated_at
      FROM admin_tasks WHERE due_date >= ? AND due_date < ?
      ORDER BY due_date ASC, status ASC, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id DESC
      LIMIT 1000`).bind(range.start, range.end).all();
    return json({ period, anchor, range, tasks: result.results });
  }
  if (method === 'POST' && path === 'tasks') {
    const data = await body(context.request);
    const title = String(data.title || '').trim().slice(0, 100);
    const memo = String(data.memo || '').trim().slice(0, 2000);
    const dueDate = String(data.dueDate || '');
    const priority = ['low', 'normal', 'high'].includes(data.priority) ? data.priority : 'normal';
    if (!title || !taskRange('day', dueDate)) return json({ error: '제목과 올바른 날짜가 필요합니다.' }, 400);
    const now = Date.now();
    const result = await context.env.DB.prepare(`INSERT INTO admin_tasks
      (title, memo, due_date, status, priority, created_at, updated_at) VALUES (?, ?, ?, 'todo', ?, ?, ?)`)
      .bind(title, memo, dueDate, priority, now, now).run();
    await audit(context, '해야 할 일 등록', `${dueDate}: ${title}`);
    return json({ ok: true, id: result.meta.last_row_id }, 201);
  }
  if (method === 'PATCH' && path.startsWith('tasks/')) {
    const id = positiveId(path.split('/')[1]);
    if (!id) return json({ error: '올바른 할 일 ID가 필요합니다.' }, 400);
    const current = await context.env.DB.prepare('SELECT * FROM admin_tasks WHERE id = ?').bind(id).first();
    if (!current) return json({ error: '해야 할 일을 찾을 수 없습니다.' }, 404);
    const data = await body(context.request);
    const title = data.title == null ? current.title : String(data.title).trim().slice(0, 100);
    const memo = data.memo == null ? current.memo : String(data.memo).trim().slice(0, 2000);
    const dueDate = data.dueDate == null ? current.due_date : String(data.dueDate);
    const status = data.status == null ? current.status : data.status;
    const priority = data.priority == null ? current.priority : data.priority;
    if (!title || !taskRange('day', dueDate) || !['todo', 'done'].includes(status) || !['low', 'normal', 'high'].includes(priority)) {
      return json({ error: '변경할 값이 올바르지 않습니다.' }, 400);
    }
    await context.env.DB.prepare(`UPDATE admin_tasks SET title = ?, memo = ?, due_date = ?, status = ?,
      priority = ?, updated_at = ? WHERE id = ?`).bind(title, memo, dueDate, status, priority, Date.now(), id).run();
    await audit(context, '해야 할 일 변경', `항목 ${id}: ${status}`);
    return json({ ok: true });
  }
  if (method === 'DELETE' && path.startsWith('tasks/')) {
    const id = positiveId(path.split('/')[1]);
    if (!id) return json({ error: '올바른 할 일 ID가 필요합니다.' }, 400);
    await context.env.DB.prepare('DELETE FROM admin_tasks WHERE id = ?').bind(id).run();
    await audit(context, '해야 할 일 삭제', `항목 ${id}`);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'restaurant-sync') {
    const { runs, manifest, validation, refresh, history } = await cached('restaurant-sync', 60_000, async () => {
      const [runsResponse, manifest, validation, refresh, history] = await Promise.all([
        github(context, '/actions/workflows/restaurant-data-validation.yml/runs?per_page=5'),
        remoteJson('https://product1-84t.pages.dev/data/restaurants/regions.json'),
        remoteJson('https://product1-84t.pages.dev/data/restaurants/validation-report.json'),
        remoteJson('https://product1-84t.pages.dev/data/restaurants/refresh-report.json'),
        githubFileJson(context, 'jwhtws/product2', 'data/restaurant-change-history.json')
      ]);
      const runs = runsResponse.ok ? (await runsResponse.json()).workflow_runs || [] : [];
      return { runs, manifest, validation, refresh, history };
    });
    return json({
      schedule: { enabled: true, cron: '0 15 * * *', label: '매일 00:00 (한국시간)' },
      canRun: Boolean(context.env.GITHUB_ACTIONS_TOKEN),
      latest: runs[0] ? {
        id: runs[0].id,
        status: runs[0].status,
        conclusion: runs[0].conclusion,
        event: runs[0].event,
        startedAt: runs[0].run_started_at,
        updatedAt: runs[0].updated_at,
        url: runs[0].html_url
      } : null,
      recent: runs.slice(0, 5).map(run => ({
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        event: run.event,
        startedAt: run.run_started_at,
        url: run.html_url
      })),
      manifest,
      validation: validation ? {
        ok: validation.ok,
        checkedAt: validation.checkedAt,
        sourceUpdatedAt: validation.sourceUpdatedAt,
        stats: validation.stats,
        errorCount: validation.errors?.length || 0,
        warningCount: validation.warnings?.length || 0
      } : null,
      refresh,
      history: history ? {
        updatedAt: history.updatedAt,
        entries: (history.entries || []).map(({ added, removed, ...entry }) => entry)
      } : null
    });
  }
  if (method === 'GET' && path.startsWith('restaurant-sync/history/')) {
    const date = decodeURIComponent(path.slice('restaurant-sync/history/'.length));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: '올바른 날짜가 필요합니다.' }, 400);
    const history = await cached('restaurant-history', 60_000,
      () => githubFileJson(context, 'jwhtws/product2', 'data/restaurant-change-history.json'));
    const entry = history?.entries?.find(item => item.date === date);
    return entry ? json({ entry }) : json({ error: '해당 날짜의 변경 이력이 없습니다.' }, 404);
  }
  if (method === 'POST' && path === 'restaurant-sync/run') {
    if (!context.env.GITHUB_ACTIONS_TOKEN) return json({ error: 'GitHub 실행 토큰이 설정되지 않았습니다.' }, 503);
    const runsResponse = await github(context, '/actions/workflows/restaurant-data-validation.yml/runs?per_page=1');
    const runs = runsResponse.ok ? (await runsResponse.json()).workflow_runs || [] : [];
    if (runs[0] && ['queued', 'in_progress', 'waiting', 'pending'].includes(runs[0].status)) {
      return json({ error: '식당 데이터 갱신이 이미 실행 중입니다.' }, 409);
    }
    const response = await github(context, '/actions/workflows/restaurant-data-validation.yml/dispatches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main' })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return json({ error: error.message || 'GitHub 갱신 작업을 시작하지 못했습니다.' }, response.status);
    }
    await audit(context, '식당 데이터 수동 갱신', 'GitHub Actions workflow_dispatch');
    return json({ ok: true }, 202);
  }
  return json({ error: 'Not found' }, 404);
}
