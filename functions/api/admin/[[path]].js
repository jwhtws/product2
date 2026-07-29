import { body, clearCookie, clearFailures, createSession, json, rateLimit, recordFailure, requireAdmin, safeEqualText, sessionCookie } from '../../_lib/auth.js';
import { likePattern, listParams, page, positiveId } from '../../_lib/admin-query.js';

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
  month: { format: '%Y-%m', amount: 12, unit: 'month', label: '월별' },
  year: { format: '%Y', amount: 5, unit: 'year', label: '연도별' }
};

function analyticsBuckets(period) {
  const config = ANALYTICS_PERIODS[period];
  const buckets = [];
  const now = new Date();
  for (let offset = config.amount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    if (config.unit === 'day') date.setUTCDate(date.getUTCDate() - offset);
    if (config.unit === 'month') date.setUTCMonth(date.getUTCMonth() - offset, 1);
    if (config.unit === 'year') date.setUTCFullYear(date.getUTCFullYear() - offset, 0, 1);
    buckets.push(config.unit === 'day' ? date.toISOString().slice(0, 10) :
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
      const bucket = period === 'day' ? entry.date : period === 'month' ? entry.date.slice(0, 7) : entry.date.slice(0, 4);
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
