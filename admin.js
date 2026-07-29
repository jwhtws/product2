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
      await ({ dashboard: renderDashboard, members: renderMembers, reviews: renderReviews, userdata: renderUserData, activities: renderActivities, restaurants: renderRestaurants, logs: renderLogs }[view] || renderDashboard)();
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
