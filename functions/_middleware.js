const PRIVATE_HEADERS = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === 'admin.mukdang.com' && url.pathname === '/') {
    const headers = new Headers(PRIVATE_HEADERS);
    headers.set('Cache-Control', 'no-store');
    headers.set('Location', `${url.origin}/ops-7c4e91b6`);
    return new Response(null, { status: 308, headers });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  Object.entries(PRIVATE_HEADERS).forEach(([name, value]) => headers.set(name, value));
  headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
