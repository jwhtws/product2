(function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  let currentView = 'dashboard';
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
    $('#admin-content').innerHTML = `${heading('MODERATION', '리뷰 관리', '서버에 등록된 리뷰를 검토하고 관리합니다.', `<div class="toolbar"><input id="review-search" value="${escapeHtml(query)}" placeholder="리뷰 검색"></div>`)}
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>작성자</th><th>식당</th><th>별점</th><th>내용</th><th>상태</th><th>작성일</th><th>관리</th></tr></thead><tbody>${rows.map(item =>
        `<tr><td>${escapeHtml(item.author)}</td><td>${escapeHtml(item.restaurant_name)}</td><td>${'★'.repeat(item.rating)}</td><td class="review-text">${escapeHtml(item.text)}</td><td><span class="status ${item.hidden ? 'warn' : ''}">${item.hidden ? '숨김' : '공개'}</span></td><td>${new Date(item.created_at).toLocaleDateString('ko-KR')}</td><td><div class="row-actions"><button class="small-button" data-review-hide="${item.id}" data-hidden="${item.hidden}">${item.hidden ? '공개' : '숨김'}</button><button class="small-button danger" data-review-delete="${item.id}">삭제</button></div></td></tr>`
      ).join('')}</tbody></table>` : '<div class="empty-admin">등록된 리뷰가 없습니다.</div>'}</div>${nextPage(data.page)}`;
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

  async function renderRestaurants() {
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
    $('#admin-content').innerHTML = `${heading('DATA', '식당 데이터', '공공데이터와 검색 인덱스 상태입니다.')}
      <div class="metrics"><article class="metric"><span>영업 중 식당</span><strong>${(manifest.total || 0).toLocaleString('ko-KR')}</strong><small>공식 인허가 기준</small></article><article class="metric"><span>최근 개업 반영</span><strong>${refresh ? refresh.opened.toLocaleString('ko-KR') : '—'}</strong><small>${refresh?.updatedAt ? new Date(refresh.updatedAt).toLocaleDateString('ko-KR') : '결과 보고서 연결 대기'}</small></article><article class="metric"><span>최근 폐업·제외</span><strong>${refresh ? refresh.closed.toLocaleString('ko-KR') : '—'}</strong><small>${refresh ? '공식 데이터 비교' : '결과 보고서 연결 대기'}</small></article><article class="metric"><span>자동 갱신</span><strong>${resultLabel}</strong><small>${sync.schedule.label}</small></article></div>
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
        ${history.length ? `<div class="history-list">${history.map(entry => `<details data-history-date="${escapeHtml(entry.date)}">
          <summary><strong>${escapeHtml(entry.date)}</strong><span class="history-added">추가 ${entry.addedCount.toLocaleString('ko-KR')}곳</span><span class="history-removed">제거 ${entry.removedCount.toLocaleString('ko-KR')}곳</span><span>영업 중 ${entry.total.toLocaleString('ko-KR')}곳</span></summary>
          <div class="history-detail empty-admin">펼치면 상세 목록을 불러옵니다.</div>
        </details>`).join('')}</div>` : '<div class="empty-admin">현재 데이터를 기준으로 설정했습니다. 다음 일일 갱신부터 추가·제거된 식당이 날짜별로 기록됩니다.</div>'}
      </article>
      <article class="panel restaurant-regions"><h2>지역별 식당 현황</h2><div class="table-wrap"><table><thead><tr><th>지역</th><th>식당 수</th><th>데이터 파일</th></tr></thead><tbody>${(manifest.regions || []).map(region => `<tr><td><strong>${escapeHtml(region.name)}</strong></td><td>${region.count.toLocaleString('ko-KR')}</td><td>${(region.files || [region.file]).length}개 조각</td></tr>`).join('')}</tbody></table></div></article>`;
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
    $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('.sidebar').classList.remove('open');
    try {
      await ({ dashboard: renderDashboard, tasks: renderTasks, analytics: renderAnalytics, searchrankings: renderSearchRankings, useranalytics: renderUserAnalytics, members: renderMembers, reviews: renderReviews, userdata: renderUserData, activities: renderActivities, restaurants: renderRestaurants, logs: renderLogs }[view] || renderDashboard)();
    } catch (error) {
      if (error.status === 401) return showLogin();
      $('#admin-content').innerHTML = `<div class="empty-admin">${escapeHtml(error.message)}</div>`;
    }
  }

  function showLogin() {
    $('#admin-login').hidden = false;
    $('#admin-app').hidden = true;
  }

  async function enterAdmin() {
    sessionStorage.setItem('mukdang_admin_active', '1');
    $('#admin-login').hidden = true;
    $('#admin-app').hidden = false;
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
  $$('[data-view]').forEach(button => button.addEventListener('click', () => render(button.dataset.view)));
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
