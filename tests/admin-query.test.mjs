import assert from 'node:assert/strict';
import test from 'node:test';
import { likePattern, listParams, page, positiveId } from '../functions/_lib/admin-query.js';

test('목록 요청은 안전한 크기와 커서를 사용한다', () => {
  const result = listParams(new Request('https://admin.test/list?limit=999&cursor=42&q=%20kim%20'));
  assert.deepEqual(result, { limit: 100, cursor: 42, query: 'kim' });
});

test('페이지 응답은 다음 커서를 만든다', () => {
  const result = page([{ id: 3 }, { id: 2 }, { id: 1 }], 2);
  assert.deepEqual(result, {
    items: [{ id: 3 }, { id: 2 }],
    page: { hasMore: true, nextCursor: 2 }
  });
});

test('LIKE 검색 특수문자와 ID를 검증한다', () => {
  assert.equal(likePattern('a_b%'), '%a\\_b\\%%');
  assert.equal(positiveId('12'), 12);
  assert.equal(positiveId('-1'), null);
  assert.equal(positiveId('not-a-number'), null);
});
