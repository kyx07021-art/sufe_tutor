const base = 'https://sufe-tutor.pages.dev';
const lr = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin_sufe', password: 'admin_sufe', deviceId: 'probe-log3' }) });
const lj = await lr.json();
const resp = await fetch(base + '/api/admin/logs?page=1', { headers: { 'X-Auth-Token': lj.authToken } });
const d = await resp.json();
const logs = d.logs || d.items || [];
for (const l of logs.slice(0, 8)) console.log(JSON.stringify(l).slice(0, 260));
console.log('count:', logs.length);
