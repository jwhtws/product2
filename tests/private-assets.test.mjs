import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/_middleware.js';

test('내부 문서와 배포 설정 파일 요청을 404 처리한다', async () => {
  for (const pathname of ['/MASTER_PLAN.md', '/AUDIT_PRODUCT2.MD', '/package.json', '/migrations/0001_admin_scale_indexes.sql']) {
    let continued = false;
    const response = await onRequest({
      request: new Request(`https://admin.test${pathname}`),
      next: async () => { continued = true; return new Response('public'); }
    });

    assert.equal(response.status, 404, pathname);
    assert.equal(await response.text(), 'Not Found', pathname);
    assert.equal(response.headers.get('cache-control'), 'no-store', pathname);
    assert.equal(continued, false, pathname);
  }
});
