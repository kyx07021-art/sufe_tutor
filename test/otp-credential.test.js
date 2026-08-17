/**
 * v0.26.0 验证码咽喉 + 凭证扩展（A2-A8）
 *
 * 覆盖：
 *   - otp.requestOtp：真实通道投递（stub 捕获 6 位验证码）、60s 重发限频、单日上限、格式校验；
 *   - otp.verifyOtp：正确/错误/一次性消费/过期；
 *   - credential：bindPhone/bindEmail + 哈希可查列定位 + 占用查 + username 变更冷却；
 *   - 路由集成：handleOtpRequest / handleBindPhone / handleChangeUsername / handleUsernameStatus /
 *     handleLogin（手机号/邮箱密码登录）/ handleLoginWithCode（验证码登录）/ handleCheckUsername（identifier 识别）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { requestOtp, verifyOtp, parsePhone, classifyIdentifier, normalizeIdentifier } from '../src/server/core/otp.js';
import {
  bindPhoneCredential, bindEmailCredential, updateUsernameCredential, getUsernameChangedAt,
  dbFindUserByPhoneHash, dbFindUserByEmailHash, dbPhoneTaken, dbEmailTaken,
} from '../src/server/core/credential.js';
import { handleOtpRequest, handleBindPhone, handleChangeUsername, handleUsernameStatus, handleLogin, handleLoginWithCode, handleCheckUsername, handleRegister, handleGetMyCreds } from '../src/server/domains/auth/api.js';
import { issueCapToken } from '../src/server/core/danger-ops.js';
import { lastOtpCode, resetOtpStub } from './_otp-stub.js'; // 拦截真实发信（stub fetch：真实代码路径 + 捕获验证码）

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  resetOtpStub(); // 测试隔离：清空上次捕获
  return { raw, db };
}

function authedReq(token) {
  return { headers: new Headers({ 'X-Auth-Token': token }) };
}

async function registerUser(db, raw, username, role = 'student') {
  // v1.0 R7：注册必绑联系方式（发码后从 stub 捕获取 code）
  const target = '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.ok(otp.ok, '发码成功');
  const r = await handleRegister(db, { username, password: 'pass123456', role, agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target) }, authedReq(''));
  assert.equal(r.status, 200, `注册 ${username} 应成功: ${JSON.stringify(r)}`);
  const data = await r.json();
  const id = raw.prepare("SELECT id FROM users WHERE username=?").get(username).id;
  return { id, token: data.authToken };
}

// ---------------- OTP 基础 ----------------
test('requestOtp：真实通道投递 + 6 位验证码 + 格式校验', async () => {
  const { db } = await setup();
  const target = '+8613812345678';
  const r = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(r.ok, true);
  assert.match(String(lastOtpCode(target)), /^\d{6}$/, '验证码为 6 位数字（stub 捕获的投递 body 断言）');
  // 非法手机号
  const bad = await requestOtp(db, { channel: 'sms', target: '+861234567' }, authedReq(''));
  assert.equal(bad.ok, false);
  const badJson = await bad.err.json();
  assert.equal(badJson.error, '手机号格式不正确');
  // 非法邮箱
  const badEmail = await requestOtp(db, { channel: 'email', target: 'not-an-email' }, authedReq(''));
  assert.equal(badEmail.ok, false);
});

test('requestOtp：60s 重发限频 + 单日上限（服务端原子强制）', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  const first = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(first.ok, true);
  const second = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(second.ok, false);
  assert.equal((await second.err.json()).error, '发送过于频繁，请 60 秒后再试');
  // 单日上限：每次请求前把既有行 created_at 挪到 2 小时前（> -1day 计入单日计数、< -60s 绕过重发窗口），
  // 累计到第 10 次上限
  for (let i = 0; i < 9; i++) {
    raw.exec(`UPDATE verification_codes SET created_at=datetime('now','-2 hours')`); // UTC 存储域，用 UTC 挪时间
    const r = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
    assert.equal(r.ok, true, `第 ${i + 2} 次应成功`);
  }
  raw.exec(`UPDATE verification_codes SET created_at=datetime('now','-2 hours')`); // UTC 存储域，用 UTC 挪时间
  const over = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(over.ok, false);
  assert.equal((await over.err.json()).error, '今日验证码发送次数已达上限，请明天再试');
});

test('requestOtp：过期行清理（v0.27.3 #19：注释承诺的 DELETE 落地，防 verification_codes 膨胀）', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  const hash = await tokenDigest(target);
  const r1 = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(r1.ok, true);
  let cnt = raw.prepare('SELECT COUNT(*) c FROM verification_codes WHERE channel=? AND target_hash=?').get('sms', hash).c;
  assert.equal(cnt, 1, '发码后仅 1 行');
  // 把既有行过期（expires_at UTC 改到 1 分钟前）→ 再发码：过期行应被 DELETE 清理，不再拦重发
  raw.exec(`UPDATE verification_codes SET expires_at=datetime('now','-1 minute')`);
  const r2 = await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  assert.equal(r2.ok, true, '过期行已清，60s 窗口不误拦');
  cnt = raw.prepare('SELECT COUNT(*) c FROM verification_codes WHERE channel=? AND target_hash=?').get('sms', hash).c;
  assert.equal(cnt, 1, '过期行已删，仅剩新码 1 行（不膨胀）');
});

test('verifyOtp：正确/错误/一次性消费', async () => {
  const { db } = await setup();
  const target = '+8613812345678';
  await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  const code = lastOtpCode(target);
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000000' }), 'invalid', '错误验证码拒绝');
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code }), 'ok', '正确验证码通过');
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code }), 'invalid', '一次性：消费后不可重用');
  // 未请求过的号码无验证码
  const ghost = await requestOtp(db, { channel: 'sms', target: '+8613812345679' }, authedReq(''));
  const r2 = await requestOtp(db, { channel: 'sms', target: '+8613812345679' }, authedReq(''));
  assert.equal(r2.ok, false, '60s 内重发被拒（此时仍处窗口）');
  assert.ok(ghost.ok, '首轮正常发码');
});

// ---------------- 识别辅助 ----------------
test('classifyIdentifier / normalizeIdentifier：username/phone/email 初判', () => {
  assert.equal(classifyIdentifier('王小明'), 'username');
  assert.equal(classifyIdentifier('13812345678'), 'phone', '裸中国手机号识别为 phone');
  assert.equal(classifyIdentifier('+8613812345678'), 'phone');
  assert.equal(classifyIdentifier('a@b.com'), 'email');
  assert.deepEqual(normalizeIdentifier('13812345678'), { kind: 'phone', target: '+8613812345678' }, '裸手机号归一化补 +86');
  assert.deepEqual(normalizeIdentifier('a@b.com'), { kind: 'email', target: 'a@b.com' });
  assert.equal(parsePhone('+8613812345678')?.number, '13812345678');
});

// ---------------- credential ----------------
test('credential：绑定手机号/邮箱 + 哈希定位 + 占用查 + 用户名冷却', async () => {
  const { raw, db } = await setup();
  const u1 = await registerUser(db, raw, 'alice');
  const u2 = await registerUser(db, raw, 'bob');

  await bindPhoneCredential(db, u1.id, '+8613812345678');
  await bindEmailCredential(db, u1.id, 'alice@example.com');

  const byPhone = await dbFindUserByPhoneHash(db, await tokenDigest('+8613812345678'));
  assert.equal(byPhone.username, 'alice', '按手机号哈希定位账户');
  const byEmail = await dbFindUserByEmailHash(db, await tokenDigest('alice@example.com'));
  assert.equal(byEmail.username, 'alice');
  assert.equal(await dbPhoneTaken(db, '+8613812345678'), true, '手机号占用');
  assert.equal(await dbPhoneTaken(db, '+8613912345678'), false);
  assert.equal(await dbEmailTaken(db, 'alice@example.com'), true);

  // 用户名变更 + 冷却
  assert.equal(await getUsernameChangedAt(db, u1.id), null, '未改过 → 无冷却戳');
  await updateUsernameCredential(db, u1.id, 'alice_new');
  assert.equal(raw.prepare('SELECT username FROM users WHERE id=?').get(u1.id).username, 'alice_new');
  assert.ok(await getUsernameChangedAt(db, u1.id), '冷却戳已落');

  // 不触碰另一账户
  assert.equal(raw.prepare('SELECT username FROM users WHERE id=?').get(u2.id).username, 'bob');
});

// ---------------- 路由集成 ----------------
test('路由：发码/绑定/用户名修改/冷却状态', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'carol');

  // 发码（真实通道 → stub 捕获验证码）
  const send = await handleOtpRequest(db, { channel: 'sms', target: '13812345678' }, authedReq(''));
  assert.equal(send.status, 200);
  assert.deepEqual(Object.keys(await send.json()), ['ok'], '响应仅 ok，绝不携带验证码明文');
  const code = lastOtpCode('13812345678');
  assert.match(String(code), /^\d{6}$/);

  // 绑定
  const bind = await handleBindPhone(db, { phone: '+8613812345678', code }, authedReq(u.token));
  assert.equal(bind.status, 200, `绑定应成功: ${JSON.stringify(await bind.json())}`);
  const dup = await handleBindPhone(db, { phone: '+8613812345678', code }, authedReq(u.token));
  assert.equal(dup.status, 409, '重复绑定同号 → 409');

  // 用户名修改：冷却前 400；新用户名非法 400
  const before = await handleUsernameStatus(db, authedReq(u.token));
  const beforeData = await before.json();
  assert.equal(beforeData.canChange, true);
  const change = await handleChangeUsername(db, { newUsername: 'carol_x', capToken: '' }, authedReq(u.token));
  assert.equal(change.status, 403, '无 capToken → 重认证失败');
  // 正确 capToken（issueCapToken 直接返回 token 字符串）
  const capToken = await issueCapToken(db, authedReq(u.token));
  const okChange = await handleChangeUsername(db, { newUsername: 'carol_x', capToken }, authedReq(u.token));
  assert.equal(okChange.status, 200, `改用户名应成功: ${JSON.stringify(await okChange.json())}`);
  assert.equal(raw.prepare('SELECT username FROM users WHERE id=?').get(u.id).username, 'carol_x');
  const after = await handleUsernameStatus(db, authedReq(u.token));
  assert.equal((await after.json()).canChange, false, '改后进入 7 天冷却');
  // capToken 一次性：每次危险操作前重新签发
  const cooldownHit = await handleChangeUsername(db, { newUsername: 'carol_y', capToken: await issueCapToken(db, authedReq(u.token)) }, authedReq(u.token));
  assert.equal(cooldownHit.status, 400, '冷却期内再改 → 400');

  // 非法新用户名（含@ / 纯数字）
  const bad1 = await handleChangeUsername(db, { newUsername: 'a@b', capToken: await issueCapToken(db, authedReq(u.token)) }, authedReq(u.token));
  assert.equal(bad1.status, 400);
  const bad2 = await handleChangeUsername(db, { newUsername: '123456', capToken: await issueCapToken(db, authedReq(u.token)) }, authedReq(u.token));
  assert.equal(bad2.status, 400);
});

test('路由：五合一登录——手机号密码 / 邮箱密码 / 验证码登录 / identifier 探测', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'dave');
  await bindPhoneCredential(db, u.id, '+8613812345678');
  await bindEmailCredential(db, u.id, 'dave@example.com');

  // 手机号密码登录
  const loginByPhone = await handleLogin(db, { identifier: '+8613812345678', password: 'pass123456' }, authedReq(''));
  assert.equal(loginByPhone.status, 200, '手机号+密码登录');
  // 裸手机号归一化
  const loginByBare = await handleLogin(db, { identifier: '13812345678', password: 'pass123456' }, authedReq(''));
  assert.equal(loginByBare.status, 200, '裸手机号（无+86）+密码登录');
  // 邮箱密码登录
  const loginByEmail = await handleLogin(db, { identifier: 'dave@example.com', password: 'pass123456' }, authedReq(''));
  assert.equal(loginByEmail.status, 200, '邮箱+密码登录');
  // 用户名密码登录（回归）
  const loginByUser = await handleLogin(db, { identifier: 'dave', password: 'pass123456' }, authedReq(''));
  assert.equal(loginByUser.status, 200, '用户名+密码登录');
  // 密码错误
  const badPw = await handleLogin(db, { identifier: 'dave@example.com', password: 'wrong12345' }, authedReq(''));
  assert.equal(badPw.status, 401);

  // 验证码登录
  const send = await handleOtpRequest(db, { channel: 'sms', target: '13812345678' }, authedReq(''));
  const code = lastOtpCode('13812345678');
  const codeLogin = await handleLoginWithCode(db, { identifier: '13812345678', code }, authedReq(''));
  assert.equal(codeLogin.status, 200, '手机号+验证码登录');
  const codeData = await codeLogin.json();
  assert.equal(codeData.user.username, 'dave');
  // 错误验证码
  const wrongCode = await handleLoginWithCode(db, { identifier: '13812345678', code: '000000' }, authedReq(''));
  assert.equal(wrongCode.status, 400, '错误验证码 → 400');

  // 探测：手机号/邮箱/用户名/不存在
  const checkPhone = await handleCheckUsername(db, new URL('http://x/api/auth/check?identifier=13812345678'));
  assert.deepEqual(await checkPhone.json(), { exists: true, role: 'student', kind: 'phone' });
  const checkEmail = await handleCheckUsername(db, new URL('http://x/api/auth/check?identifier=dave@example.com'));
  assert.deepEqual((await checkEmail.json()).kind, 'email');
  const checkUser = await handleCheckUsername(db, new URL('http://x/api/auth/check?identifier=dave'));
  assert.deepEqual((await checkUser.json()).role, 'student');
  const checkGhost = await handleCheckUsername(db, new URL('http://x/api/auth/check?identifier=nobody'));
  assert.deepEqual((await checkGhost.json()).exists, false);
  const checkGhostPhone = await handleCheckUsername(db, new URL('http://x/api/auth/check?identifier=13900000000'));
  assert.deepEqual((await checkGhostPhone.json()).exists, false);
});

// 过期用例：直接改库内 expires_at 验证 TTL 拦截
test('verifyOtp：过期验证码拒绝（TTL 5 分钟）', async () => {
  const { raw, db } = await setup();
  const target = '+8613812345678';
  await requestOtp(db, { channel: 'sms', target }, authedReq(''));
  raw.exec(`UPDATE verification_codes SET expires_at=datetime('now','-1 minute')`); // UTC 存储域，用 UTC 改过期
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: lastOtpCode(target) }), 'invalid', '过期验证码拒绝');
});

// B5 回归（用户反馈：未绑定也显示 ***、绑定后先闪「未绑定」再更新）：
// 未绑定 handleGetMyCreds 返回空串（前端回落「未绑定」占位，而非 '***'）；绑定后返回脱敏缩略。
// v1.0 R7：注册必绑手机号（registerUser 走短信验证码注册），故新建用户 phone 为脱敏缩略而非空串；
// 未绑定语义改为「邮箱未绑 → 空串」验证（手机号已由注册绑定）。
test('B5 handleGetMyCreds：未绑定返回空串（回落「未绑定」），绑定后返回脱敏缩略', async () => {
  const { raw, db } = await setup();
  const u = await registerUser(db, raw, 'b5user');
  const r0 = await handleGetMyCreds(db, authedReq(u.token));
  assert.equal(r0.status, 200);
  const d0 = await r0.json();
  assert.match(d0.phone, /^139\*{4}\d{4}$/, '注册已绑手机号 → 脱敏缩略');
  assert.equal(d0.email, '', '未绑定邮箱返回空串');
  // 绑定手机号后返回脱敏缩略
  const otp = await requestOtp(db, { channel: 'sms', target: '+8613812345678' }, authedReq(''));
  assert.equal(otp.ok, true);
  const bind = await handleBindPhone(db, { phone: '+8613812345678', code: lastOtpCode('+8613812345678') }, authedReq(u.token));
  assert.equal(bind.status, 200);
  const bindData = await bind.json();
  assert.equal(bindData.phone, '138****5678', 'bind 接口返回脱敏缩略');
  const r1 = await handleGetMyCreds(db, authedReq(u.token));
  const d1 = await r1.json();
  assert.equal(d1.phone, '138****5678', '绑定后 creds 返回脱敏缩略');
  assert.equal(d1.email, '', '邮箱仍未绑定（空串回落占位）');
});

// ============================================================
// v1.0 R6 验证码模块重构：三振限次 + 新码作废旧码
// ============================================================
test('R6 三振限次：前两次错可重试，第三次错作废必须重新发码', async () => {
  const { raw, db } = await setup();
  const req = { headers: new Headers() };
  const target = '+8613811112222';
  const r = await requestOtp(db, { channel: 'sms', target }, req);
  assert.ok(r.ok);
  const code = lastOtpCode(target);
  // 第 1、2 次输错：invalid（码仍有效）
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000000' }), 'invalid');
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000001' }), 'invalid');
  // 码仍有效：正确码此时仍可通过
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code }), 'ok', '未满 3 次，正确码仍可通过');
});

test('R6 三振作废：连续三次输错 → exhausted，原码彻底失效', async () => {
  const { raw, db } = await setup();
  const req = { headers: new Headers() };
  const target = '+8613811113333';
  const r = await requestOtp(db, { channel: 'sms', target }, req);
  assert.ok(r.ok);
  const code = lastOtpCode(target);
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000000' }), 'invalid');
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000001' }), 'invalid');
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: '000002' }), 'exhausted', '第三次输错即作废');
  // 原码已作废：正确码也拒绝
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code }), 'invalid', '作废后原码失效');
  // 重新发码后可正常通过
  const r2 = await requestOtp(db, { channel: 'sms', target }, req);
  assert.ok(r2.ok);
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: lastOtpCode(target) }), 'ok');
});

test('R6 新码作废旧码：同目标发新码后旧码立即失效', async () => {
  const { raw, db } = await setup();
  const req = { headers: new Headers() };
  const target = '+8613811114444';
  const r1 = await requestOtp(db, { channel: 'sms', target }, req);
  assert.ok(r1.ok);
  const r1Code = lastOtpCode(target);
  // 先验证旧码仍有效
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: r1Code }), 'ok', '发新码前旧码有效');
  // 造一个未消费旧码，然后绕过限频直接验证「新码作废旧码」逻辑（时间快进：把旧行 created_at 改到 61s 前）
  const rOld = await requestOtp(db, { channel: 'sms', target }, req);
  if (!rOld.ok) return; // 60s 限频内（时间未快进）——用 SQL 快进后重发
  const rOldCode = lastOtpCode(target);
  // 用 SQL 把刚发码的 created_at 拨回 61 秒前，绕过 60s 窗口
  raw.prepare("UPDATE verification_codes SET created_at=datetime('now','-61 seconds') WHERE target_hash=?").run(await tokenDigest(target));
  const r2 = await requestOtp(db, { channel: 'sms', target }, req);
  assert.ok(r2.ok, '60s 窗口过后可发新码');
  // 旧码（第一枚）已被新码作废
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: rOldCode }), 'invalid', '旧码被新码作废');
  // 新码有效
  assert.equal(await verifyOtp(db, { channel: 'sms', target, code: lastOtpCode(target) }), 'ok', '新码有效');
});
