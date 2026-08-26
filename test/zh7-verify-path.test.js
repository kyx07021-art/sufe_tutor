/**
 * ZH-7（2026-08-26）：认证通路端到端验证——未认证教师全链路被拦 → 认证 → 解锁。
 * 服务端直测（真实 handler + 真 sqlite）：①未认证（无档案无 verification）handleSaveProfile → 403
 * CHSI_VERIFY_REQUIRED（ZH-2 填资料门禁）②提交 verify-chsi → pending ③公开教师列表不含该教师
 * （ZH-1 chsi_verified=1 过滤）④admin approve（capToken 二次认证）→ chsi_verified=1 + 档案行经
 * dbApplyChsiToProfile 建行 rating=INITIAL_RATING（ZO-1 集成）⑤再 handleSaveProfile → 200 成功
 * ⑥公开列表含该教师。变异守护：删 ZH-2 门禁 → ①红；删 ZH-1 过滤 → ③/⑥红。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleSaveProfile, handleVerifyChsi, handleVerificationAction, handleGetTeachers } from '../src/server/domains/teacher/api.js';
import { handleRegister, handleLogin } from '../src/server/domains/auth/api.js';
import { dbGetTeacherVerification } from '../src/server/domains/teacher/repo.js';
import { issueCapToken } from '../src/server/core/danger-ops.js';
import { lastOtpCode } from './_otp-stub.js';
import { INITIAL_RATING } from '../src/shared/config.js';

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
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = []; for (const s of stmts) {
        if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
        else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
      } raw.exec('COMMIT'); return out; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch {} throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token || '' }) });

async function regTeacher(db, raw, username, phone) {
  const adminId = (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first() || {}).id || 1;
  const invite = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?,?)').run(invite, adminId);
  const otp = await (await import('../src/server/core/otp.js')).requestOtp(db, { channel: 'sms', target: phone }, { headers: new Headers() });
  const reg = await handleRegister(db, { username, password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true, phone, otpChannel: 'sms', code: lastOtpCode(phone), inviteCode: invite }, { headers: new Headers() });
  assert.equal(reg.status, 200);
  return (await reg.json()).authToken;
}

async function adminTokenOf(db) {
  const r = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, reqOf());
  assert.equal(r.status, 200);
  return (await r.json()).authToken;
}

// U-3e：approve 是危险操作（P12 capToken 二次认证，confirmDangerOtp 命中即删，须逐次新签发）
async function verifAction(db, adminToken, id, body) {
  const capToken = await issueCapToken(db, reqOf(adminToken));
  return handleVerificationAction(db, id, { ...body, capToken }, reqOf(adminToken));
}

const baseProfile = { province: 'shanghai', grade: 'freshman', gender: 'male', subjects: ['math'], gaokao_scores: [], price_min: 100, price_max: 200 };

async function plazaIds(db, raw) {
  const r = await handleGetTeachers(db, reqOf()); // 访客可浏览公开列表（PA-1d-F7 后 requireUser→authUser 可选）
  assert.equal(r.status, 200);
  return (await r.json()).teachers.map(t => t.user_id);
}

test('ZH-7 认证通路：未认证全拦 → 认证 → 解锁（ZH-2 门禁 + ZH-1 广场过滤 + ZO-1 评分集成）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const token = await regTeacher(db, raw, 't_path', '+8613900000222');
  const tid = raw.prepare("SELECT id FROM users WHERE username='t_path'").get().id;

  // ① 未认证（无档案无 verification）填资料 → 403 CHSI_VERIFY_REQUIRED（ZH-2 门禁）
  let r = await handleSaveProfile(db, { profile: { ...baseProfile } }, reqOf(token));
  assert.equal(r.status, 403, '未认证教师填资料被拦（ZH-2）');
  assert.equal((await r.json()).code, 'TEACHER_CHSI_VERIFY_REQUIRED', '错误码精确（codes.js:194 域前缀映射）');

  // ② 公开教师列表不含该教师（ZH-1 chsi_verified=1 过滤）
  let ids = await plazaIds(db, raw);
  assert.ok(!ids.includes(tid), '未认证教师不在教师广场（ZH-1）');

  // ③ 提交 verify-chsi → pending
  r = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal(r.status, 200);
  const v = await dbGetTeacherVerification(db, tid);
  assert.equal(v.status, 'pending', 'manual 进管理员队列');
  ids = await plazaIds(db, raw);
  assert.ok(!ids.includes(tid), 'pending 仍不在广场');

  // ④ 管理员 approve（capToken）→ chsi_verified=1 + dbApplyChsiToProfile 建行 rating=INITIAL_RATING（ZO-1）
  const adminToken = await adminTokenOf(db);
  const ap = await verifAction(db, adminToken, v.id, { action: 'approve', school: '上海财经大学', level: '本科', major: '金融', enrollment_status: '在籍', enroll_year: '2026' });
  assert.equal(ap.status, 200, 'approve 成功');
  const prof = raw.prepare('SELECT chsi_verified, rating FROM teacher_profiles WHERE user_id=?').get(tid);
  assert.equal(prof.chsi_verified, 1, 'approve 后 chsi_verified=1');
  assert.equal(prof.rating, INITIAL_RATING, '认证建行路径 rating=4.5（ZO-1 双 INSERT 写路径）');
  ids = await plazaIds(db, raw);
  assert.ok(ids.includes(tid), 'approve 后进入教师广场（ZH-1）');

  // ⑤ 再保存资料 → 200 成功（ZH-2 门禁放行）
  r = await handleSaveProfile(db, { profile: { ...baseProfile } }, reqOf(token));
  assert.equal(r.status, 200, '认证通过后填资料成功（ZH-2 放行）');
});
