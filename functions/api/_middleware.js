import { json } from '../_lib/auth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function onRequest(context) {
  const requestId = crypto.randomUUID();
  const origin = context.request.headers.get('origin');
  const expectedOrigin = new URL(context.request.url).origin;
  if (!SAFE_METHODS.has(context.request.method) && origin && origin !== expectedOrigin) {
    return json({ error: '허용되지 않은 요청 출처입니다.', code: 'INVALID_ORIGIN' }, 403, { 'x-request-id': requestId });
  }
  try {
    const response = await context.next();
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('x-request-id', requestId);
    return response;
  } catch (error) {
    console.error(JSON.stringify({ requestId, path: new URL(context.request.url).pathname, error: String(error?.stack || error) }));
    return json({ error: '서버 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' }, 500, { 'x-request-id': requestId });
  }
}
