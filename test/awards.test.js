/**
 * v1.0 R2 教师荣誉奖项回归：
 *   - 提交（奖状证明必填 + uploadId 归属校验 + 条数上限 + pending 初态）
 *   - 公开出口仅 approved；本人视角全量；删除连带删奖状 upload
 *   - 管理员审核（capToken 二次认证 + 仅 pending 可审 + 驳回必填理由 + 通知作者 + 留档）
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetUpload } from '../src/server/domains/chat/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleRegister, handleLogin } from '../src/server/domains/auth/api.js';
import { requestOtp } from '../src/server/core/otp.js';
import { lastOtpCode } from './_otp-stub.js'; // stub fetch 防真实发信（真实代码路径 + 捕获验证码）
import { handleCreateUpload } from '../src/server/domains/chat/api.js';
import { handleCreateAward, handleGetAwards, handleDeleteAward, handleAdminAwards, handleAdminAwardAction } from '../src/server/domains/awards/api.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
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
  const req = h => ({ headers: new Headers(h || {}) });
  const reg = async (name, role) => {
    const r = await registerWithContact(db, req(), { username: name, role });
    return (await r.json()).authToken;
  };
  const teacherToken = await reg('t_award', 'teacher');
  const otherTeacherToken = await reg('t_other', 'teacher');
  const teacherId = raw.prepare("SELECT id FROM users WHERE username='t_award'").get().id;
  const adminR = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, req());
  const adminToken = (await adminR.json()).authToken;
  const capOf = async () => {
    const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(adminToken));
    const cap = `cap-${Math.random().toString(36).slice(2)}`;
    // danger_caps 主键 (user_id, session_id) 每会话仅一枚——先删旧行再插（模拟 issueCapToken 的 UPSERT 语义）
    raw.prepare('DELETE FROM danger_caps WHERE user_id=? AND session_id=?').run(sess.user_id, sess.session_id);
    raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
      .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
    return cap;
  };
  const mkUpload = async (token, name) => {
    const r = await handleCreateUpload(db, { kind: 'image', fileData: 'data:image/png;base64,AAAA', fileName: name }, req({ 'X-Auth-Token': token }));
    const d = await r.json();
    return d.id;
  };
  return { raw, db, req, teacherToken, otherTeacherToken, teacherId, adminToken, capOf, mkUpload };
}

test('R2 提交：奖状证明必填 + 归属校验 + pending 初态 + 条数上限', async () => {
  const { raw, db, req, teacherToken, otherTeacherToken, mkUpload } = await setup();
  const pid = await mkUpload(teacherToken, 'award.png');
  const otherPid = await mkUpload(otherTeacherToken, 'other.png');
  const nonImg = await (async () => {
    const r = await handleCreateUpload(db, { kind: 'file', fileData: 'data:text/plain;base64,AAAA', fileName: 'doc.txt' }, req({ 'X-Auth-Token': teacherToken }));
    return (await r.json()).id;
  })();

  // 缺 title → 400
  const noTitle = await handleCreateAward(db, { issuer: 'x', proofUploadId: pid }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(noTitle.status, 400);
  // 缺 proofUploadId → 400
  const noProof = await handleCreateAward(db, { title: '一等奖' }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(noProof.status, 400);
  // 非 image 的 upload → 400
  const notImage = await handleCreateAward(db, { title: '一等奖', proofUploadId: nonImg }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(notImage.status, 400);
  // 他人 uploadId → 400
  const otherProof = await handleCreateAward(db, { title: '一等奖', proofUploadId: otherPid }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(otherProof.status, 400);
  // 日期格式非法 → 400
  const badDate = await handleCreateAward(db, { title: '一等奖', proofUploadId: pid, awardDate: '2025/06' }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(badDate.status, 400);
  // 正常 → 201 pending
  const ok = await handleCreateAward(db, { title: '全国高中数学联赛一等奖', issuer: '中国数学会', awardDate: '2025-06', proofUploadId: pid }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(ok.status, 201);
  const row = raw.prepare('SELECT * FROM teacher_awards ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.proof_upload_id, pid);
  // 条数上限：再塞 9 条到 10 条 → 第 11 条 400
  for (let i = 0; i < 9; i++) {
    const p2 = await mkUpload(teacherToken, `a${i}.png`);
    await handleCreateAward(db, { title: `奖项${i}`, proofUploadId: p2 }, req({ 'X-Auth-Token': teacherToken }));
  }
  const p11 = await mkUpload(teacherToken, 'a11.png');
  const over = await handleCreateAward(db, { title: '第11条', proofUploadId: p11 }, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(over.status, 400, '条数上限拒绝');
});

test('R2 公开视角仅 approved；本人全量；删除连带删奖状 upload；他人删除 403', async () => {
  const { raw, db, req, teacherToken, otherTeacherToken, teacherId, mkUpload } = await setup();
  const pid = await mkUpload(teacherToken, 'a1.png');
  await handleCreateAward(db, { title: '待审核奖', proofUploadId: pid }, req({ 'X-Auth-Token': teacherToken }));
  // 公开视角（带 userId 无鉴权）：pending 不出现
  const pubPending = await handleGetAwards(db, new URL(`http://x/api/teacher/awards?userId=${teacherId}`), req());
  assert.deepEqual((await pubPending.json()).awards, [], 'pending 不进公开出口');
  // 本人视角：可见 pending
  const mine = await handleGetAwards(db, new URL('http://x/api/teacher/awards'), req({ 'X-Auth-Token': teacherToken }));
  assert.equal((await mine.json()).awards.length, 1);
  // 审核通过后公开可见
  const aId = raw.prepare('SELECT id FROM teacher_awards ORDER BY id DESC LIMIT 1').get().id;
  const adminR = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, req());
  const adminToken = (await adminR.json()).authToken;
  const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(adminToken));
  const cap = 'cap-approve-1';
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  const ap = await handleAdminAwardAction(db, aId, { action: 'approve', capToken: cap }, req({ 'X-Auth-Token': adminToken }));
  assert.equal(ap.status, 200);
  const pubOk = await handleGetAwards(db, new URL(`http://x/api/teacher/awards?userId=${teacherId}`), req());
  const pubList = (await pubOk.json()).awards;
  assert.equal(pubList.length, 1);
  assert.equal(pubList[0].title, '待审核奖');
  // 通知作者（V-2-4 结构化：type + params）
  const notif = raw.prepare('SELECT type, params FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(teacherId);
  assert.ok(notif, '审核通过通知作者');
  assert.equal(notif.type, 'AWARD_APPROVED', '结构化通知类型');
  assert.equal(JSON.parse(notif.params).title, '待审核奖', '通知带奖项名');
  // 他人删除 → 403
  const delOther = await handleDeleteAward(db, aId, {}, req({ 'X-Auth-Token': otherTeacherToken }));
  assert.equal(delOther.status, 403);
  // 本人删除 → 连带删奖状 upload
  const delMine = await handleDeleteAward(db, aId, {}, req({ 'X-Auth-Token': teacherToken }));
  assert.equal(delMine.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM teacher_awards WHERE id=?').get(aId).c, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads WHERE id=?').get(pid).c, 0, '奖状 upload 连带删除');
});

test('R2 审核：无 capToken 403 / 驳回必填理由 / 非 pending 409 / 重复审 409', async () => {
  const { raw, db, req, teacherToken, adminToken, capOf, mkUpload } = await setup();
  const pid = await mkUpload(teacherToken, 'a2.png');
  await handleCreateAward(db, { title: '另一个奖', proofUploadId: pid }, req({ 'X-Auth-Token': teacherToken }));
  const aId = raw.prepare('SELECT id FROM teacher_awards ORDER BY id DESC LIMIT 1').get().id;
  // 无 capToken → 403
  const noCap = await handleAdminAwardAction(db, aId, { action: 'approve' }, req({ 'X-Auth-Token': adminToken }));
  assert.equal(noCap.status, 403);
  // 驳回缺理由 → 400
  const noNote = await handleAdminAwardAction(db, aId, { action: 'reject', capToken: await capOf() }, req({ 'X-Auth-Token': adminToken }));
  assert.equal(noNote.status, 400);
  // 驳回成功 → 通知含驳回理由
  const rej = await handleAdminAwardAction(db, aId, { action: 'reject', note: '奖状模糊无法辨认', capToken: await capOf() }, req({ 'X-Auth-Token': adminToken }));
  assert.equal(rej.status, 200);
  assert.equal(raw.prepare('SELECT status, admin_note FROM teacher_awards WHERE id=?').get(aId).status, 'rejected');
  // 重复审（已 rejected）→ 409
  const dup = await handleAdminAwardAction(db, aId, { action: 'approve', capToken: await capOf() }, req({ 'X-Auth-Token': adminToken }));
  assert.equal(dup.status, 409);
  // 管理员队列过滤：pending 为空、rejected 一条
  const pendQ = await handleAdminAwards(db, new URL('http://x/api/admin/awards?status=pending'), req({ 'X-Auth-Token': adminToken }));
  assert.equal((await pendQ.json()).awards.length, 0);
  const rejQ = await handleAdminAwards(db, new URL('http://x/api/admin/awards?status=rejected'), req({ 'X-Auth-Token': adminToken }));
  assert.equal((await rejQ.json()).awards.length, 1);
  // 非管理员 → 403
  const nonAdmin = await handleAdminAwards(db, new URL('http://x/api/admin/awards'), req({ 'X-Auth-Token': teacherToken }));
  assert.equal(nonAdmin.status, 403);
});

// v1.0 R7：注册必绑核心凭证（手机号/邮箱任一 + 验证码）——stub 捕获 code 后注册
async function registerWithContact(db, reqObj, { username, role = 'student', password = 'pass123456', channel = 'sms' }, phone = '') {
  const target = channel === 'email' ? `${username}@test.dev` : (phone || '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000));
  const otp = await requestOtp(db, { channel, target }, reqObj);
  if (!otp.ok) throw new Error('发码失败');
  const body = { username, password, role, agreeAgreement: true, agreePrivacy: true };
  if (channel === 'email') { body.email = target; body.otpChannel = 'email'; }
  else { body.phone = target; body.otpChannel = 'sms'; }
  body.code = lastOtpCode(target);
  if (role === 'teacher') { // v1.2.0 T4：教师注册须邀请码——测试预置一枚
    const adminId = (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first() || {}).id || 1;
    const invite = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?,?)').run(invite, adminId);
    body.inviteCode = invite;
  }
  return await handleRegister(db, body, reqObj);
}
