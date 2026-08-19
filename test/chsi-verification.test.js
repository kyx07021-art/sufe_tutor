/**
 * v1.2.0 教师学信网核验（T2/T3/T6 + v1.5.0 fail-closed 改造）：
 *   - verify-chsi：manual 进管理员队列；未知 provider（mock/thirdparty）→ 503；格式非法 400
 *   - 管理端 approve 结构化录入 + 自动填入；reject/revoke 撤销资格（chsi_verified 清零）
 *   - 接单门禁：未核验教师提交意向 → 403
 *   - 状态机：pending 才能 approve/reject；approved 才能 revoke；非法状态 409
 *   - M1：verify_code 加密落库（库内非明文）
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { bindChsiEnv } from '../server/chsi.js';
import { handleRegister, handleLogin } from '../src/server/domains/auth/api.js';
import { handleVerifyChsi, handleChsiStatus, acceptEligibility, handleVerifyAdmission } from '../src/server/domains/teacher/api.js';
import { handleCreateIntent } from '../src/server/domains/demand/api.js';
import { handleVerificationAction } from '../src/server/domains/teacher/api.js';
import { dbGetTeacherProfile, dbGetTeacherVerification } from '../src/server/domains/teacher/repo.js';
import { lastOtpCode } from './_otp-stub.js'; // stub fetch 防真实发信（真实代码路径 + 捕获验证码）

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
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

/** 注册教师（带邀请码）返回 token */
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

test('学信网核验全链路（manual）：提交 → pending → 管理员 approve → 学籍自动填入 → 接单资格', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV); // 不配置 CHSI_PROVIDER = manual（fail-closed）
  const token = await regTeacher(db, raw, 't_chsi', '+8613900000101');
  const tid = raw.prepare("SELECT id FROM users WHERE username='t_chsi'").get().id;
  assert.equal(acceptEligibility(await dbGetTeacherProfile(db, tid)).ok, false, '注册后无档案无接单资格');

  // 提交验证码 → pending（不再自动 approved）
  const r = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'pending', 'manual 进管理员队列');
  assert.equal(j.provider, 'manual');
  // M1：验证码加密落库（库内非明文）
  const vRow = db.prepare('SELECT verify_code, status FROM teacher_verifications WHERE user_id=?').first(tid);
  assert.notEqual(vRow.verify_code, 'ABCD1234EFGH', '库内非明文');
  assert.equal(vRow.status, 'pending');

  // 管理员 approve：结构化录入 → 自动填入档案
  const adminToken = await adminTokenOf(db);
  const v = await dbGetTeacherVerification(db, tid);
  const ap = await handleVerificationAction(db, v.id, { action: 'approve', school: '上海财经大学', level: '本科', major: '金融', enrollment_status: '在籍', enroll_year: '2026' }, reqOf(adminToken));
  assert.equal(ap.status, 200, 'approve 成功');
  const prof = await dbGetTeacherProfile(db, tid);
  assert.equal(prof.chsi_verified, true, 'approve 后 chsi_verified=1');
  assert.equal(prof.chsi_school, '上海财经大学', '院校自动填入');
  assert.equal(prof.school, '上海财经大学', 'school 同步学信网值');
  assert.equal(acceptEligibility(prof).ok, false, '必填未齐仍不完整');
  db.prepare("UPDATE teacher_profiles SET subjects='[\"math\"]', price_min=100, time_slots='[{\"day\":\"sat\"}]', teaching_method='online' WHERE user_id=?").run(tid);
  assert.equal(acceptEligibility(await dbGetTeacherProfile(db, tid)).ok, true, '核验 + 必填齐全 = 可接单');
  const st = await handleChsiStatus(db, reqOf(token));
  assert.equal((await st.json()).status, 'approved');
});

test('学信网 fail-closed：mock/thirdparty 等未知 provider → 503；格式非法 → 400', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const token = await regTeacher(db, raw, 't_provider', '+8613900000102');
  bindChsiEnv({ CHSI_PROVIDER: 'mock' });
  const mockR = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal(mockR.status, 503, 'mock provider fail-closed');
  bindChsiEnv({ CHSI_PROVIDER: 'thirdparty' });
  const tpR = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal(tpR.status, 503, 'thirdparty 未实现 fail-closed');
  bindChsiEnv(null);
  const bad = await handleVerifyChsi(db, { code: 'short' }, reqOf(token));
  assert.equal(bad.status, 400, '格式非法 400');
  const none = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal(none.status, 200, '未配置回 manual 进队列');
  assert.equal((await none.json()).status, 'pending');
});

test('接单门禁：未核验教师提交意向/推送接受 → 403', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const token = await regTeacher(db, raw, 't_gate', '+8613900000103');
  const tid = raw.prepare("SELECT id FROM users WHERE username='t_gate'").get().id;
  db.prepare("INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(tid, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  db.prepare("INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects, current_scores, submitter_type, parent_contact, student_contact, status) VALUES (1,'g1','f','[]','[]','self','1','2','open')").run();
  const d1 = db.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').first().id;
  const r = await handleCreateIntent(db, d1, { message: '' }, reqOf(token));
  assert.equal(r.status, 403, '未核验提交意向被拦');
  const j = await r.json();
  assert.ok(j.code === 'CHSI_UNVERIFIED', '原因 CHSI_UNVERIFIED');
});

test('管理端核验状态机与撤销：pending→approve；revoke 撤销资格；非法状态 409', async () => {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const token = await regTeacher(db, raw, 't_manual', '+8613900000104');
  const tid = raw.prepare("SELECT id FROM users WHERE username='t_manual'").get().id;
  const adminToken = await adminTokenOf(db);

  // 提交进 pending
  const sub = await handleVerifyChsi(db, { code: 'ABCD1234EFGH' }, reqOf(token));
  assert.equal((await sub.json()).status, 'pending');
  let v = await dbGetTeacherVerification(db, tid);

  // 非法动作 400
  const bad = await handleVerificationAction(db, v.id, { action: 'hack' }, reqOf(adminToken));
  assert.equal(bad.status, 400);

  // 已 pending 再 approve → 200，资格授予
  const ap = await handleVerificationAction(db, v.id, { action: 'approve', school: '上海财经大学', level: '本科', major: '金融' }, reqOf(adminToken));
  assert.equal(ap.status, 200);
  assert.equal((await dbGetTeacherProfile(db, tid)).chsi_verified, true, 'approve 后资格授予');

  // 已 approved 再 approve → 409（状态机）
  v = await dbGetTeacherVerification(db, tid);
  const again = await handleVerificationAction(db, v.id, { action: 'approve', school: 'X大学', level: '本科' }, reqOf(adminToken));
  assert.equal(again.status, 409, '已 approved 再 approve → 409');

  // revoke：approved → rejected + 撤销资格
  const rv = await handleVerificationAction(db, v.id, { action: 'revoke' }, reqOf(adminToken));
  assert.equal(rv.status, 200);
  assert.equal((await dbGetTeacherProfile(db, tid)).chsi_verified, false, 'revoke 后资格撤销');
  assert.equal((await dbGetTeacherVerification(db, tid)).status, 'rejected', '状态置 rejected');

  // 已 rejected 再 reject → 409
  const rj = await handleVerificationAction(db, v.id, { action: 'reject' }, reqOf(adminToken));
  assert.equal(rj.status, 409);
});

// v1.4.16 大一新生录取通知书验证（学信网暑期未录入的替代通道）：
// 教师上传通知书图片 → pending 进管理员队列（verify_type='admission'）；svg/超限拒绝
test('v1.4.16 录取通知书提交：pending 进队列 + svg/超限拒绝', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const token = await regTeacher(db, raw, 'adm1', '+8613999990001');
  const img = 'data:image/png;base64,' + btoa('\x89PNG\r\n\x1a\n' + 'A'.repeat(50));
  let r = await handleVerifyAdmission(db, { image: img }, reqOf(token));
  assert.equal(r.status, 200, '录取通知书提交成功');
  const d = await r.json();
  assert.equal(d.verifyType, 'admission');
  assert.equal(d.status, 'pending', '进管理员核验队列');
  const row = raw.prepare('SELECT verify_type, status FROM teacher_verifications WHERE user_id=?').get(raw.prepare("SELECT id FROM users WHERE username='adm1'").get().id);
  assert.equal(row.verify_type, 'admission');
  assert.equal(row.status, 'pending');
  r = await handleVerifyAdmission(db, { image: 'data:image/svg+xml;base64,xxx' }, reqOf(token));
  assert.equal(r.status, 400, 'svg 拒收');
  const huge = 'data:image/png;base64,' + 'A'.repeat(600000);
  r = await handleVerifyAdmission(db, { image: huge }, reqOf(token));
  assert.equal(r.status, 400, '超限拒收');
  raw.exec("INSERT INTO users (username,password_hash,salt,role) VALUES ('stu1','h','s','student')");
  const stuId = raw.prepare("SELECT id FROM users WHERE username='stu1'").get().id;
  const st = 'stu1-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)').run(await tokenDigest(st), stuId, 'x', '2099-01-01 00:00:00');
  r = await handleVerifyAdmission(db, { image: img }, reqOf(st));
  assert.equal(r.status, 403, '学生角色拒绝');
});
