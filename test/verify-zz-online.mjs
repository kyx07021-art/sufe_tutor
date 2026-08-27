/**
 * ZZ-7 线上验证（2026-08-27）：核验列表元数据化 + 单点取图端点生产实测。
 * 用户原话：「学信网核验列表不再先加载全量图片，连缩略图也不加载，而是点开一个图片再加载并留存一个大图，把加载工作拆分开来」。
 *
 * 用法：ADMIN_PASSWORD=<口令> node test/verify-zz-online.mjs [BASE=https://sufe-tutor.pages.dev]
 * （口令经 env 注入，绝不硬编码/入仓库；用户名 ADMIN_USER 可覆盖，默认 admin_sufe_07210）
 *
 * 断言：
 *  1. POST /api/auth/login 200 authToken（worker 挂载 = 非 405）
 *  2. GET /api/admin/verifications 200：每行零 admission_image 键（ZZ-1 列表元数据化）+ 响应 KB 级（< 50KB）
 *  3. GET /api/admin/verifications/:id/image 200：返回 admission_image 大图（ZZ-1 单点取图）——取列表第一条
 *  4. GET /api/admin/verifications/999999/image 404（非法 id 先于解密）
 *  5. 错误密码 login 400 AUTH_LOGIN_FAILED（对照，健康基线）
 *  6. GET /api/health 200 ready（版本探针侧）
 */
const BASE = process.argv[2] || 'https://sufe-tutor.pages.dev';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const USER = process.env.ADMIN_USER || 'admin_sufe_07210';
if (!PASSWORD) { console.error('ADMIN_PASSWORD env required'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`✖ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers['X-Auth-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, ms, json };
}

const login = await req('/api/auth/login', { method: 'POST', body: { identifier: USER, password: PASSWORD } });
ok('登录 200 authToken（worker 挂载非 405）', login.status === 200 && login.json && login.json.authToken, `status=${login.status} ms=${login.ms}`);
if (login.status !== 200 || !login.json?.authToken) {
  console.log('  登录失败响应:', JSON.stringify(login.json).slice(0, 200));
  console.log(`\n${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
}
const token = login.json.authToken;

const health = await req('/api/health');
ok('health 200 ready', health.status === 200 && health.json?.ready === true, `status=${health.status}`);

const bad = await req('/api/auth/login', { method: 'POST', body: { identifier: USER, password: 'wrong-pw-zz' } });
ok('错误密码 401 AUTH_LOGIN_FAILED', bad.status === 401 && bad.json?.code === 'AUTH_LOGIN_FAILED', `status=${bad.status} code=${bad.json?.code}`);

const list = await req('/api/admin/verifications', { token });
const rows = list.json?.verifications || [];
ok('核验列表 200', list.status === 200, `status=${list.status} ms=${list.ms}`);
ok('列表行零 admission_image 键（ZZ-1 元数据化）', rows.every(r => !('admission_image' in r)), `rows=${rows.length}`);
const listBytes = JSON.stringify(list.json).length;
ok('列表体量 KB 级（< 50KB）', listBytes < 50 * 1024, `${(listBytes / 1024).toFixed(1)}KB`);

let imgOk = '跳过（列表空）';
if (rows.length) {
  const first = rows[0];
  const img = await req(`/api/admin/verifications/${first.id}/image`, { token });
  const hasImg = img.status === 200 && typeof img.json?.admission_image === 'string';
  imgOk = `id=${first.id} status=${img.status} imgLen=${img.json?.admission_image?.length ?? 0}`;
  ok('单点取图端点 200 + admission_image 在场（ZZ-1）', hasImg, imgOk);
  const miss = await req('/api/admin/verifications/999999/image', { token });
  ok('非法 id 404', miss.status === 404, `status=${miss.status}`);
} else {
  ok('单点取图端点（列表空，仅验证 404 分支）', (await req('/api/admin/verifications/999999/image', { token })).status === 404);
  console.log('  注：生产核验列表为空（ZZ 后新提交前），单点取图 200 分支由单测覆盖');
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
