const encoder = new TextEncoder();

const bytesToBase64Url = bytes => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = value => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

const timingSafeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
};

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createSession(secret, payload, maxAge = 60 * 60 * 24 * 7) {
  const data = bytesToBase64Url(encoder.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + maxAge })));
  const signature = bytesToBase64Url(await hmac(secret, data));
  return `${data}.${signature}`;
}

export async function readSession(secret, token) {
  if (!secret || !token) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;
  const expected = await hmac(secret, data);
  if (!timingSafeEqual(expected, base64UrlToBytes(signature))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(data)));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export function cookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export const sessionCookie = (name, value, maxAge = 60 * 60 * 24 * 7) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export const clearCookie = name =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt: bytesToBase64Url(salt) };
}

export async function verifyPassword(password, salt, expectedHash) {
  const result = await hashPassword(password, base64UrlToBytes(salt));
  return timingSafeEqual(base64UrlToBytes(result.hash), base64UrlToBytes(expectedHash));
}

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

export async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function currentUser(context) {
  const session = await readSession(context.env.SESSION_SECRET, cookie(context.request, 'mukdang_session'));
  if (!session?.userId) return null;
  return context.env.DB.prepare('SELECT id, email, name, role, status, created_at FROM users WHERE id = ?')
    .bind(session.userId).first();
}

export async function requireAdmin(context) {
  return readSession(context.env.SESSION_SECRET, cookie(context.request, 'mukdang_admin'));
}

export async function rateLimit(env, key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const record = await env.DB.prepare('SELECT failure_count, window_started FROM auth_attempts WHERE attempt_key = ?')
    .bind(key).first();
  if (!record || now - record.window_started > windowMs) return { allowed: true, remaining: limit };
  return { allowed: record.failure_count < limit, remaining: Math.max(0, limit - record.failure_count) };
}

export async function recordFailure(env, key, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const record = await env.DB.prepare('SELECT failure_count, window_started FROM auth_attempts WHERE attempt_key = ?')
    .bind(key).first();
  const expired = !record || now - record.window_started > windowMs;
  await env.DB.prepare(`INSERT INTO auth_attempts (attempt_key, failure_count, window_started)
    VALUES (?, ?, ?) ON CONFLICT(attempt_key) DO UPDATE SET
    failure_count = excluded.failure_count, window_started = excluded.window_started`)
    .bind(key, expired ? 1 : record.failure_count + 1, expired ? now : record.window_started).run();
}

export async function clearFailures(env, key) {
  await env.DB.prepare('DELETE FROM auth_attempts WHERE attempt_key = ?').bind(key).run();
}
