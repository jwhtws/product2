(function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  const safeExternalUrl = value => {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const adminViews = new Set(['dashboard', 'tasks', 'analytics', 'searchrankings', 'useranalytics', 'members', 'reviews', 'reviewsettings', 'userdata', 'activities', 'restaurants', 'foodpopups', 'foodpopupsources', 'logs']);
  const historyStateKey = 'mukdangAdminView';
  let currentView = adminViews.has(history.state?.[historyStateKey]) ? history.state[historyStateKey] : 'dashboard';
  let historyReady = false;
  let restaurantMeta = { total: 0, updatedAt: null, regions: [] };
  let validationReport = null;

  async function api(path, options = {}) {
    const response = await fetch(`/api/admin/${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || '서버 요청에 실패했습니다.'), { status: response.status });
    return data;
  }

  function toast(message) {
    const element = $('#admin-toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
  }

  const heading = (overline, title, description, toolbar = '') =>
    `<div class="page-head"><div><p class="overline">${overline}</p><h1>${title}</h1></div><div><p>${description}</p>${toolbar}</div></div>`;
  const listPath = (path, query = '', cursor = null) => {
    const params = new URLSearchParams({ limit: '50' });
    if (query) params.set('q', query);
    if (cursor) params.set('cursor', cursor);
    return `${path}?${params}`;
  };
  const nextPage = page => page?.hasMore ? `<div class="pagination"><button class="small-button" data-next-cursor="${page.nextCursor}">다음 50개</button></div>` : '';
  const reviewTabs = active => `<div class="period-tabs">
    <button class="${active === 'reviews' ? 'active' : ''}" data-review-view="reviews">리뷰 목록</button>
    <button class="${active === 'reviewsettings' ? 'active' : ''}" data-review-view="reviewsettings">리뷰 제한 설정</button>
  </div>`;
  const bindReviewTabs = () => $$('[data-review-view]').forEach(button =>
    button.addEventListener('click', () => navigate(button.dataset.reviewView)));

  function loading() {
    $('#admin-content').innerHTML = '<div class="empty-admin">서버 데이터를 불러오는 중입니다.</div>';
  }

  async function renderDashboard() {
    loading();
    const data = await api('dashboard');
    $('#admin-content').innerHTML = `${heading('OVERVIEW', '운영 대시보드', 'Cloudflare 서버의 현재 상태를 확인합니다.')}
      <div class="metrics">
        <article class="metric"><span>전체 회원</span><strong>${data.members.toLocaleString('ko-KR')}</strong><small>D1 계정 기준</small></article>
        <article class="metric"><span>등록 리뷰</span><strong>${data.reviews.toLocaleString('ko-KR')}</strong><small>최근 7일 +${data.recentReviews}</small></article>
        <article class="metric"><span>오늘 활동</span><strong>${data.dailyActivities.toLocaleString('ko-KR')}</strong><small>검색·저장·리스트</small></article>
        <article class="metric"><span>식당 데이터</span><strong>${restaurantMeta.total.toLocaleString('ko-KR')}</strong><small>${restaurantMeta.regions.length}개 지역</small></article>
      </div>
      <div class="dashboard-grid">
        <article class="panel"><h2>서버 연결</h2><div class="health-list">
          <div class="health-item"><span>Cloudflare Pages Functions</span><b class="status">정상</b></div>
          <div class="health-item"><span>D1 데이터베이스</span><b class="status">정상</b></div>
          <div class="health-item"><span>관리자 쿠키</span><b class="status">보호됨</b></div>
          <div class="health-item"><span>저장 데이터 회원</span><b>${data.savedUsers.toLocaleString('ko-KR')}명</b></div>
        </div></article>
        <article class="panel"><h2>데이터 상태</h2><div class="health-list">
          <div class="health-item"><span>식당 원본 데이터</span><b class="status">정상</b></div>
          <div class="health-item"><span>최근 데이터 갱신</span><b>${restaurantMeta.updatedAt ? new Date(restaurantMeta.updatedAt).toLocaleDateString('ko-KR') : '확인 중'}</b></div>
        </div></article>
      </div>`;
  }

  const todayKst = () => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const weekAnchorKst = dateValue => {
    const date = new Date(`${dateValue}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const year = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  };

  async function renderTasks(period = 'day', anchor = null) {
    const today = todayKst();
    anchor ||= period === 'day' ? today : period === 'week' ? weekAnchorKst(today) :
      period === 'month' ? today.slice(0, 7) : today.slice(0, 4);
    loading();
    const data = await api(`tasks?period=${encodeURIComponent(period)}&anchor=${encodeURIComponent(anchor)}`);
    const groups = new Map();
    data.tasks.forEach(task => {
      if (!groups.has(task.due_date)) groups.set(task.due_date, []);
      groups.get(task.due_date).push(task);
    });
    const dueDate = data.range.start;
    const periodButtons = `<div class="period-tabs">${[['day', '일별'], ['week', '주별'], ['month', '월별'], ['year', '연도별']].map(([value, label]) =>
      `<button class="${period === value ? 'active' : ''}" data-task-period="${value}">${label}</button>`).join('')}</div>`;
    const anchorInput = period === 'year'
      ? `<input id="task-anchor" type="number" min="2020" max="2100" value="${escapeHtml(anchor)}" aria-label="조회 연도">`
      : `<input id="task-anchor" type="${period === 'day' ? 'date' : period === 'week' ? 'week' : 'month'}" value="${escapeHtml(anchor)}" aria-label="조회 기간">`;
    $('#admin-content').innerHTML = `${heading('PLANNER', '해야 할 일', '업무와 메모를 일·주·월·연도별로 정리합니다.', `${periodButtons}<div class="task-anchor">${anchorInput}</div>`)}
      <article class="panel task-compose"><h2>새 할 일</h2><form id="task-form">
        <input name="title" maxlength="100" required placeholder="해야 할 일 제목">
        <textarea name="memo" maxlength="2000" placeholder="메모와 세부 내용을 입력하세요"></textarea>
        <div><label>날짜<input name="dueDate" type="date" value="${escapeHtml(dueDate)}" required></label><label>우선순위<select name="priority"><option value="normal">보통</option><option value="high">높음</option><option value="low">낮음</option></select></label><button type="submit">등록</button></div>
      </form></article>
      <div class="task-groups">${groups.size ? [...groups].map(([date, tasks]) => `<section class="panel task-day"><h2>${escapeHtml(date)} <small>${tasks.filter(task => task.status === 'done').length}/${tasks.length} 완료</small></h2><div class="task-list">${tasks.map(task =>
        `<article class="task-item ${task.status === 'done' ? 'done' : ''}"><button class="task-check" data-task-toggle="${task.id}" data-status="${task.status}" aria-label="완료 상태 변경">${task.status === 'done' ? '✓' : ''}</button><div><div class="task-title"><strong>${escapeHtml(task.title)}</strong><span class="priority ${task.priority}">${task.priority === 'high' ? '높음' : task.priority === 'low' ? '낮음' : '보통'}</span></div>${task.memo ? `<p>${escapeHtml(task.memo)}</p>` : ''}</div><div class="row-actions"><button class="small-button" data-task-edit="${task.id}">수정</button><button class="small-button danger" data-task-delete="${task.id}">삭제</button></div></article>`
      ).join('')}</div></section>`).join('') : '<div class="empty-admin panel">이 기간에 등록된 할 일이 없습니다.</div>'}</div>`;
    $$('[data-task-period]').forEach(button => button.addEventListener('click', () => renderTasks(button.dataset.taskPeriod)));
    $('#task-anchor').addEventListener('change', event => renderTasks(period, event.target.value));
    $('#task-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await api('tasks', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      toast('해야 할 일을 등록했습니다.');
      renderTasks(period, anchor);
    });
    $$('[data-task-toggle]').forEach(button => button.addEventListener('click', async () => {
      await api(`tasks/${button.dataset.taskToggle}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status === 'done' ? 'todo' : 'done' }) });
      renderTasks(period, anchor);
    }));
    $$('[data-task-edit]').forEach(button => button.addEventListener('click', async () => {
      const item = button.closest('.task-item');
      const title = prompt('제목을 수정하세요.', item.querySelector('strong').textContent);
      if (title == null) return;
      const memo = prompt('메모를 수정하세요.', item.querySelector('p')?.textContent || '');
      if (memo == null) return;
      await api(`tasks/${button.dataset.taskEdit}`, { method: 'PATCH', body: JSON.stringify({ title, memo }) });
      toast('해야 할 일을 수정했습니다.');
      renderTasks(period, anchor);
    }));
    $$('[data-task-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('이 해야 할 일을 삭제할까요?')) return;
      await api(`tasks/${button.dataset.taskDelete}`, { method: 'DELETE' });
      toast('해야 할 일을 삭제했습니다.');
      renderTasks(period, anchor);
    }));
  }

  function lineChart(points, series) {
    const width = 900, height = 260, left = 48, right = 18, top = 22, bottom = 42;
    const chartWidth = width - left - right, chartHeight = height - top - bottom;
    const maximum = Math.max(1, ...points.flatMap(point => series.map(item => Number(point[item.key] || 0))));
    const x = index => left + (points.length < 2 ? chartWidth / 2 : index * chartWidth / (points.length - 1));
    const y = value => top + chartHeight - (Number(value || 0) / maximum * chartHeight);
    const labelEvery = Math.max(1, Math.ceil(points.length / 8));
    return `<div class="chart-shell"><svg class="analytics-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="기간별 데이터 그래프">
      ${[0, .25, .5, .75, 1].map(ratio => `<line x1="${left}" y1="${top + chartHeight * ratio}" x2="${width - right}" y2="${top + chartHeight * ratio}" class="chart-grid"/><text x="${left - 8}" y="${top + chartHeight * ratio + 4}" text-anchor="end">${Math.round(maximum * (1 - ratio)).toLocaleString('ko-KR')}</text>`).join('')}
      ${series.map(item => `<polyline points="${points.map((point, index) => `${x(index)},${y(point[item.key])}`).join(' ')}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      ${points.map((point, index) => index % labelEvery === 0 || index === points.length - 1 ? `<text x="${x(index)}" y="${height - 13}" text-anchor="middle">${escapeHtml(point.bucket)}</text>` : '').join('')}
    </svg><div class="chart-legend">${series.map(item => `<span><i style="background:${item.color}"></i>${item.label}</span>`).join('')}</div></div>`;
  }

  async function renderAnalytics(period = 'day') {
    loading();
    const data = await api(`analytics?period=${encodeURIComponent(period)}`);
    const totals = data.points.reduce((result, point) => ({
      members: result.members + point.members,
      reviews: result.reviews + point.reviews,
      activities: result.activities + point.activities,
      restaurantAdded: result.restaurantAdded + point.restaurantAdded,
      restaurantRemoved: result.restaurantRemoved + point.restaurantRemoved
    }), { members: 0, reviews: 0, activities: 0, restaurantAdded: 0, restaurantRemoved: 0 });
    const periodButtons = `<div class="period-tabs">${[['day', '일별'], ['week', '주별'], ['month', '월별'], ['year', '연도별']].map(([value, label]) =>
      `<button class="${period === value ? 'active' : ''}" data-period="${value}">${label}</button>`).join('')}</div>`;
    $('#admin-content').innerHTML = `${heading('ANALYTICS', '데이터 분석', '회원, 리뷰, 활동과 식당 변화를 기간별로 확인합니다.', periodButtons)}
      <div class="metrics">
        <article class="metric"><span>신규 회원</span><strong>${totals.members.toLocaleString('ko-KR')}</strong><small>${data.label} 조회 기간 합계</small></article>
        <article class="metric"><span>등록 리뷰</span><strong>${totals.reviews.toLocaleString('ko-KR')}</strong><small>${data.label} 조회 기간 합계</small></article>
        <article class="metric"><span>사용자 활동</span><strong>${totals.activities.toLocaleString('ko-KR')}</strong><small>검색·저장·리스트</small></article>
        <article class="metric"><span>식당 순변동</span><strong>${(totals.restaurantAdded - totals.restaurantRemoved).toLocaleString('ko-KR')}</strong><small>추가 ${totals.restaurantAdded.toLocaleString('ko-KR')} · 제거 ${totals.restaurantRemoved.toLocaleString('ko-KR')}</small></article>
      </div>
      <article class="panel analytics-panel"><h2>이용자 데이터 추이</h2>${lineChart(data.points, [
        { key: 'members', label: '신규 회원', color: '#247a52' },
        { key: 'reviews', label: '리뷰', color: '#f05a2a' },
        { key: 'activities', label: '사용자 활동', color: '#5a62d6' }
      ])}</article>
      <article class="panel analytics-panel"><h2>식당 개업·폐업 추이</h2>${lineChart(data.points, [
        { key: 'restaurantAdded', label: '추가 식당', color: '#247a52' },
        { key: 'restaurantRemoved', label: '제거 식당', color: '#c64235' }
      ])}</article>
      <article class="panel analytics-panel"><h2>기간별 정확한 수치</h2><div class="table-wrap"><table><thead><tr><th>기간</th><th>신규 회원</th><th>리뷰</th><th>활동</th><th>식당 추가</th><th>식당 제거</th></tr></thead><tbody>${data.points.map(point =>
        `<tr><td><strong>${escapeHtml(point.bucket)}</strong></td><td>${point.members.toLocaleString('ko-KR')}</td><td>${point.reviews.toLocaleString('ko-KR')}</td><td>${point.activities.toLocaleString('ko-KR')}</td><td>${point.restaurantAdded.toLocaleString('ko-KR')}</td><td>${point.restaurantRemoved.toLocaleString('ko-KR')}</td></tr>`).join('')}</tbody></table></div></article>`;
    $$('[data-period]').forEach(button => button.addEventListener('click', () => renderAnalytics(button.dataset.period)));
  }

  async function renderSearchRankings(period = 'day', anchor = null) {
    const today = todayKst();
    anchor ||= period === 'day' ? today : period === 'week' ? weekAnchorKst(today) :
      period === 'month' ? today.slice(0, 7) : today.slice(0, 4);
    loading();
    const data = await api(`search-rankings?period=${encodeURIComponent(period)}&anchor=${encodeURIComponent(anchor)}`);
    const maximum = Math.max(1, ...data.ranking.map(item => item.searches));
    const difference = data.summary.searches - data.summary.previousSearches;
    const change = data.summary.previousSearches
      ? Math.round(difference / data.summary.previousSearches * 100)
      : data.summary.searches ? 100 : 0;
    const periodButtons = `<div class="period-tabs">${[['day', '일별'], ['week', '주별'], ['month', '월별'], ['year', '연도별']].map(([value, label]) =>
      `<button class="${period === value ? 'active' : ''}" data-ranking-period="${value}">${label}</button>`).join('')}</div>`;
    const anchorInput = period === 'year'
      ? `<input id="ranking-anchor" type="number" min="2020" max="2100" value="${escapeHtml(anchor)}" aria-label="검색 순위 조회 연도">`
      : `<input id="ranking-anchor" type="${period === 'day' ? 'date' : period === 'week' ? 'week' : 'month'}" value="${escapeHtml(anchor)}" aria-label="검색 순위 조회 기간">`;
    const topRanking = data.ranking.slice(0, 10);
    $('#admin-content').innerHTML = `${heading('SEARCH RANKING', '검색 순위 관리', '식당 검색어를 일·주·월·연도별로 집계하고 순위를 확인합니다.',
      `${periodButtons}<div class="task-anchor">${anchorInput}</div>`)}
      <div class="metrics">
        <article class="metric"><span>전체 검색</span><strong>${data.summary.searches.toLocaleString('ko-KR')}</strong><small>선택 기간 검색 횟수</small></article>
        <article class="metric"><span>검색어 종류</span><strong>${data.summary.terms.toLocaleString('ko-KR')}</strong><small>중복 제외 검색어</small></article>
        <article class="metric"><span>회원 검색자</span><strong>${data.summary.members.toLocaleString('ko-KR')}</strong><small>로그인 회원 기준</small></article>
        <article class="metric"><span>이전 기간 대비</span><strong>${difference > 0 ? '+' : ''}${difference.toLocaleString('ko-KR')}</strong><small class="${difference < 0 ? 'metric-danger' : ''}">${change > 0 ? '+' : ''}${change}%</small></article>
      </div>
      <article class="panel search-ranking-panel"><h2>상위 검색어 <small>TOP 10</small></h2>
        ${topRanking.length ? `<div class="ranking-bars">${topRanking.map(item => `<div class="ranking-bar">
          <b>${item.rank}</b><strong title="${escapeHtml(item.term)}">${escapeHtml(item.term)}</strong>
          <div><i style="width:${Math.max(3, item.searches / maximum * 100)}%"></i></div>
          <span>${item.searches.toLocaleString('ko-KR')}회</span>
        </div>`).join('')}</div>` : '<div class="empty-admin">선택한 기간에 검색 기록이 없습니다.</div>'}
      </article>
      <article class="panel analytics-panel"><h2>검색 추이</h2>${data.trend.length ? lineChart(data.trend, [
        { key: 'searches', label: '검색 횟수', color: '#f05a2a' },
        { key: 'terms', label: '검색어 종류', color: '#5a62d6' }
      ]) : '<div class="empty-admin">표시할 검색 추이가 없습니다.</div>'}</article>
      <article class="panel analytics-panel"><h2>전체 검색 순위 <small>상위 50개</small></h2>
        <div class="table-wrap">${data.ranking.length ? `<table><thead><tr><th>순위</th><th>검색어·식당명</th><th>검색 횟수</th><th>회원 검색자</th><th>점유율</th><th>최근 검색</th></tr></thead><tbody>${data.ranking.map(item =>
          `<tr><td><span class="rank-number ${item.rank <= 3 ? 'top' : ''}">${item.rank}</span></td><td><strong>${escapeHtml(item.term)}</strong></td><td>${item.searches.toLocaleString('ko-KR')}회</td><td>${item.members.toLocaleString('ko-KR')}명</td><td>${data.summary.searches ? (item.searches / data.summary.searches * 100).toFixed(1) : '0.0'}%</td><td>${new Date(item.lastSearchedAt).toLocaleString('ko-KR')}</td></tr>`
        ).join('')}</tbody></table>` : '<div class="empty-admin">검색 기록이 없습니다.</div>'}</div>
      </article>`;
    $$('[data-ranking-period]').forEach(button => button.addEventListener('click', () => renderSearchRankings(button.dataset.rankingPeriod)));
    $('#ranking-anchor').addEventListener('change', event => renderSearchRankings(period, event.target.value));
  }

  async function renderUserAnalytics(period = 'day', anchor = null) {
    const today = todayKst();
    anchor ||= period === 'day' ? today : period === 'week' ? weekAnchorKst(today) :
      period === 'month' ? today.slice(0, 7) : today.slice(0, 4);
    loading();
    const data = await api(`user-analytics?period=${encodeURIComponent(period)}&anchor=${encodeURIComponent(anchor)}`);
    const periodButtons = `<div class="period-tabs">${[['day', '일별'], ['week', '주별'], ['month', '월별'], ['year', '연도별']].map(([value, label]) =>
      `<button class="${period === value ? 'active' : ''}" data-user-period="${value}">${label}</button>`).join('')}</div>`;
    const anchorInput = period === 'year'
      ? `<input id="user-anchor" type="number" min="2020" max="2100" value="${escapeHtml(anchor)}" aria-label="사용자 행동 조회 연도">`
      : `<input id="user-anchor" type="${period === 'day' ? 'date' : period === 'week' ? 'week' : 'month'}" value="${escapeHtml(anchor)}" aria-label="사용자 행동 조회 기간">`;
    const knownActivities = data.summary.searches + data.summary.saves + data.summary.lists;
    $('#admin-content').innerHTML = `${heading('USER BEHAVIOR', '사용자 행동 분석', '검색·저장·리뷰와 회원별 활동을 한눈에 확인합니다.',
      `${periodButtons}<div class="task-anchor">${anchorInput}</div>`)}
      <div class="metrics">
        <article class="metric"><span>전체 행동</span><strong>${(data.summary.activities + data.summary.reviews).toLocaleString('ko-KR')}</strong><small>활동과 리뷰 합계</small></article>
        <article class="metric"><span>식당 검색</span><strong>${data.summary.searches.toLocaleString('ko-KR')}</strong><small>${knownActivities ? (data.summary.searches / knownActivities * 100).toFixed(1) : '0.0'}% 비중</small></article>
        <article class="metric"><span>리뷰 등록</span><strong>${data.summary.reviews.toLocaleString('ko-KR')}</strong><small>${data.summary.reviewers.toLocaleString('ko-KR')}명 작성</small></article>
        <article class="metric"><span>활동 회원</span><strong>${data.summary.activeMembers.toLocaleString('ko-KR')}</strong><small>로그인 회원 중 활동자</small></article>
      </div>
      <div class="behavior-grid">
        <article class="panel"><h2>행동 구성</h2><div class="health-list">
          <div class="health-item"><span>검색</span><b>${data.summary.searches.toLocaleString('ko-KR')}회</b></div>
          <div class="health-item"><span>맛집 저장·해제</span><b>${data.summary.saves.toLocaleString('ko-KR')}회</b></div>
          <div class="health-item"><span>리스트 관리</span><b>${data.summary.lists.toLocaleString('ko-KR')}회</b></div>
          <div class="health-item"><span>리뷰 등록</span><b>${data.summary.reviews.toLocaleString('ko-KR')}회</b></div>
          <div class="health-item"><span>비회원 활동</span><b>${data.summary.anonymous.toLocaleString('ko-KR')}회</b></div>
        </div></article>
        <article class="panel"><h2>체류시간</h2>
          <div class="tracking-state warn"><strong>수집 연결 필요</strong><p>현재 본사이트는 검색·저장·리스트·리뷰만 기록합니다. 체류시간은 product1에 수집 코드를 저장한 이후부터 표시할 수 있습니다.</p></div>
        </article>
      </div>
      <article class="panel analytics-panel"><h2>사용자 행동 추이</h2>${data.trend.length ? lineChart(data.trend, [
        { key: 'searches', label: '검색', color: '#f05a2a' },
        { key: 'saves', label: '저장', color: '#247a52' },
        { key: 'reviews', label: '리뷰', color: '#5a62d6' }
      ]) : '<div class="empty-admin">선택 기간에 사용자 행동이 없습니다.</div>'}</article>
      <article class="panel analytics-panel"><h2>회원별 활동 <small>상위 50명</small></h2>
        <div class="table-wrap">${data.users.length ? `<table><thead><tr><th>회원</th><th>검색</th><th>저장</th><th>리스트</th><th>리뷰</th><th>총 행동</th><th>최근 활동</th></tr></thead><tbody>${data.users.map(item =>
          `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.email)}</small></td><td>${item.searches.toLocaleString('ko-KR')}</td><td>${item.saves.toLocaleString('ko-KR')}</td><td>${item.lists.toLocaleString('ko-KR')}</td><td>${item.reviews.toLocaleString('ko-KR')}</td><td><strong>${(item.activities + item.reviews).toLocaleString('ko-KR')}</strong></td><td>${new Date(item.lastActiveAt).toLocaleString('ko-KR')}</td></tr>`
        ).join('')}</tbody></table>` : '<div class="empty-admin">선택 기간에 로그인 회원 활동이 없습니다.</div>'}</div>
      </article>`;
    $$('[data-user-period]').forEach(button => button.addEventListener('click', () => renderUserAnalytics(button.dataset.userPeriod)));
    $('#user-anchor').addEventListener('change', event => renderUserAnalytics(period, event.target.value));
  }

  async function renderMembers(query = '', cursor = null) {
    loading();
    const data = await api(listPath('members', query, cursor));
    const rows = data.members;
    $('#admin-content').innerHTML = `${heading('USERS', '회원 관리', '서버에 가입한 회원 상태와 권한을 관리합니다.', `<div class="toolbar"><input id="member-search" value="${escapeHtml(query)}" placeholder="회원 검색"></div>`)}
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>회원</th><th>이메일</th><th>상태</th><th>권한</th><th>가입일</th><th>관리</th></tr></thead><tbody>${rows.map(item =>
        `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.email)}</td><td><span class="status ${item.status === 'active' ? '' : 'warn'}">${item.status === 'active' ? '활성' : '정지'}</span></td><td>${item.role === 'admin' ? '관리자' : '일반 회원'}</td><td>${new Date(item.created_at).toLocaleDateString('ko-KR')}</td><td><div class="row-actions"><button class="small-button" data-member-status="${item.id}" data-status="${item.status}">${item.status === 'active' ? '정지' : '활성화'}</button><button class="small-button" data-member-role="${item.id}" data-role="${item.role}">권한 변경</button><button class="small-button danger" data-member-delete="${item.id}">삭제</button></div></td></tr>`
      ).join('')}</tbody></table>` : '<div class="empty-admin">표시할 회원이 없습니다.</div>'}</div>${nextPage(data.page)}`;
    $('#member-search').addEventListener('change', event => renderMembers(event.target.value));
    $('[data-next-cursor]')?.addEventListener('click', event => renderMembers(query, event.currentTarget.dataset.nextCursor));
    $$('[data-member-status]').forEach(button => button.addEventListener('click', async () => {
      await api(`members/${button.dataset.memberStatus}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status === 'active' ? 'suspended' : 'active' }) });
      toast('회원 상태를 변경했습니다.'); renderMembers(query);
    }));
    $$('[data-member-role]').forEach(button => button.addEventListener('click', async () => {
      await api(`members/${button.dataset.memberRole}`, { method: 'PATCH', body: JSON.stringify({ role: button.dataset.role === 'admin' ? 'member' : 'admin' }) });
      toast('회원 권한을 변경했습니다.'); renderMembers(query);
    }));
    $$('[data-member-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('이 회원과 작성 리뷰를 삭제할까요?')) return;
      await api(`members/${button.dataset.memberDelete}`, { method: 'DELETE' });
      toast('회원을 삭제했습니다.'); renderMembers(query);
    }));
  }

  async function renderReviews(query = '', cursor = null) {
    loading();
    const data = await api(listPath('reviews', query, cursor));
    const rows = data.reviews;
    $('#admin-content').innerHTML = `${heading('MODERATION', '리뷰 관리', '서버에 등록된 리뷰를 검토하고 관리합니다.', `${reviewTabs('reviews')}<div class="toolbar"><input id="review-search" value="${escapeHtml(query)}" placeholder="리뷰 검색"></div>`)}
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>작성자</th><th>식당</th><th>별점</th><th>내용</th><th>상태</th><th>작성일</th><th>관리</th></tr></thead><tbody>${rows.map(item =>
        `<tr><td>${escapeHtml(item.author)}</td><td>${escapeHtml(item.restaurant_name)}</td><td>${'★'.repeat(item.rating)}</td><td class="review-text">${escapeHtml(item.text)}</td><td><span class="status ${item.hidden ? 'warn' : ''}">${item.hidden ? '숨김' : '공개'}</span></td><td>${new Date(item.created_at).toLocaleDateString('ko-KR')}</td><td><div class="row-actions"><button class="small-button" data-review-hide="${item.id}" data-hidden="${item.hidden}">${item.hidden ? '공개' : '숨김'}</button><button class="small-button danger" data-review-delete="${item.id}">삭제</button></div></td></tr>`
      ).join('')}</tbody></table>` : '<div class="empty-admin">등록된 리뷰가 없습니다.</div>'}</div>${nextPage(data.page)}`;
    bindReviewTabs();
    $('#review-search').addEventListener('change', event => renderReviews(event.target.value));
    $('[data-next-cursor]')?.addEventListener('click', event => renderReviews(query, event.currentTarget.dataset.nextCursor));
    $$('[data-review-hide]').forEach(button => button.addEventListener('click', async () => {
      await api(`reviews/${button.dataset.reviewHide}`, { method: 'PATCH', body: JSON.stringify({ hidden: button.dataset.hidden === '0' }) });
      toast('리뷰 상태를 변경했습니다.'); renderReviews(query);
    }));
    $$('[data-review-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('이 리뷰를 완전히 삭제할까요?')) return;
      await api(`reviews/${button.dataset.reviewDelete}`, { method: 'DELETE' });
      toast('리뷰를 삭제했습니다.'); renderReviews(query);
    }));
  }

  async function renderReviewSettings() {
    loading();
    const data = await api('review-settings');
    const settings = data.settings;
    $('#admin-content').innerHTML = `${heading('MODERATION', '리뷰 관리', '회원 리뷰를 검토하고 등록 제한을 관리합니다.', reviewTabs('reviewsettings'))}
      <article class="panel settings-panel">
        <h2>리뷰 제한 설정</h2>
        <form id="review-settings-form" class="settings-form">
          <label><span>회원당 하루 전체 리뷰 제한</span><input name="daily_review_limit" type="number" min="1" max="100" value="${settings.daily_review_limit}" required><small>모든 식당에 작성한 리뷰를 합산합니다.</small></label>
          <label><span>같은 식당 하루 리뷰 제한</span><input name="restaurant_daily_review_limit" type="number" min="1" max="20" value="${settings.restaurant_daily_review_limit}" required><small>삭제한 리뷰도 당일 작성 횟수에 포함됩니다.</small></label>
          <label class="setting-switch"><span><strong>동일 내용 중복 차단</strong><small>같은 식당에 같은 문구를 다시 등록하지 못하게 합니다.</small></span><input name="duplicate_review_block" type="checkbox" ${settings.duplicate_review_block ? 'checked' : ''}></label>
          <button type="submit">설정 저장</button>
        </form>
      </article>`;
    bindReviewTabs();
    $('#review-settings-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
      button.disabled = true; button.textContent = '저장 중…';
      try {
        await api('review-settings', { method: 'PUT', body: JSON.stringify({
          daily_review_limit: Number(form.daily_review_limit.value),
          restaurant_daily_review_limit: Number(form.restaurant_daily_review_limit.value),
          duplicate_review_block: form.duplicate_review_block.checked
        }) });
        toast('리뷰 제한 설정을 저장했습니다.');
        renderReviewSettings();
      } catch (error) {
        toast(error.message);
        button.disabled = false; button.textContent = '설정 저장';
      }
    });
  }

  async function renderFoodPopups(query = '', statusFilter = 'active', sortKey = 'ddaySoon', regionFilter = '', brandFilter = '', queueFilter = '') {
    loading();
    const [data, sourceOverview] = await Promise.all([
      api('food-popup-sync'),
      api('food-popup-sources').catch(error => ({
        groups: [],
        latestAddedAt: null,
        error: error.message || '수집 현황을 불러오지 못했습니다.'
      }))
    ]);
    const today = todayKst();
    const allRows = data.popups || [];
    const populationOrder = ['경기', '서울', '부산', '경남', '인천', '경북', '대구', '충남', '전북', '전남', '충북', '강원', '대전', '광주', '울산', '제주', '세종'];
    const regionRank = region => { const normalized = String(region || '').replace(/[특별광역자치도시]/g, ''); const index = populationOrder.findIndex(item => normalized.includes(item)); return index < 0 ? populationOrder.length : index; };
    const popupBrand = item => {
      const haystack = `${item.id || ''} ${item.brand || ''} ${item.sourceName || ''} ${item.venue || ''} ${item.address || ''}`.toLocaleLowerCase('ko-KR');
      if (haystack.includes('신세계') || haystack.includes('shinsegae')) return '신세계';
      if (haystack.includes('현대') || haystack.includes('hyundai')) return '현대';
      if (haystack.includes('롯데') || haystack.includes('lotte')) return '롯데';
      return item.brand || '기타';
    };
    const dayDiff = date => Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    const statusKey = item => ['active', 'upcoming', 'ended'].includes(item.status)
      ? item.status
      : item.startDate > today ? 'upcoming' : item.endDate < today ? 'ended' : 'active';
    const phase = item => ({ active: '진행 중', upcoming: '예정', ended: '종료' })[statusKey(item)];
    const requiredPopupFields = ['name', 'venue', 'address', 'startDate', 'endDate', 'sourceUrl'];
    const latestFirstSeenAt = allRows.reduce((latest, item) => /^\d{4}-\d{2}-\d{2}$/.test(item.firstSeenAt) && item.firstSeenAt > latest ? item.firstSeenAt : latest, '');
    const reviewQueues = {
      new: allRows.filter(item => item.firstSeenAt === latestFirstSeenAt),
      ending: allRows.filter(item => statusKey(item) === 'active' && dayDiff(item.endDate) >= 0 && dayDiff(item.endDate) <= 3),
      incomplete: allRows.filter(item => statusKey(item) !== 'ended' && requiredPopupFields.some(field => !String(item[field] || '').trim()))
    };
    const queueItems = new Set(reviewQueues[queueFilter] || []);
    const rows = allRows.filter(item => (!queueFilter || queueItems.has(item)) && (!regionFilter || item.region === regionFilter) && (!brandFilter || popupBrand(item) === brandFilter) && (!query || `${item.name} ${item.venue} ${item.address} ${popupBrand(item)}`.toLocaleLowerCase('ko-KR').includes(query.toLocaleLowerCase('ko-KR'))));
    const visibleRows = rows.filter(item => statusFilter === 'all' || statusKey(item) === statusFilter);
    const sortedRows = [...visibleRows].sort((left, right) => {
      const leftValue = sortKey === 'name' ? left.name : sortKey === 'region' ? regionRank(left.region) : sortKey === 'ddayLate' ? -dayDiff(left.startDate) : dayDiff(left.startDate);
      const rightValue = sortKey === 'name' ? right.name : sortKey === 'region' ? regionRank(right.region) : sortKey === 'ddayLate' ? -dayDiff(right.startDate) : dayDiff(right.startDate);
      const primary = sortKey === 'region' ? leftValue - rightValue : String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'ko-KR');
      return primary || String(left.name).localeCompare(String(right.name), 'ko-KR');
    });
    const active = allRows.filter(item => statusKey(item) === 'active').length;
    const upcoming = allRows.filter(item => statusKey(item) === 'upcoming').length;
    const ended = allRows.filter(item => statusKey(item) === 'ended').length;
    const failedSources = [...new Set([
      ...(data.stats?.failedSources || []),
      ...(data.sources || []).filter(source => ['failed', 'error'].includes(source.status)).map(source => source.name)
    ].filter(Boolean))];
    const changeDates = [...new Set(allRows.flatMap(item => [
      item.firstSeenAt,
      statusKey(item) === 'ended' ? item.endDate : ''
    ]).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort((left, right) => right.localeCompare(left));
    const popupChanges = changeDates.map(date => ({
      date,
      added: allRows.filter(item => item.firstSeenAt === date)
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'ko-KR')),
      removed: allRows.filter(item => statusKey(item) === 'ended' && item.endDate === date)
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'ko-KR'))
    })).filter(entry => entry.added.length || entry.removed.length);
    const collectionRows = (items, emptyMessage) => items.length ? `<div class="table-wrap"><table><thead><tr><th>팝업</th><th>장소</th><th>운영 기간</th><th>상태</th></tr></thead><tbody>${items.map(item =>
      `<tr><td><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.name)}</strong></a></td><td>${escapeHtml(item.venue)}<br><small>${escapeHtml(item.region || '—')}</small></td><td>${escapeHtml(item.startDate)}<br>${escapeHtml(item.endDate)}</td><td><span class="status ${statusKey(item) === 'ended' ? 'warn' : ''}">${phase(item)}</span></td></tr>`
    ).join('')}</tbody></table></div>` : `<div class="empty-admin">${emptyMessage}</div>`;
    const running = data.latest && ['queued', 'in_progress', 'waiting', 'pending'].includes(data.latest.status);
    const statusTabs = [['active', '진행 중'], ['ended', '종료'], ['upcoming', '오픈 예정'], ['all', '전체']]
      .map(([value, label]) => `<button class="${statusFilter === value ? 'active' : ''}" data-popup-status="${value}">${label}</button>`).join('');
    const sortOptions = [['ddaySoon', 'D-day 빠른순'], ['ddayLate', 'D-day 늦은순'], ['region', '지역순(인구순)'], ['name', '이름순']]
      .map(([value, label]) => `<button type="button" class="${sortKey === value ? 'active' : ''}" data-popup-sort="${value}">${label}</button>`).join('');
    const regionOptions = [...new Set(allRows.map(item => item.region).filter(Boolean))].sort((left, right) => regionRank(left) - regionRank(right) || left.localeCompare(right, 'ko-KR'))
      .map(region => `<option value="${escapeHtml(region)}" ${regionFilter === region ? 'selected' : ''}>${escapeHtml(region)}</option>`).join('');
    const brandOptions = ['현대', '롯데', '신세계', ...new Set(allRows.map(popupBrand).filter(brand => !['현대', '롯데', '신세계'].includes(brand)))]
      .map(brand => `<option value="${escapeHtml(brand)}" ${brandFilter === brand ? 'selected' : ''}>${escapeHtml(brand)}</option>`).join('');
    const queueCards = [
      ['new', '신규 확인', reviewQueues.new.length, latestFirstSeenAt ? `${latestFirstSeenAt} 최초 수집` : '최초 수집일 없음'],
      ['ending', '3일 내 종료', reviewQueues.ending.length, '종료 전 일정 재확인'],
      ['incomplete', '정보 보완', reviewQueues.incomplete.length, '필수 운영정보 누락']
    ].map(([key, label, count, description]) => `<button type="button" class="review-queue-card ${queueFilter === key ? 'active' : ''}" data-popup-queue="${key}"><span>${label}</span><strong>${count.toLocaleString('ko-KR')}</strong><small>${escapeHtml(description)}</small></button>`).join('');
    const collectionOverview = (sourceOverview.groups || []).map(group => {
      const addedCount = group.branches.reduce((sum, branch) => sum + Number(branch.addedCount || 0), 0);
      return `<details class="popup-source-group">
        <summary><strong>${escapeHtml(group.collector)}</strong><span>시설 ${group.branches.length.toLocaleString('ko-KR')}곳</span><span>이번 갱신 추가 ${addedCount.toLocaleString('ko-KR')}개</span><b class="status ${['failed', 'error', 'unknown'].includes(group.runtimeStatus) ? 'warn' : ''}">${escapeHtml(group.runtimeStatus === 'active' ? '수집 중' : group.runtimeStatus === 'no-results' ? '정상 · 결과 없음' : group.runtimeStatus || '상태 미확인')}</b></summary>
        <div class="popup-source-body"><div class="table-wrap"><table><thead><tr><th>시설</th><th>지역</th><th>현재 포함</th><th>이번 갱신 추가</th><th>포함된 링크</th><th>수집 링크</th></tr></thead><tbody>${group.branches.map(branch => {
          const sourceUrl = safeExternalUrl(branch.sourceUrl);
          const includedLinks = (branch.includedUrls || []).map((url, index) => {
            const safeUrl = safeExternalUrl(url);
            return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">원본 ${index + 1} ↗</a>` : '';
          }).filter(Boolean).join('<br>');
          return `<tr><td><strong>${escapeHtml(branch.name)}</strong></td><td>${escapeHtml(branch.region || '—')}</td><td>${Number(branch.popupCount || 0).toLocaleString('ko-KR')}개</td><td><strong class="history-added">+${Number(branch.addedCount || 0).toLocaleString('ko-KR')}개</strong></td><td>${includedLinks || '—'}</td><td>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">수집처 열기 ↗</a>` : '—'}</td></tr>`;
        }).join('')}</tbody></table></div></div>
      </details>`;
    }).join('');
    $('#admin-content').innerHTML = `${heading('POP-UP DATA', '푸드 팝업 데이터', '진행 중·종료 팝업을 상태별로 나누어 확인하고 관리합니다.',
      `<div class="toolbar"><input id="popup-search" value="${escapeHtml(query)}" placeholder="팝업·장소 검색"></div>`)}
      <div class="popup-filter-toolbar"><div class="period-tabs popup-status-tabs">${statusTabs}</div><div class="period-tabs popup-sort-tabs">${sortOptions}</div><select id="popup-region-filter" aria-label="지역 선택"><option value="">전체 지역</option>${regionOptions}</select><select id="popup-brand-filter" aria-label="브랜드 선택"><option value="">전체 브랜드</option>${brandOptions}</select><button type="button" class="filter-reset" id="popup-filter-reset">초기화</button></div>
      <div class="metrics">
        <article class="metric"><span>전체 팝업</span><strong>${allRows.length.toLocaleString('ko-KR')}</strong><small>product1 공용 원본</small></article>
        <article class="metric"><span>진행 중</span><strong>${active.toLocaleString('ko-KR')}</strong><small>오늘 운영 중</small></article>
        <article class="metric"><span>오픈 예정</span><strong>${upcoming.toLocaleString('ko-KR')}</strong><small>공식 일정 기준</small></article>
        <article class="metric"><span>종료</span><strong>${ended.toLocaleString('ko-KR')}</strong><small>보존된 이력</small></article>
      </div>
      <article class="panel popup-review-queue"><div class="review-queue-head"><div><h2>운영 검수 큐</h2><p>오늘 먼저 확인할 신규·종료 예정·필수정보 누락 항목입니다.</p></div>${queueFilter ? '<button type="button" class="small-button" id="popup-queue-clear">전체 목록 보기</button>' : ''}</div><div class="review-queue-grid">${queueCards}</div>
        ${failedSources.length ? `<div class="source-alert"><strong>수집 실패 소스 ${failedSources.length.toLocaleString('ko-KR')}개</strong><span>${failedSources.map(escapeHtml).join(', ')}</span>${data.latest?.url ? `<a href="${escapeHtml(data.latest.url)}" target="_blank" rel="noreferrer">실행 로그 보기 ↗</a>` : ''}</div>` : '<div class="source-ok"><span class="status">정상</span> 실패로 기록된 수집 소스가 없습니다.</div>'}
      </article>
      <article class="panel popup-compose"><h2>데이터 연동 상태</h2><div class="health-list">
        <div class="health-item"><span>먹당 페이지 원본</span><b class="status">실시간 공유</b></div>
        <div class="health-item"><span>원본 최근 갱신</span><b>${data.updatedAt ? new Date(data.updatedAt).toLocaleString('ko-KR') : '확인 중'}</b></div>
        <div class="health-item"><span>자동 갱신</span><b>${escapeHtml(data.schedule?.label || '일정 정보 확인 중')}</b></div>
        <div class="health-item"><span>최근 작업</span><b class="status ${data.latest?.conclusion === 'failure' ? 'warn' : ''}">${running ? '실행 중' : data.latest?.conclusion === 'success' ? '성공' : data.latest?.conclusion || '기록 없음'}</b></div>
      </div><div class="sync-actions"><button id="run-popup-sync" class="small-button" ${running || !data.canRun ? 'disabled' : ''}>${running ? '갱신 실행 중' : '지금 갱신 실행'}</button>${data.latest?.url ? `<a href="${escapeHtml(data.latest.url)}" target="_blank" rel="noreferrer">실행 로그 보기 ↗</a>` : ''}</div></article>
      <article class="panel popup-collection-overview"><h2>이번 갱신 수집 현황 <small>${sourceOverview.latestAddedAt ? `${escapeHtml(sourceOverview.latestAddedAt)} 최초 확인 기준` : '신규 수집일 없음'}</small></h2><p>현재 수집 중인 모든 브랜드와 시설, 시설별 신규 추가 건수와 실제 포함 원본을 표시합니다.</p>${sourceOverview.error ? `<div class="source-alert"><strong>수집 현황 일부를 불러오지 못했습니다.</strong><span>${escapeHtml(sourceOverview.error)}</span></div>` : ''}<div class="popup-source-groups">${collectionOverview || '<div class="empty-admin">등록된 수집 브랜드와 시설이 없습니다.</div>'}</div></article>
      <article class="panel popup-history"><h2>일자별 팝업 추가·삭제 내역 <small>삭제 = 운영 종료로 진행 목록에서 제외</small></h2>
        ${popupChanges.length ? `<div class="history-list">${popupChanges.map((entry, index) => `<details ${index === 0 ? 'open' : ''}>
          <summary><strong>${escapeHtml(entry.date)}</strong><span class="history-added">추가 ${entry.added.length.toLocaleString('ko-KR')}개</span><span class="history-removed">삭제 ${entry.removed.length.toLocaleString('ko-KR')}개</span></summary>
          <div class="history-columns">
            <section><h3>추가된 팝업</h3>${collectionRows(entry.added, '이 날짜에 추가된 팝업이 없습니다.')}</section>
            <section><h3>삭제된 팝업 <small>운영 종료</small></h3>${collectionRows(entry.removed, '이 날짜에 종료된 팝업이 없습니다.')}</section>
          </div>
        </details>`).join('')}</div>` : '<div class="empty-admin">날짜별 추가·삭제 이력이 없습니다.</div>'}
      </article>
      <div class="table-wrap">${sortedRows.length ? `<table><thead><tr><th>팝업</th><th>브랜드</th><th>장소</th><th>지역</th><th>D-day</th><th>운영 기간</th><th>상태</th><th>출처</th></tr></thead><tbody>${sortedRows.map(item =>
        `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(popupBrand(item))}</td><td>${escapeHtml(item.venue)}<br><small>${escapeHtml(item.address)}</small></td><td>${escapeHtml(item.region || '—')}</td><td>${dayDiff(item.startDate) > 0 ? `D-${dayDiff(item.startDate)}` : dayDiff(item.startDate) === 0 ? 'D-day' : `D+${Math.abs(dayDiff(item.startDate))}`}</td><td>${escapeHtml(item.startDate)}<br>${escapeHtml(item.endDate)}</td><td><span class="status ${statusKey(item) === 'ended' ? 'warn' : ''}">${phase(item)}</span></td><td><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceName || '공식 출처')} ↗</a></td></tr>`
      ).join('')}</tbody></table>` : `<div class="empty-admin">${statusFilter === 'active' ? '현재 진행 중인 푸드 팝업이 없습니다.' : statusFilter === 'ended' ? '종료된 푸드 팝업이 없습니다.' : '조건에 맞는 푸드 팝업이 없습니다.'}</div>`}</div>`;
    $('#popup-search').addEventListener('change', event => renderFoodPopups(event.target.value, statusFilter, sortKey, regionFilter, brandFilter, queueFilter));
    $$('[data-popup-sort]').forEach(button => button.addEventListener('click', () => renderFoodPopups(query, statusFilter, button.dataset.popupSort, regionFilter, brandFilter, queueFilter)));
    $('#popup-region-filter').addEventListener('change', event => renderFoodPopups(query, statusFilter, sortKey, event.target.value, brandFilter, queueFilter));
    $('#popup-brand-filter').addEventListener('change', event => renderFoodPopups(query, statusFilter, sortKey, regionFilter, event.target.value, queueFilter));
    $('#popup-filter-reset').addEventListener('click', () => renderFoodPopups('', 'active', 'ddaySoon', '', ''));
    $$('[data-popup-status]').forEach(button => button.addEventListener('click', () => renderFoodPopups(query, button.dataset.popupStatus, sortKey, regionFilter, brandFilter)));
    $$('[data-popup-queue]').forEach(button => button.addEventListener('click', () => renderFoodPopups(query, 'all', sortKey, regionFilter, brandFilter, button.dataset.popupQueue)));
    $('#popup-queue-clear')?.addEventListener('click', () => renderFoodPopups(query, 'active', sortKey, regionFilter, brandFilter));
    $('#run-popup-sync')?.addEventListener('click', async event => {
      if (!confirm('공식 푸드 팝업 데이터를 지금 다시 수집할까요?')) return;
      event.currentTarget.disabled = true;
      await api('food-popup-sync/run', { method: 'POST' });
      toast('푸드 팝업 갱신을 시작했습니다.'); setTimeout(renderFoodPopups, 2500);
    });
  }

  async function renderFoodPopupSources(query = '', collectorFilter = '', regionFilter = '', statusFilter = '') {
    loading();
    const data = await api('food-popup-sources');
    const allGroups = data.groups || [];
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    const statusLabels = {
      'verified-popup-found': '팝업 확인',
      'official-feed-monitored': '공식 피드 감시',
      'adapter-needed': '수집기 연결 필요',
      'collector-needed': '수집기 필요',
      active: '수집 중',
      'no-results': '정상 · 결과 없음',
      failed: '수집 실패',
      error: '수집 오류',
      unknown: '상태 미확인'
    };
    const methodLabels = { official_api: '공식 API', html: '공식 HTML', json_embedded: '공식 JSON', sitemap: '사이트맵', rss: 'RSS', manual_review: '수동 검수' };
    const regions = [...new Set(allGroups.flatMap(group => group.branches.map(branch => branch.region)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ko-KR'));
    const collectors = allGroups.map(group => group.collector).sort((left, right) => left.localeCompare(right, 'ko-KR'));
    const filteredGroups = allGroups.map(group => {
      if (collectorFilter && group.collector !== collectorFilter) return null;
      const groupHaystack = `${group.collector} ${group.operator} ${(group.sourceNames || []).join(' ')} ${(group.urls || []).map(item => item.url).join(' ')}`.toLocaleLowerCase('ko-KR');
      const groupMatches = normalizedQuery && groupHaystack.includes(normalizedQuery);
      const branches = group.branches.filter(branch => {
        if (regionFilter && branch.region !== regionFilter) return false;
        if (statusFilter && branch.status !== statusFilter) return false;
        if (!normalizedQuery || groupMatches) return true;
        return `${branch.name} ${branch.region} ${branch.kind} ${branch.address}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery);
      });
      return branches.length ? { ...group, branches } : null;
    }).filter(Boolean);
    const collectorOptions = collectors.map(collector => `<option value="${escapeHtml(collector)}" ${collectorFilter === collector ? 'selected' : ''}>${escapeHtml(collector)}</option>`).join('');
    const regionOptions = regions.map(region => `<option value="${escapeHtml(region)}" ${regionFilter === region ? 'selected' : ''}>${escapeHtml(region)}</option>`).join('');
    const coverageStatusOptions = [
      ['verified-popup-found', '팝업 확인 지점'], ['official-feed-monitored', '공식 피드 감시'], ['adapter-needed', '수집기 연결 필요']
    ].map(([value, label]) => `<option value="${value}" ${statusFilter === value ? 'selected' : ''}>${label}</option>`).join('');
    const groupHtml = filteredGroups.map(group => {
      const runtimeWarn = !['active', 'no-results'].includes(group.runtimeStatus);
      const links = (group.urls || []).map(item => {
        const url = safeExternalUrl(item.url);
        return url ? `<a class="source-url" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(url)}</small></a>` : '';
      }).join('');
      const endpointRows = (group.endpoints || []).map(item => {
        const url = safeExternalUrl(item.url);
        return url ? `<tr><td><strong>${escapeHtml(item.label)}</strong></td><td>${escapeHtml(item.scope || '—')}</td><td><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)} ↗</a></td></tr>` : '';
      }).join('');
      const methods = (group.collectionMethods || []).map(method => methodLabels[method] || method).join(' · ') || '방식 미확인';
      return `<details class="popup-source-group" ${query || collectorFilter || regionFilter || statusFilter ? 'open' : ''}>
        <summary><strong>${escapeHtml(group.collector)}</strong><span>시설원장 ${group.branches.length.toLocaleString('ko-KR')}곳</span><span>엔드포인트 ${(group.endpoints || []).length.toLocaleString('ko-KR')}개</span><span>현재 팝업 ${group.runtimeCount.toLocaleString('ko-KR')}개</span><b class="status ${runtimeWarn ? 'warn' : ''}">${escapeHtml(statusLabels[group.runtimeStatus] || group.runtimeStatus)}</b></summary>
        <div class="popup-source-body">
          <div class="source-meta"><div><span>운영사</span><strong>${escapeHtml(group.operator || '미확인')}</strong></div><div><span>수집 방식</span><strong>${escapeHtml(methods)}</strong></div><div><span>최근 검증</span><strong>${escapeHtml(group.lastVerifiedAt || '미확인')}</strong></div><div><span>우선순위</span><strong>${escapeHtml(group.priority || '—')}</strong></div></div>
          <div class="source-links">${links || '<span class="source-link-empty">등록된 공식 수집 링크가 없습니다.</span>'}</div>
          ${endpointRows ? `<section class="source-endpoints"><h3>실제 수집 엔드포인트</h3><div class="table-wrap"><table><thead><tr><th>수집 대상</th><th>범위·호출 방식</th><th>URL</th></tr></thead><tbody>${endpointRows}</tbody></table></div></section>` : ''}
          <section class="source-branches"><h3>브랜드별 전국 시설 원장 매핑 지점</h3>
          <div class="table-wrap"><table><thead><tr><th>지점</th><th>지역·주소</th><th>시설 유형</th><th>수집 상태</th><th>확인 팝업</th><th>수집 링크</th></tr></thead><tbody>${group.branches.map(branch => {
            const sourceUrl = safeExternalUrl(branch.sourceUrl);
            const branchWarn = ['adapter-needed', 'collector-needed', 'unknown'].includes(branch.status);
            return `<tr><td><strong>${escapeHtml(branch.name)}</strong></td><td>${escapeHtml(branch.region || '—')}<br><small>${escapeHtml(branch.address || '주소 미등록')}</small></td><td>${escapeHtml(branch.kind || '—')}</td><td><span class="status ${branchWarn ? 'warn' : ''}">${escapeHtml(statusLabels[branch.status] || branch.status)}</span></td><td>${branch.popupCount.toLocaleString('ko-KR')}개</td><td>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">열기 ↗</a>` : '—'}</td></tr>`;
          }).join('')}</tbody></table></div></section>
        </div>
      </details>`;
    }).join('');
    $('#admin-content').innerHTML = `${heading('POP-UP SOURCES', '푸드 팝업 데이터소스', '브랜드별 공식 수집 링크와 전국 지점 연결 상태를 확인합니다.', `<div class="toolbar"><input id="popup-source-search" value="${escapeHtml(query)}" placeholder="브랜드·지점·주소·URL 검색"></div>`)}
      <div class="popup-source-toolbar"><select id="popup-source-collector" aria-label="브랜드 선택"><option value="">전체 브랜드</option>${collectorOptions}</select><select id="popup-source-region" aria-label="지역 선택"><option value="">전체 지역</option>${regionOptions}</select><select id="popup-source-status" aria-label="수집 상태 선택"><option value="">전체 수집 상태</option>${coverageStatusOptions}</select><button type="button" class="filter-reset" id="popup-source-reset">초기화</button></div>
      <div class="metrics">
        <article class="metric"><span>수집 데이터소스</span><strong>${data.summary.sourceCount.toLocaleString('ko-KR')}</strong><small>현재 등록 수집기</small></article>
        <article class="metric"><span>브랜드 매핑 시설</span><strong>${data.summary.branchCount.toLocaleString('ko-KR')}</strong><small>전국 시설 원장 기준</small></article>
        <article class="metric"><span>정상 수집 소스</span><strong>${data.summary.healthySourceCount.toLocaleString('ko-KR')}</strong><small>수집 중·정상 결과 없음</small></article>
        <article class="metric"><span>수집기 연결 필요</span><strong>${data.summary.adapterNeededCount.toLocaleString('ko-KR')}</strong><small>브랜드 지점 후속 연결</small></article>
      </div>
      <article class="panel popup-source-note"><strong>전국 시설 ${data.summary.nationwideVenueTotal.toLocaleString('ko-KR')}곳 기준</strong><span>실제 수집기 설정의 지점별 엔드포인트와 전국 시설 원장에 브랜드가 매핑된 지점을 함께 표시합니다. 전점 공통 수집기는 각 시설에 같은 공식 URL을 연결합니다. 원본 갱신: ${data.updatedAt ? new Date(data.updatedAt).toLocaleString('ko-KR') : '미확인'}</span></article>
      <div class="popup-source-groups">${groupHtml || '<div class="empty-admin panel">조건에 맞는 데이터소스나 지점이 없습니다.</div>'}</div>`;
    $('#popup-source-search').addEventListener('change', event => renderFoodPopupSources(event.target.value, collectorFilter, regionFilter, statusFilter));
    $('#popup-source-collector').addEventListener('change', event => renderFoodPopupSources(query, event.target.value, regionFilter, statusFilter));
    $('#popup-source-region').addEventListener('change', event => renderFoodPopupSources(query, collectorFilter, event.target.value, statusFilter));
    $('#popup-source-status').addEventListener('change', event => renderFoodPopupSources(query, collectorFilter, regionFilter, event.target.value));
    $('#popup-source-reset').addEventListener('click', () => renderFoodPopupSources());
  }

  async function renderRestaurants(sortKey = 'date') {
    loading();
    const sync = await api('restaurant-sync');
    const validation = sync.validation?.stats || validationReport?.stats || {};
    const manifest = sync.manifest || restaurantMeta;
    const refresh = sync.refresh;
    const latest = sync.latest;
    const history = sync.history?.entries || [];
    const running = latest && ['queued', 'in_progress', 'waiting', 'pending'].includes(latest.status);
    const succeeded = latest?.conclusion === 'success';
    const resultLabel = running ? '실행 중' : succeeded ? '성공' : latest?.conclusion ? '실패' : '기록 없음';
    const sortedHistory = [...history].sort((left, right) => sortKey === 'name'
      ? String(left.date).localeCompare(String(right.date), 'ko-KR')
      : String(right.date).localeCompare(String(left.date), 'ko-KR'));
    const sortedRegions = [...(manifest.regions || [])].sort((left, right) => sortKey === 'name' || sortKey === 'region'
      ? String(left.name).localeCompare(String(right.name), 'ko-KR')
      : Number(right.count || 0) - Number(left.count || 0));
    const restaurantSortOptions = [['date', '날짜순'], ['region', '지역순'], ['name', '이름순']]
      .map(([value, label]) => `<option value="${value}" ${sortKey === value ? 'selected' : ''}>${label}</option>`).join('');
    $('#admin-content').innerHTML = `${heading('DATA', '식당 데이터', '공공데이터와 검색 인덱스 상태입니다.')}
      <div class="metrics"><article class="metric"><span>영업 중 식당</span><strong>${(manifest.total || 0).toLocaleString('ko-KR')}</strong><small>공식 인허가 기준</small></article><article class="metric"><span>최근 개업 반영</span><strong>${refresh ? refresh.opened.toLocaleString('ko-KR') : '—'}</strong><small>${refresh?.updatedAt ? new Date(refresh.updatedAt).toLocaleDateString('ko-KR') : '결과 보고서 연결 대기'}</small></article><article class="metric"><span>최근 폐업·제외</span><strong>${refresh ? refresh.closed.toLocaleString('ko-KR') : '—'}</strong><small>${refresh ? '공식 데이터 비교' : '결과 보고서 연결 대기'}</small></article><article class="metric"><span>자동 갱신</span><strong>${resultLabel}</strong><small>${escapeHtml(sync.schedule?.label || '일정 정보 확인 중')}</small></article></div>
      <div class="dashboard-grid">
        <article class="panel"><h2>갱신 작업</h2><div class="health-list">
          <div class="health-item"><span>자동 실행</span><b class="status">사용 중</b></div>
          <div class="health-item"><span>최근 실행</span><b>${latest?.startedAt ? new Date(latest.startedAt).toLocaleString('ko-KR') : '기록 없음'}</b></div>
          <div class="health-item"><span>최근 결과</span><b class="status ${succeeded || running ? '' : 'warn'}">${resultLabel}</b></div>
          <div class="health-item"><span>데이터 갱신</span><b>${manifest.updatedAt ? new Date(manifest.updatedAt).toLocaleString('ko-KR') : '확인 중'}</b></div>
        </div><div class="sync-actions">${sync.canRun ? `<button id="run-restaurant-sync" class="small-button" ${running ? 'disabled' : ''}>${running ? '갱신 실행 중' : '지금 갱신 실행'}</button>` : '<a class="small-button sync-link" href="https://github.com/jwhtws/product1/actions/workflows/restaurant-data-validation.yml" target="_blank" rel="noreferrer">GitHub에서 수동 실행 ↗</a>'}${latest?.url ? `<a href="${escapeHtml(latest.url)}" target="_blank" rel="noreferrer">실행 로그 보기 ↗</a>` : ''}</div></article>
        <article class="panel"><h2>데이터 검증</h2><div class="health-list">
          <div class="health-item"><span>검증 결과</span><b class="status ${sync.validation?.ok === false ? 'warn' : ''}">${sync.validation?.ok === false ? '확인 필요' : '정상'}</b></div>
          <div class="health-item"><span>시작일 검증</span><b>${(validation.verifiedPermitDateRows || 0).toLocaleString('ko-KR')}건</b></div>
          <div class="health-item"><span>시작일 누락</span><b>${(validation.missingPermitDateRows || 0).toLocaleString('ko-KR')}건</b></div>
        </div></article>
      </div>
      <article class="panel restaurant-history"><h2>일자별 개업·폐업 변경 이력 <small>최근 90일</small></h2>
        ${sortedHistory.length ? `<div class="history-list">${sortedHistory.map(entry => `<details data-history-date="${escapeHtml(entry.date)}">
          <summary><strong>${escapeHtml(entry.date)}</strong><span class="history-added">추가 ${entry.addedCount.toLocaleString('ko-KR')}곳</span><span class="history-removed">제거 ${entry.removedCount.toLocaleString('ko-KR')}곳</span><span>영업 중 ${entry.total.toLocaleString('ko-KR')}곳</span></summary>
          <div class="history-detail empty-admin">펼치면 상세 목록을 불러옵니다.</div>
        </details>`).join('')}</div>` : '<div class="empty-admin">현재 데이터를 기준으로 설정했습니다. 다음 일일 갱신부터 추가·제거된 식당이 날짜별로 기록됩니다.</div>'}
      </article>
      <article class="panel restaurant-regions"><h2>지역별 식당 현황</h2><div class="restaurant-list-toolbar"><span>식당 리스트 정렬</span><div><select id="restaurant-sort" aria-label="식당 데이터 정렬">${restaurantSortOptions}</select><button type="button" class="filter-reset" id="restaurant-sort-reset">초기화</button></div></div><div class="table-wrap"><table><thead><tr><th>지역</th><th>식당 수</th><th>데이터 파일</th></tr></thead><tbody>${sortedRegions.map(region => `<tr><td><strong>${escapeHtml(region.name)}</strong></td><td>${region.count.toLocaleString('ko-KR')}</td><td>${(region.files || [region.file]).length}개 조각</td></tr>`).join('')}</tbody></table></div></article>`;
    $('#restaurant-sort').addEventListener('change', event => renderRestaurants(event.target.value));
    $('#restaurant-sort-reset').addEventListener('click', () => renderRestaurants('date'));
    $('#run-restaurant-sync')?.addEventListener('click', async event => {
      if (!confirm('공식 공공데이터를 다시 받아 개업·폐업 정보를 지금 갱신할까요?')) return;
      event.currentTarget.disabled = true;
      try {
        await api('restaurant-sync/run', { method: 'POST' });
        toast('식당 데이터 갱신을 시작했습니다.');
        setTimeout(renderRestaurants, 2500);
      } catch (error) {
        toast(error.message);
        event.currentTarget.disabled = false;
      }
    });
    $$('[data-history-date]').forEach(details => details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = 'true';
      const target = details.querySelector('.history-detail');
      try {
        const data = await api(`restaurant-sync/history/${encodeURIComponent(details.dataset.historyDate)}`);
        const entry = data.entry;
        target.className = 'history-columns';
        target.innerHTML = [
          ['추가된 식당', entry.added, '인허가일'],
          ['제거된 식당', entry.removed, '기존 인허가일']
        ].map(([title, rows, dateLabel]) => `<section><h3>${title}</h3>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>식당</th><th>주소</th><th>업종</th><th>${dateLabel}</th></tr></thead><tbody>${rows.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.address)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.permitDate)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-admin">해당 식당이 없습니다.</div>'}</section>`).join('');
      } catch (error) {
        target.textContent = error.message;
      }
    }));
  }

  async function renderLogs(cursor = null) {
    loading();
    const data = await api(listPath('logs', '', cursor));
    $('#admin-content').innerHTML = `${heading('AUDIT', '운영 로그', '서버에 기록된 관리자 작업입니다.')}<article class="panel"><div class="log-list">${data.logs.length ? data.logs.map(log => `<div class="log"><time>${new Date(log.created_at).toLocaleString('ko-KR')}</time><strong>${escapeHtml(log.action)}</strong><span>${escapeHtml(log.detail)}</span></div>`).join('') : '<div class="empty-admin">아직 관리 작업 기록이 없습니다.</div>'}</div></article>${nextPage(data.page)}`;
    $('[data-next-cursor]')?.addEventListener('click', event => renderLogs(event.currentTarget.dataset.nextCursor));
  }

  async function renderUserData(query = '', cursor = null) {
    loading();
    const data = await api(listPath('user-data', query, cursor));
    const grouped = new Map();
    data.rows.forEach(item => {
      const user = grouped.get(item.user_id) || { name: item.name, email: item.email, profile: {}, saved: [], lists: {}, updatedAt: 0 };
      user[item.data_key] = item.value;
      user.updatedAt = Math.max(user.updatedAt, item.updated_at);
      grouped.set(item.user_id, user);
    });
    const rows = [...grouped.values()];
    $('#admin-content').innerHTML = `${heading('ACCOUNT DATA', '사용자 데이터', '프로필, 저장 맛집과 사용자 리스트를 확인합니다.', `<div class="toolbar"><input id="userdata-search" value="${escapeHtml(query)}" placeholder="회원 검색"></div>`)}
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>회원</th><th>프로필</th><th>저장 맛집</th><th>사용자 리스트</th><th>최근 변경</th></tr></thead><tbody>${rows.map(item =>
        `<tr><td><strong>${escapeHtml(item.profile?.name || item.name)}</strong><br><small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.profile?.favorite || '선호 음식 없음')}<br><small>${escapeHtml(item.profile?.bio || '소개 없음')}</small></td><td><strong>${(item.saved || []).length.toLocaleString('ko-KR')}개</strong></td><td>${Object.entries(item.lists || {}).map(([name, values]) => `${escapeHtml(name)} (${values.length})`).join('<br>') || '없음'}</td><td>${new Date(item.updatedAt).toLocaleString('ko-KR')}</td></tr>`
      ).join('')}</tbody></table>` : '<div class="empty-admin">서버에 저장된 사용자 데이터가 없습니다.</div>'}</div>${nextPage(data.page)}`;
    $('#userdata-search').addEventListener('change', event => renderUserData(event.target.value));
    $('[data-next-cursor]')?.addEventListener('click', event => renderUserData(query, event.currentTarget.dataset.nextCursor));
  }

  async function renderActivities(cursor = null) {
    loading();
    const data = await api(listPath('activities', '', cursor));
    const labels = { search: '검색', save: '맛집 저장', list: '리스트' };
    $('#admin-content').innerHTML = `${heading('ACTIVITY', '검색·저장 활동', 'product1에서 발생한 사용자 활동을 최신순으로 확인합니다.')}
      <article class="panel"><div class="log-list">${data.activities.length ? data.activities.map(item =>
        `<div class="log"><time>${new Date(item.created_at).toLocaleString('ko-KR')}</time><strong>${escapeHtml(labels[item.event_type] || item.event_type)}</strong><span>${escapeHtml(item.detail)} · ${escapeHtml(item.name || '비회원')}</span></div>`
      ).join('') : '<div class="empty-admin">아직 기록된 사용자 활동이 없습니다.</div>'}</div></article>${nextPage(data.page)}`;
    $('[data-next-cursor]')?.addEventListener('click', event => renderActivities(event.currentTarget.dataset.nextCursor));
  }

  async function render(view = currentView) {
    currentView = view;
    $$('[data-view]').forEach(button => button.classList.toggle('active',
      button.dataset.view === view || (button.dataset.view === 'reviews' && view === 'reviewsettings')));
    $('.sidebar').classList.remove('open');
    try {
      await ({ dashboard: renderDashboard, tasks: renderTasks, analytics: renderAnalytics, searchrankings: renderSearchRankings, useranalytics: renderUserAnalytics, members: renderMembers, reviews: renderReviews, reviewsettings: renderReviewSettings, userdata: renderUserData, activities: renderActivities, restaurants: renderRestaurants, foodpopups: renderFoodPopups, foodpopupsources: renderFoodPopupSources, logs: renderLogs }[view] || renderDashboard)();
    } catch (error) {
      if (error.status === 401) return showLogin();
      $('#admin-content').innerHTML = `<div class="empty-admin">${escapeHtml(error.message)}</div>`;
    }
  }

  function prepareHistory() {
    if (historyReady) return;
    historyReady = true;
    const savedView = history.state?.[historyStateKey];
    if (adminViews.has(savedView)) {
      currentView = savedView;
      return;
    }
    // 첫 뒤로가기가 관리자 화면 밖으로 이탈하지 않도록 현재 화면을 한 단계 확보한다.
    history.replaceState({ ...history.state, [historyStateKey]: 'dashboard', guard: true }, '');
    history.pushState({ [historyStateKey]: 'dashboard' }, '');
    currentView = 'dashboard';
  }

  function navigate(view) {
    const nextView = adminViews.has(view) ? view : 'dashboard';
    if (nextView !== currentView) {
      history.pushState({ [historyStateKey]: nextView }, '');
    }
    return render(nextView);
  }

  function showLogin() {
    $('#admin-login').hidden = false;
    $('#admin-app').hidden = true;
  }

  async function enterAdmin() {
    sessionStorage.setItem('mukdang_admin_active', '1');
    $('#admin-login').hidden = true;
    $('#admin-app').hidden = false;
    prepareHistory();
    await render();
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ code: new FormData(event.currentTarget).get('code') }) });
      await enterAdmin();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $('#logout').addEventListener('click', async () => {
    sessionStorage.removeItem('mukdang_admin_active');
    await api('logout', { method: 'POST' });
    showLogin();
  });
  $('#menu-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
  $$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  window.addEventListener('popstate', event => {
    if ($('#admin-app').hidden) return;
    const previousView = event.state?.[historyStateKey];
    if (adminViews.has(previousView) && !event.state?.guard) return render(previousView);
    // 기록의 첫 지점에서도 브라우저가 관리자 화면 밖으로 빠져나가지 않게 한다.
    history.pushState({ [historyStateKey]: currentView, guard: true }, '');
    render(currentView);
  });
  $('#today').textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  Promise.all([
    fetch('https://product1-84t.pages.dev/data/restaurants/regions.json?v=20260729-1').then(response => response.json()),
    fetch('https://product1-84t.pages.dev/data/restaurants/validation-report.json?v=20260729-1').then(response => response.ok ? response.json() : null)
  ]).then(([data, report]) => { restaurantMeta = data; validationReport = report; }).catch(() => {});

  // 같은 탭의 새로고침은 유지하고, 새 탭·새 브라우저에서는 다시 인증한다.
  if (sessionStorage.getItem('mukdang_admin_active') === '1') {
    api('session').then(enterAdmin).catch(() => {
      sessionStorage.removeItem('mukdang_admin_active');
      showLogin();
    });
  } else {
    api('logout').catch(() => {}).finally(showLogin);
  }
})();
