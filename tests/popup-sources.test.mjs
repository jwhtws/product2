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
  assert.equal(result.groups[0].branches[0].sourceUrl, 'https://www.hdc-iparkmall.com/robots.txt');
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
  assert.match(result.groups[0].branches[0].sourceUrl, /storeCd=SC00010/u);
});
