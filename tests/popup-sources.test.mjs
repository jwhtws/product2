import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPopupSourceOverview } from '../functions/_lib/popup-sources.js';

test('공식 소스와 전국 시설 지점을 수집기별로 결합한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{
      name: '타임스퀘어', currentCollector: '공식 쇼핑몰·마트 사이트맵', implementationStatus: 'partial',
      operator: '경방', eventUrl: 'https://source.test/events', officialUrl: 'https://source.test/', branches: ['서울 권역'], collectionMethod: 'sitemap'
    }] },
    coverage: { summary: { nationwideVenueTotal: 2 }, venues: [
      { venueId: 'v1', name: '타임스퀘어', collector: '타임스퀘어', status: 'verified-popup-found', popupCount: 2 },
      { venueId: 'v2', name: '기타몰', collector: null, status: 'collector-needed', popupCount: 0 }
    ] },
    venues: { venues: [{ id: 'v1', name: '타임스퀘어', region: '서울특별시', kind: '쇼핑몰', address: '서울 영등포구' }] },
    popupData: { updatedAt: '2026-08-05T00:00:00Z', sources: [{ name: '공식 쇼핑몰·마트 사이트맵', status: 'active', count: 2 }] }
  });

  assert.equal(result.summary.sourceCount, 1);
  assert.equal(result.summary.branchCount, 1);
  assert.equal(result.summary.unassignedVenueCount, 1);
  assert.equal(result.groups[0].collector, '공식 쇼핑몰·마트 사이트맵');
  assert.equal(result.groups[0].branches[0].address, '서울 영등포구');
  assert.equal(result.groups[0].branches[0].sourceUrl, 'https://source.test/events');
});

test('시설 매핑이 없는 전국 단위 소스도 수집 범위를 표시한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{ name: '롯데 공식 블로그', currentCollector: '롯데 공식 블로그', implementationStatus: 'active', eventUrl: 'https://blog.test/feed', branches: ['전국 운영망'] }] },
    popupData: { sources: [{ name: '롯데 공식 블로그', status: 'no-results', count: 0 }] }
  });

  assert.equal(result.summary.healthySourceCount, 1);
  assert.equal(result.groups[0].branches[0].name, '전국 운영망');
  assert.equal(result.groups[0].branches[0].sourceUrl, 'https://blog.lotte.co.kr/feed/');
});

test('지점 코드형 수집기는 실제 지점 엔드포인트를 제공한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{ name: '신세계백화점', currentCollector: '신세계백화점', implementationStatus: 'active', eventUrl: 'https://www.shinsegae.com/shopping/event/list.do' }] },
    coverage: { venues: [{ venueId: 's1', name: '(주)신세계 의정부점', collector: '신세계백화점', status: 'official-feed-monitored' }] },
    popupData: { sources: [{ name: '신세계백화점', status: 'active', count: 0 }] }
  });

  assert.equal(result.groups[0].endpoints.length, 13);
  assert.match(result.groups[0].branches[0].sourceUrl, /\/shopping\/list\.do\?.*storeCd=SC00010/u);
});

test('시설별 최신 갱신 추가 건수와 포함 원본 링크를 계산한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{ name: '테스트 소스', currentCollector: '테스트 브랜드', implementationStatus: 'active', eventUrl: 'https://brand.test/events' }] },
    coverage: { venues: [
      { venueId: 'v1', name: '테스트백화점 강남점', collector: '테스트 브랜드', status: 'verified-popup-found', popupCount: 3 },
      { venueId: 'v2', name: '테스트백화점 부산점', collector: '테스트 브랜드', status: 'official-feed-monitored', popupCount: 0 }
    ] },
    popupData: { sources: [{ name: '테스트 브랜드', status: 'active', count: 3 }], popups: [
      { venue: '테스트백화점 강남점', firstSeenAt: '2026-08-12', sourceUrl: 'https://brand.test/popup/1' },
      { branch: '테스트백화점 강남점', firstSeenAt: '2026-08-12', officialUrl: 'https://brand.test/popup/2' },
      { venue: '테스트백화점 강남점', firstSeenAt: '2026-08-10', sourceUrl: 'https://brand.test/popup/old' }
    ] }
  });

  assert.equal(result.latestAddedAt, '2026-08-12');
  assert.equal(result.groups[0].branches[0].addedCount, 2);
  assert.deepEqual(result.groups[0].branches[0].includedUrls, [
    'https://brand.test/popup/1', 'https://brand.test/popup/2', 'https://brand.test/popup/old'
  ]);
  assert.equal(result.groups[0].branches[1].addedCount, 0);
});

test('AK플라자 백화점과 쇼핑몰 9개 지점의 공식 쇼핑뉴스 링크를 제공한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{ name: 'AK플라자', currentCollector: 'AK플라자', implementationStatus: 'active' }] },
    popupData: { sources: [{ name: 'AK플라자', status: 'active', count: 5 }] }
  });

  assert.equal(result.groups[0].endpoints.length, 9);
  assert.ok(result.groups[0].endpoints.some(item => item.label === 'AK플라자 수원점' && /category=11&store=02/u.test(item.url)));
  assert.ok(result.groups[0].endpoints.some(item => item.label === 'AK플라자 세종점' && /category=11&store=53/u.test(item.url)));
});

test('롯데백화점 지점명에 맞는 공식 지점 코드를 연결한다', () => {
  const result = buildPopupSourceOverview({
    registry: { sources: [{ name: '롯데', currentCollector: '롯데백화점·롯데아울렛·롯데몰', implementationStatus: 'active' }] },
    coverage: { venues: [
      { venueId: 'main', name: '롯데백화점 본점', collector: '롯데백화점·롯데아울렛·롯데몰' },
      { venueId: 'gwangbok', name: '롯데백화점 광복점', collector: '롯데백화점·롯데아울렛·롯데몰' }
    ] }
  });

  const branches = new Map(result.groups[0].branches.map(branch => [branch.name, branch.sourceUrl]));
  assert.match(branches.get('롯데백화점 본점'), /\/store\/main\?cstrCd=0001/u);
  assert.match(branches.get('롯데백화점 광복점'), /\/store\/main\?cstrCd=0333/u);
  assert.doesNotMatch(branches.get('롯데백화점 본점'), /cstrCd=0333/u);
});

test('운영콘솔의 지점 수집처는 내부 JSON API가 아닌 사람이 열 수 있는 공식 페이지다', () => {
  const collectors = ['롯데백화점·롯데아울렛·롯데몰', '신세계백화점', '스타필드·스타필드시티', '갤러리아', 'AK플라자'];
  for (const collector of collectors) {
    const group = buildPopupSourceOverview({
      registry: { sources: [{ name: collector, currentCollector: collector, implementationStatus: 'active' }] }
    }).groups[0];
    for (const item of group.endpoints.filter(endpoint => endpoint.branch)) {
      assert.doesNotMatch(item.url, /\/api\/|ajaxList\.do|search\/searchResult/iu, `${collector}: ${item.label}`);
      assert.match(item.url, /^https:\/\//u, `${collector}: ${item.label}`);
    }
  }
});

test('모든 지점 전용 엔드포인트는 같은 매장에만 연결하고 미지원 매장에는 다른 지점 링크를 쓰지 않는다', () => {
  const collectors = ['롯데백화점·롯데아울렛·롯데몰', '신세계백화점', '스타필드·스타필드시티', '갤러리아', 'AK플라자'];

  for (const collector of collectors) {
    const discovery = buildPopupSourceOverview({
      registry: { sources: [{ name: collector, currentCollector: collector, implementationStatus: 'active' }] }
    }).groups[0];
    const branchEndpoints = discovery.endpoints.filter(item => item.branch);
    const coverage = branchEndpoints.map((item, index) => ({
      venueId: `${collector}:${index}`,
      name: item.branch,
      collector
    }));
    coverage.push({ venueId: `${collector}:unsupported`, name: `${collector} 미지원테스트점`, collector });

    const group = buildPopupSourceOverview({
      registry: { sources: [{ name: collector, currentCollector: collector, implementationStatus: 'active' }] },
      coverage: { venues: coverage }
    }).groups[0];
    const endpointByBranch = new Map();
    for (const item of branchEndpoints) {
      if (!endpointByBranch.has(item.branch)) endpointByBranch.set(item.branch, item.url);
    }
    for (const branch of group.branches) {
      if (branch.name.endsWith('미지원테스트점')) assert.equal(branch.sourceUrl, '');
      else assert.equal(branch.sourceUrl, endpointByBranch.get(branch.name), `${collector}: ${branch.name}`);
    }
  }
});
