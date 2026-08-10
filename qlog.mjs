// 查留档 http 日志：找用户出 bug 那次的慢请求
const BASE = 'https://sufe-tutor.pages.dev';
const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin_sufe', password: 'admin_sufe', deviceId: 'qlog' }) });
const ld = await login.json();
const h = { 'X-Auth-Token': ld.authToken };
// 最近 6 小时 http 留档，取慢的（durationMs > 3000）
const r = await fetch(BASE + '/api/admin/logs?action=http.&since=2026-08-10+00:00:00&limit=300', { headers: h });
const d = await r.json();
const rows = d.rows || [];
console.log('total http logs:', d.total, 'fetched:', rows.length);
const slow = rows.filter(x => (x.duration_ms || 0) > 3000);
console.log('slow(>3s):', slow.length);
for (const s of slow) console.log(JSON.stringify({ id: s.id, ts: s.ts, action: s.action, ms: s.duration_ms, det: s.detail && s.detail.path }));
// 前 20 条最近的
console.log('--- recent 20 ---');
for (const rw of rows.slice(0, 20)) console.log(JSON.stringify({ ts: rw.ts, action: rw.action, ms: rw.duration_ms, path: rw.detail && rw.detail.path, actor: rw.actor_username || '-' }));
