import { body, clearCookie, createSession, json, requireAdmin, sessionCookie } from '../../_lib/auth.js';

async function audit(context, action, detail) {
  await context.env.DB.prepare('INSERT INTO admin_logs (action, detail, created_at) VALUES (?, ?, ?)')
    .bind(action, detail, Date.now()).run();
}

export async function onRequest(context) {
  const path = Array.isArray(context.params.path) ? context.params.path.join('/') : (context.params.path || '');
  const method = context.request.method;

  if (method === 'POST' && path === 'login') {
    const data = await body(context.request);
    if (!context.env.ADMIN_PASSWORD || String(data.code || '') !== context.env.ADMIN_PASSWORD) {
      return json({ error: '관리자 코드가 올바르지 않습니다.' }, 401);
    }
    const token = await createSession(context.env.SESSION_SECRET, { admin: true }, 60 * 60 * 12);
    await audit(context, '관리자 로그인', 'Cloudflare 관리 콘솔');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('mukdang_admin', token, 60 * 60 * 12) });
  }
  if (method === 'POST' && path === 'logout') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie('mukdang_admin') });
  }
  const session = await requireAdmin(context);
  if (!session?.admin) return json({ error: '관리자 로그인이 필요합니다.' }, 401);
  if (method === 'GET' && path === 'session') return json({ authenticated: true });

  if (method === 'GET' && path === 'dashboard') {
    const [members, reviews, recent] = await context.env.DB.batch([
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM users'),
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM reviews'),
      context.env.DB.prepare('SELECT COUNT(*) AS count FROM reviews WHERE created_at >= ?').bind(Date.now() - 7 * 86400000)
    ]);
    return json({ members: members.results[0].count, reviews: reviews.results[0].count, recentReviews: recent.results[0].count });
  }
  if (method === 'GET' && path === 'members') {
    const result = await context.env.DB.prepare('SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 500').all();
    return json({ members: result.results });
  }
  if (method === 'PATCH' && path.startsWith('members/')) {
    const id = Number(path.split('/')[1]), data = await body(context.request);
    if (data.status && ['active', 'suspended'].includes(data.status)) {
      await context.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(data.status, id).run();
      await audit(context, '회원 상태 변경', `회원 ${id}: ${data.status}`);
    } else if (data.role && ['member', 'admin'].includes(data.role)) {
      await context.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(data.role, id).run();
      await audit(context, '회원 권한 변경', `회원 ${id}: ${data.role}`);
    } else return json({ error: '변경할 값이 없습니다.' }, 400);
    return json({ ok: true });
  }
  if (method === 'DELETE' && path.startsWith('members/')) {
    const id = Number(path.split('/')[1]);
    await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    await audit(context, '회원 삭제', `회원 ${id}`);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'reviews') {
    const result = await context.env.DB.prepare(`SELECT reviews.*, users.name AS author FROM reviews
      JOIN users ON users.id = reviews.user_id ORDER BY created_at DESC LIMIT 500`).all();
    return json({ reviews: result.results });
  }
  if (method === 'PATCH' && path.startsWith('reviews/')) {
    const id = Number(path.split('/')[1]), data = await body(context.request);
    await context.env.DB.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').bind(data.hidden ? 1 : 0, id).run();
    await audit(context, '리뷰 공개 상태 변경', `리뷰 ${id}: ${data.hidden ? '숨김' : '공개'}`);
    return json({ ok: true });
  }
  if (method === 'DELETE' && path.startsWith('reviews/')) {
    const id = Number(path.split('/')[1]);
    await context.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
    await audit(context, '리뷰 삭제', `리뷰 ${id}`);
    return json({ ok: true });
  }
  if (method === 'GET' && path === 'logs') {
    const result = await context.env.DB.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200').all();
    return json({ logs: result.results });
  }
  return json({ error: 'Not found' }, 404);
}
