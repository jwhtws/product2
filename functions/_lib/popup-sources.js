const ACTIVE_IMPLEMENTATIONS = new Set(['active', 'partial']);
const HEALTHY_RUNTIME_STATUSES = new Set(['active', 'no-results']);

const unique = values => [...new Set(values.filter(Boolean))];
const endpoint = (label, url, scope = '', branch = '') => ({ label, url, scope, branch });

const COLLECTOR_ENDPOINTS = Object.freeze({
  '현대백화점·현대아울렛': [
    endpoint('전 지점 통합 검색', 'https://www.ehyundai.com/newPortal/search/result.do', '식품 키워드 10종 · 행사 검색 최대 50페이지')
  ],
  '롯데백화점·롯데아울렛·롯데몰': [
    ['0001', '롯데백화점 본점'], ['0022', '롯데백화점 노원점'], ['0027', '롯데백화점 센텀시티점'],
    ['0028', '롯데백화점 건대스타시티점'], ['0333', '롯데백화점 광복점'], ['0336', '롯데백화점 안산점'],
    ['0342', '롯데아울렛 청주점'], ['0344', '롯데백화점 인천점'], ['0399', '롯데백화점 동탄점']
  ].map(([code, branch]) => endpoint(branch, `https://m.lotteshopping.com/search/searchResult?cstrCd=${code}&searchTerm=-`, `cstrCd=${code} · 공식 쇼핑뉴스 검색`, branch)),
  '신세계백화점': [
    ['SC00002', '강남점'], ['SC00006', '광주신세계'], ['SC00011', '김해점'], ['SC00013', '대구신세계'],
    ['SC00060', '대전신세계 Art & Science'], ['SC00005', '마산점'], ['SC00001', '본점'], ['SC00008', '센텀시티점'],
    ['SC00012', '스타필드 하남점'], ['SC00007', '사우스시티점'], ['SC00010', '의정부점'], ['SC00009', '천안아산점'], ['SC00003', '타임스퀘어점']
  ].map(([code, branch]) => endpoint(`신세계백화점 ${branch}`, `https://www.shinsegae.com/shopping/ajaxList.do?mainCd=02&storeCd=${code}`, `storeCd=${code}`, `신세계백화점 ${branch}`)),
  '스타필드·스타필드시티': [
    ['hanam', '스타필드 하남'], ['goyang', '스타필드 고양'], ['anseong', '스타필드 안성'], ['suwon', '스타필드 수원'],
    ['coexmall', '스타필드 코엑스몰'], ['wirye', '스타필드시티 위례'], ['bucheon', '스타필드시티 부천'], ['myeongji', '스타필드시티 명지']
  ].map(([slug, branch]) => endpoint(branch, `https://www.starfield.co.kr/api/${slug}/event/eventList.do?evt_gbn=event&lang=ko&pageIndex=1`, `지점 API · 전체 페이지 순회`, branch)).concat([
    endpoint('스타필드 수원 바이츠 플레이스', 'https://www.starfield.co.kr/suwon/tenant/floorInfo', '수원 층별안내 보조 수집', '스타필드 수원')
  ]),
  '갤러리아': [
    ['luxuryhall', '갤러리아 명품관'], ['timeworld', '갤러리아 타임월드'], ['gwanggyo', '갤러리아 광교'], ['centercity', '갤러리아 센터시티'], ['jinju', '갤러리아 진주']
  ].map(([slug, branch]) => endpoint(branch, `https://dept.galleria.co.kr/store-info/${slug}/promotion/shopping-news?qCategory=NEWOPENING_POPUP`, 'NEWOPENING_POPUP 쇼핑뉴스', branch)),
  'AK플라자': [
    ['02', '수원'], ['03', '분당'], ['04', '평택'], ['05', '원주'],
    ['11', '광명'], ['12', '금정'], ['51', '홍대'], ['52', '기흥'], ['53', '세종']
  ].map(([code, name]) => endpoint(`AK플라자 ${name}점`, `https://www.akplaza.com/board/news/list?category=11&store=${code}`, `쇼핑뉴스 전 페이지 · store=${code}`, `AK플라자 ${name}점`)),
  'NC·뉴코아': [endpoint('이랜드리테일 전 지점 목록', 'https://www.elandretail.com/store01.do', '지점 ID 자동 발견 후 각 지점 쇼핑뉴스 순회')],
  '아이파크몰': [endpoint('아이파크몰 공식 이벤트', 'https://www.hdc-iparkmall.com/event', '용산점 공식 이벤트')],
  '이마트·트레이더스': [
    endpoint('이마트 공식 이벤트', 'https://store.emart.com/event/event.do', '이마트 전점'),
    endpoint('트레이더스 공식 이벤트', 'https://store.emart.com/event/traders.do', '트레이더스 전점'),
    endpoint('이마트 공식 공지', 'https://store.emart.com/news/notice_list.do', '이마트 전점')
  ],
  '롯데마트': [endpoint('롯데마트 공식 행사', 'https://company.lottemart.com/en/event_list.asp', '롯데마트 전점')],
  '홈플러스': [endpoint('홈플러스 공식 공지', 'https://corporate.homeplus.co.kr/Business/Hyper_Notice.aspx', '홈플러스 전점')],
  '공식 쇼핑몰·마트 사이트맵': [
    'www.hdc-iparkmall.com', 'store.emart.com', 'company.lottemart.com', 'corporate.homeplus.co.kr', 'www.akplaza.com', 'www.timessquare.co.kr', 'www.shinsegae.com'
  ].map(domain => endpoint(`${domain} robots.txt`, `https://${domain}/robots.txt`, '공식 sitemap URL 자동 발견')),
  '롯데 공식 블로그': [endpoint('롯데 공식 블로그 RSS', 'https://blog.lotte.co.kr/feed/', '공식 글에서 행사·지점 추출')]
});

const normalizedBranch = value => String(value || '').toLocaleLowerCase('ko-KR')
  .replace(/\(주\)|주식회사|롯데쇼핑|롯데|신세계|이마트|한화|백화점|프리미엄|아울렛|스타필드시티|스타필드|시티|갤러리아|ak플라자|에이케이플라자/gu, '')
  .replace(/[^0-9a-z가-힣]/giu, '');

export function buildPopupSourceOverview({ registry = {}, coverage = {}, venues = {}, popupData = {} } = {}) {
  const registrySources = Array.isArray(registry.sources) ? registry.sources : [];
  const coverageVenues = Array.isArray(coverage.venues) ? coverage.venues : [];
  const venueRows = Array.isArray(venues.venues) ? venues.venues : [];
  const runtimeSources = Array.isArray(popupData.sources) ? popupData.sources : [];
  const popupRows = Array.isArray(popupData.popups) ? popupData.popups : [];
  const latestAddedAt = popupRows.reduce((latest, item) =>
    /^\d{4}-\d{2}-\d{2}$/.test(item.firstSeenAt) && item.firstSeenAt > latest ? item.firstSeenAt : latest, '');
  const activeRegistrySources = registrySources.filter(source =>
    source.currentCollector && ACTIVE_IMPLEMENTATIONS.has(source.implementationStatus));
  const collectorAliases = new Map(activeRegistrySources.map(source => [source.name, source.currentCollector]));
  const venueById = new Map(venueRows.map(venue => [venue.id, venue]));
  const runtimeByName = new Map(runtimeSources.map(source => [source.name, source]));
  const collectors = new Set([
    ...runtimeSources.map(source => source.name),
    ...activeRegistrySources.map(source => source.currentCollector)
  ].filter(Boolean));
  const branchesByCollector = new Map();

  for (const item of coverageVenues) {
    if (!item.collector) continue;
    const collector = collectorAliases.get(item.collector) || item.collector;
    collectors.add(collector);
    if (!branchesByCollector.has(collector)) branchesByCollector.set(collector, []);
    const detail = venueById.get(item.venueId) || {};
    branchesByCollector.get(collector).push({
      id: item.venueId || detail.id || `${collector}:${item.name}`,
      sourceName: item.collector,
      name: item.name || detail.name || '이름 미확인 지점',
      region: item.region || detail.region || '',
      kind: item.kind || detail.kind || '',
      address: detail.address || '',
      status: item.status || 'unknown',
      popupCount: Number(item.popupCount || 0),
      registryUpdatedAt: detail.updatedAt || ''
    });
  }

  const groups = [...collectors].map(collector => {
    const sources = activeRegistrySources.filter(source => source.currentCollector === collector);
    const runtime = runtimeByName.get(collector) || {};
    const urls = [];
    for (const source of sources) {
      if (source.eventUrl) urls.push({ label: `${source.name} 수집`, url: source.eventUrl, type: 'event' });
      if (source.officialUrl && source.officialUrl !== source.eventUrl) urls.push({ label: `${source.name} 공식`, url: source.officialUrl, type: 'official' });
    }
    const dedupedUrls = urls.filter((item, index) => urls.findIndex(candidate => candidate.url === item.url) === index);
    const endpoints = COLLECTOR_ENDPOINTS[collector] || [];
    let branches = branchesByCollector.get(collector) || [];
    if (!branches.length) {
      branches = unique(sources.flatMap(source => source.branches || [])).map((name, index) => ({
        id: `${collector}:scope:${index}`,
        name,
        region: '',
        kind: '수집 범위',
        address: '',
        status: sources.some(source => source.implementationStatus === 'active') ? 'official-feed-monitored' : 'adapter-needed',
        popupCount: 0,
        registryUpdatedAt: ''
      }));
    }
    branches = branches.map(branch => {
      const branchKey = normalizedBranch(branch.name);
      const branchRegistrySource = sources.find(source => source.name === branch.sourceName);
      const branchRegistryUrl = branchRegistrySource?.eventUrl || branchRegistrySource?.officialUrl || '';
      const matchingEndpoint = endpoints.find(item => {
        const endpointKey = normalizedBranch(item.branch);
        return endpointKey && branchKey && endpointKey === branchKey;
      });
      const matchingPopups = popupRows.filter(item => {
        const popupBranchKey = normalizedBranch(item.branch || item.venue);
        return branchKey && popupBranchKey && (popupBranchKey.includes(branchKey) || branchKey.includes(popupBranchKey));
      });
      const includedUrls = unique(matchingPopups.map(item => item.sourceUrl || item.officialUrl));
      return {
        ...branch,
        addedCount: matchingPopups.filter(item => item.firstSeenAt === latestAddedAt).length,
        includedUrls,
        sourceUrl: matchingEndpoint?.url
          || branchRegistryUrl
          || (endpoints.length === 1 && !endpoints[0].branch ? endpoints[0].url : '')
          || (sources.length === 1 ? dedupedUrls[0]?.url : '')
          || ''
      };
    })
      .sort((left, right) => String(left.region).localeCompare(String(right.region), 'ko-KR') || String(left.name).localeCompare(String(right.name), 'ko-KR'));
    return {
      collector,
      operator: unique(sources.map(source => source.operator)).join(', '),
      sourceNames: unique(sources.map(source => source.name)),
      collectionMethods: unique(sources.map(source => source.collectionMethod)),
      implementationStatus: sources.some(source => source.implementationStatus === 'active') ? 'active' : sources[0]?.implementationStatus || 'unknown',
      runtimeStatus: runtime.status || 'unknown',
      runtimeCount: Number(runtime.count || 0),
      lastVerifiedAt: sources.map(source => source.lastVerifiedAt || '').sort().at(-1) || '',
      priority: sources.map(source => source.priority).find(Boolean) || '',
      urls: dedupedUrls,
      endpoints,
      branches
    };
  }).sort((left, right) => {
    const leftHealthy = HEALTHY_RUNTIME_STATUSES.has(left.runtimeStatus) ? 0 : 1;
    const rightHealthy = HEALTHY_RUNTIME_STATUSES.has(right.runtimeStatus) ? 0 : 1;
    return leftHealthy - rightHealthy || right.runtimeCount - left.runtimeCount || left.collector.localeCompare(right.collector, 'ko-KR');
  });

  return {
    updatedAt: popupData.updatedAt || coverage.updatedAt || registry.lastUpdatedAt || venues.updatedAt || null,
    latestAddedAt: latestAddedAt || null,
    summary: {
      sourceCount: groups.length,
      branchCount: groups.reduce((sum, group) => sum + group.branches.length, 0),
      healthySourceCount: groups.filter(group => HEALTHY_RUNTIME_STATUSES.has(group.runtimeStatus)).length,
      popupCount: groups.reduce((sum, group) => sum + group.runtimeCount, 0),
      adapterNeededCount: coverageVenues.filter(item => item.status === 'adapter-needed').length,
      unassignedVenueCount: coverageVenues.filter(item => !item.collector).length,
      nationwideVenueTotal: Number(coverage.summary?.nationwideVenueTotal || coverageVenues.length || 0)
    },
    groups
  };
}
