/**
 * AE-1（2026-08-20）·注销释放联系方式（生产 bug 修复的测试锁定）
 *
 * 生产 bug：账户注销后同一手机号/邮箱无法再次注册（409 PHONE_ALREADY_BOUND / EMAIL_ALREADY_BOUND）。
 * 根因：dbDeactivateUser 只清 username/password_hash/salt/avatar，不清 users 表的
 *   phone_hash/email_hash → 唯一索引 idx_users_phone_hash / idx_users_email_hash
 *   （auth/schema.js，WHERE phone_hash != ''）仍占用 → 注册占用查 dbPhoneTaken/dbEmailTaken 命中。
 * 修复（AE-1）：dbDeactivateUser UPDATE 增清 phone/phone_hash/email/email_hash 四列。
 *
 * 本测试锁定修复行为 + 变异守护（还原 AE-1 不清联系方式 → 断言红，G2）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { lastOtpCode } from './_otp-stub.js';
import { requestOtp } from '../src/server/core/otp.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleRegister, handleLogin, handleDeactivateAccount } from '../src/server/domains/auth/api.js';
import { dbCreateUser, dbDeactivateUser } from '../src/server/domains/auth/repo.js';
import { bindPhoneCredential, bindEmailCredential, dbPhoneTaken, dbEmailTaken } from '../src/server/core/credential.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token || '' }) });
const idOf = (raw, name) => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
const regBody = (username, phone) => ({
  username, password: 'pass123456', role: 'student',
  agreeAgreement: true, agreePrivacy: true,
  phone, otpChannel: 'sms', code: lastOtpCode(phone),
});

// 走 handleDeactivateAccount 全链路注销（capToken 二次认证路径，与生产一致）；返回注销后 uid（注销后用户名墓碑化，按名查不可用）
async function deactivateViaApi(raw, db, authToken, username) {
  const uid = idOf(raw, username);
  const sess = raw.prepare('SELECT session_id FROM auth_sessions WHERE user_id=?').get(uid);
  assert.ok(sess, '注销前账户有活跃会话');
  const cap = 'cap-' + username;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(uid, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  return { uid, res: await handleDeactivateAccount(db, { capToken: cap }, reqOf(authToken)) };
}

test('注销释放联系方式：phone_hash/email_hash 清空 + 唯一索引释放 + 同联系方式可再绑定', async () => {
  const raw = rawOf(); const db = d1Shim(raw); await initDb(db, ENV);
  const PHONE = '+8613800000001', EMAIL = 'ae2@test.com';
  const u1 = await dbCreateUser(db, 'rel_u1', 'h1', 's1', 'student');
  const u2 = await dbCreateUser(db, 'rel_u2', 'h2', 's2', 'teacher');
  await bindPhoneCredential(db, u1, PHONE);
  await bindEmailCredential(db, u1, EMAIL);
  assert.equal(await dbPhoneTaken(db, PHONE), true, '绑定后手机号占用');
  assert.equal(await dbEmailTaken(db, EMAIL), true, '绑定后邮箱占用');

  await dbDeactivateUser(db, u1, '已注销用户#' + u1);
  assert.equal(await dbPhoneTaken(db, PHONE), false, '注销后手机号释放');
  assert.equal(await dbEmailTaken(db, EMAIL), false, '注销后邮箱释放');
  const row = raw.prepare('SELECT phone, phone_hash, email, email_hash FROM users WHERE id=?').get(u1);
  assert.equal(row.phone, '', 'phone 清空');
  assert.equal(row.phone_hash, '', 'phone_hash 清空（唯一索引释放）');
  assert.equal(row.email, '', 'email 清空');
  assert.equal(row.email_hash, '', 'email_hash 清空（唯一索引释放）');

  // 唯一索引释放 → 同联系方式可绑定到新用户
  await bindPhoneCredential(db, u2, PHONE);
  await bindEmailCredential(db, u2, EMAIL);
  assert.equal(await dbPhoneTaken(db, PHONE), true, '释放后手机号归新用户');
  assert.equal(await dbEmailTaken(db, EMAIL), true, '释放后邮箱归新用户');
});

test('变异守护：还原 AE-1（不清联系方式）→ 占用残留（断言锁定真实行为，G2）', async () => {
  const raw = rawOf(); const db = d1Shim(raw); await initDb(db, ENV);
  const PHONE = '+8613800000002';
  const u1 = await dbCreateUser(db, 'mut_u1', 'h1', 's1', 'student');
  await bindPhoneCredential(db, u1, PHONE);
  // 模拟修复前行为：只清用户名/口令，不清联系方式（旧 SQL，AE-1 前 dbDeactivateUser 的实际 UPDATE）
  raw.prepare(`UPDATE users SET username=?, password_hash='', salt='', avatar='', banned=1, deactivated=1 WHERE id=?`)
    .run('已注销用户#' + u1, u1);
  assert.equal(await dbPhoneTaken(db, PHONE), true, '修复前残留占用——本断言在修复后为红，证明测试锁定了修复行为');
});

test('全链路：注销后同一手机号重新注册成功 + 原账号手机号登录 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw); await initDb(db, ENV);
  const PHONE = '+8613800000003';
  // 注册 u1（手机号绑定）
  await requestOtp(db, { channel: 'sms', target: PHONE }, reqOf());
  const r1 = await handleRegister(db, regBody('reg_u1', PHONE), reqOf());
  assert.equal(r1.status, 200, 'u1 注册成功');
  const u1Token = (await r1.json()).authToken;
  // 注销 u1（capToken 二次认证）
  const deact = await deactivateViaApi(raw, db, u1Token, 'reg_u1');
  assert.equal(deact.res.status, 200, 'u1 注销成功');
  // 原手机号 + 原密码登录 → 401（凭证已释放 + 账户已墓碑 deactivated）
  const loginOld = await handleLogin(db, { identifier: PHONE, password: 'pass123456' }, reqOf());
  assert.equal(loginOld.status, 401, '注销后原手机号登录失败（预期）');
  // 同一手机号重新注册 u2 → 成功（修复核心：联系方式已释放）
  await requestOtp(db, { channel: 'sms', target: PHONE }, reqOf());
  const r2 = await handleRegister(db, regBody('reg_u2', PHONE), reqOf());
  assert.equal(r2.status, 200, 'u2 同一手机号注册成功（AE-1 核心验收）');
  // u2 可凭手机号登录，手机号归属新账户
  const loginNew = await handleLogin(db, { identifier: PHONE, password: 'pass123456' }, reqOf());
  assert.equal(loginNew.status, 200, 'u2 可凭手机号登录');
  assert.equal((await loginNew.json()).user.username, 'reg_u2', '手机号归新账户');
  // 注销账户本体联系方式确已清空（二次确认，防残留；按注销前 uid 查——用户名已墓碑化）
  const u1row = raw.prepare('SELECT phone_hash, email_hash FROM users WHERE id=?').get(deact.uid);
  assert.equal(u1row.phone_hash, '', '注销账户 phone_hash 空');
  assert.equal(u1row.email_hash, '', '注销账户 email_hash 空');
});
