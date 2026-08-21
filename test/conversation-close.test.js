/**
 * AI-1：结束关系接口（POST /api/conversations/:id/close）——会话 active→closed + 级联自动收束。
 *
 * 用户定案模型：relationship 抽象父类（不建表）；conversation 子类（一对师生终身一个会话）；
 * signing_contracts 一张表（stage signing→contract，一次合作一条记录）。
 * 本测试锁：
 *   1. 主链路级联：pending 签约 → rejected（气泡终态覆写 + 通知发起者）；进行中合同 → revoked +
 *      释放绑定需求（contracted→revoked）；已成交未起草（signing signed）与已签署合同（contract signed）保留
 *      （A5 终态门禁）；CONVERSATION_CLOSED 通知对端；
 *   2. 幂等：已 closed 再次 close → alreadyClosed，不消耗 capToken、零级联重放；
 *   3. 并发双 close：仅单赢家跑副作用（通知/留档不翻倍）；
 *   4. 双方元组定位：conversation_id=NULL 的签约行同样收束；
 *   5. capToken 门禁：无/错 capToken → 403，会话仍 active 零级联。
 * 注意：initDb 的 seedAdmins 会先占 users id=1（admin_sufe）——所有种子 id 一律取 INSERT 返回值
 * （G3 夹具与生产形状一致），禁止硬编码（signing-contract-merged 的硬编码错位是既存脆弱项，见 AI-10a）。
 * 变异守护（G2，审计时逐项还原源做红→绿验证）：删会话 UPDATE 的 AND status='active' → 重复 close 重放级联红；
 * 删 reject 的 signing_status='pending' → signed signing 被误拒红；删 revoke 的 contract_status IN (...) AND revoked=0
 * → 已签署合同被误撤红；删需求释放语句 → 需求滞留 contracted 红；删 handler 的 closeWon 判定 → 并发败者重复副作用红。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCloseConversation } from '../src/server/domains/chat/api.js';
import { handleCreateSigning } from '../src/server/domains/contract/api.js';
import { logRequest } from '../src/server/core/log.js';
import { tokenDigest } from '../src/server/core/crypto.js';

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
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

// capToken 签发（per-user-per-session）：uid 指定持卡用户（danger_caps 以 user_id+session_id 为主键）
const capOf = async (raw, sessionId, uid, value = 'cap') => {
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(uid, sessionId, await tokenDigest(value), '2099-01-01 00:00:00');
  return value;
};

// 基础种子：s1(学生)/t1(教师)/s2(学生) + t1 合格教师档案 + 会话 C1(s1-t1)/C2(s2-t1)。
// 所有 id 取 INSERT 返回值（initDb 的 seedAdmins 已占 id=1，硬编码必错位）。
async function seed(db, raw) {
  await initDb(db, ENV);
  const s1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run().lastInsertRowid);
  const t1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run().lastInsertRowid);
  const s2Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s2','h','s','student')").run().lastInsertRowid);
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1Id, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  const c1 = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1Id, t1Id).lastInsertRowid);
  const c2 = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s2Id, t1Id).lastInsertRowid);
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  return { s1: await mk('s1', s1Id), t1: await mk('t1', t1Id), s2: await mk('s2', s2Id), s1Id, t1Id, s2Id, c1, c2 };
}
const seedDemand = (raw, userId, status) => Number(raw.prepare(
  `INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
   VALUES (?,?,?,?,?,?,?,?,?)`).run(userId, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', status).lastInsertRowid);

test('鉴权/参与方：无令牌 401；非参与方 close → 404（不泄露会话存在性）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, s2, c1 } = await seed(db, raw);
  assert.equal((await handleCloseConversation(db, c1, {}, reqOf(''))).status, 401);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s2.sessionId, s2.uid) }, reqOf(s2.token));
  assert.equal(r.status, 404, '非参与方 404 CONVERSATION_NOT_FOUND');
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=?').get(c1).status, 'active', '非参与方 close 不改状态');
});

test('capToken 门禁：无/错 capToken → 403，会话仍 active、级联零发生', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  assert.equal((await handleCloseConversation(db, c1, {}, reqOf(s1.token))).status, 403, '无 capToken');
  assert.equal((await handleCloseConversation(db, c1, { capToken: 'wrong' }, reqOf(s1.token))).status, 403, '错 capToken');
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=?').get(c1).status, 'active', '会话仍 active');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, 0, '零通知');
});

test('主链路级联：pending 拒绝 + 进行中合同撤销 + 需求释放 + signed 保留 + 气泡终态 + 通知/留档', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const d1 = seedDemand(raw, s1.uid, 'open');       // pending signing 用（需求保持 open）
  const d2 = seedDemand(raw, s1.uid, 'contracted'); // signed signing 用（已成交未起草 → 需求保持 contracted）
  const d3 = seedDemand(raw, s1.uid, 'contracted'); // in-progress contract 用（撤销 + 释放）
  const d4 = seedDemand(raw, s1.uid, 'contracted'); // signed contract 用（历史存证）
  // 1) pending signing（真实流：t1 发起 → 气泡自动落库；同会话唯一 pending 去重，仅此一条真实流）
  assert.equal((await handleCreateSigning(db, { conversationId: c1, demandId: d1, price: 150, schedule: '每周六', method: 'offline' }, reqOf(t1.token))).status, 201);
  const pending = raw.prepare('SELECT id, message_id FROM signing_contracts WHERE demand_id=?').get(d1);
  assert.ok(pending.message_id, 'pending signing 有气泡');
  // 2) signed signing（播种：已成交未起草形态，signing_status='signed'）
  const signedSigningId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,demand_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id)
     VALUES (?,?,?,?,'signing','signed','',?,150,'x','offline',0)`).run(s1.uid, t1.uid, c1, d2, t1.uid).lastInsertRowid);
  // 3) in-progress contract（播种：stage=contract, contract_status=signing）
  const icId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,demand_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id)
     VALUES (?,?,?,?,'contract','signed','signing',?,150,'x','offline',?)`).run(s1.uid, t1.uid, c1, d3, t1.uid, t1.uid).lastInsertRowid);
  // 4) signed contract（播种：contract_status=signed + 双确认）
  const scId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,demand_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id,drafter_confirmed,other_confirmed)
     VALUES (?,?,?,?,'contract','signed','signed',?,150,'x','offline',?,1,1)`).run(s1.uid, t1.uid, c1, d4, t1.uid, t1.uid).lastInsertRowid);

  const req = reqOf(s1.token);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, req);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, closed: true, signingsRejected: 1, contractsRevoked: 1 });

  // 会话 closed
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=?').get(c1).status, 'closed');
  // pending → rejected + responded_at 置位 + 气泡终态覆写
  const p = raw.prepare('SELECT signing_status, responded_at FROM signing_contracts WHERE id=?').get(pending.id);
  assert.equal(p.signing_status, 'rejected');
  assert.ok(p.responded_at, 'rejected 置 responded_at');
  assert.equal(JSON.parse(raw.prepare('SELECT body FROM messages WHERE id=?').get(pending.message_id).body).status, 'rejected', '气泡终态覆写（防 pending 死按钮）');
  // signed signing 保留 + 需求保持 contracted
  assert.equal(raw.prepare('SELECT signing_status FROM signing_contracts WHERE id=?').get(signedSigningId).signing_status, 'signed');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d2).status, 'contracted');
  // in-progress contract → revoked + 需求释放
  const ic = raw.prepare('SELECT revoked, revoked_by, contract_status FROM signing_contracts WHERE id=?').get(icId);
  assert.equal(ic.revoked, 1);
  assert.equal(ic.revoked_by, 0, '系统自动撤销 revoked_by=0');
  assert.equal(ic.contract_status, 'signed', '沿 handleRevokeContract 标记口径（revoked 主导显示）');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d3).status, 'revoked', '绑定需求释放');
  // signed contract 保留 + 需求保持 contracted
  assert.equal(raw.prepare('SELECT revoked FROM signing_contracts WHERE id=?').get(scId).revoked, 0);
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d4).status, 'contracted');

  // 通知（seed 的 handleCreateSigning 已产生 1 条 SIGNING_REQUEST_SENT 给 s1；级联新增 3 条给 t1）：
  // t1 收 CONVERSATION_CLOSED{name:'s1'} + CONTRACT_REVOKED{name:'s1'} + SIGNING_REJECTED{}（pending 发起者 t1）
  const notifs = raw.prepare('SELECT type, params, user_id FROM notifications ORDER BY id').all();
  assert.equal(notifs.filter(n => n.user_id === t1.uid).length, 3, 't1 收 3 条级联通知');
  assert.ok(notifs.some(n => n.type === 'CONVERSATION_CLOSED' && JSON.parse(n.params).name === 's1'));
  assert.ok(notifs.some(n => n.type === 'CONTRACT_REVOKED' && JSON.parse(n.params).name === 's1'));
  assert.ok(notifs.some(n => n.type === 'SIGNING_REJECTED'));

  // 留档：conversation.close + signing.auto_reject + contract.auto_revoke（flush 请求队列）
  await logRequest(db, { method: 'POST', path: '/api/conversations/1/close', body: {}, status: 200, req });
  const actions = raw.prepare('SELECT action FROM activity_log ORDER BY id').all().map(r => r.action);
  assert.ok(actions.includes('conversation.close'), 'conversation.close 留档');
  assert.ok(actions.includes('signing.auto_reject'), 'signing.auto_reject 留档');
  assert.ok(actions.includes('contract.auto_revoke'), 'contract.auto_revoke 留档');
});

test('幂等：已 closed 再次 close → alreadyClosed，不消耗 capToken、零级联重放', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  assert.equal((await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token))).status, 200);
  const capBefore = raw.prepare('SELECT COUNT(*) AS c FROM danger_caps WHERE user_id=?').get(s1.uid).c;
  const notifBefore = raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c;
  // 第二次 close 不带 capToken：幂等短路应在 capToken 校验之前返回
  const r2 = await handleCloseConversation(db, c1, {}, reqOf(s1.token));
  assert.equal(r2.status, 200);
  assert.deepEqual(await r2.json(), { ok: true, alreadyClosed: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM danger_caps WHERE user_id=?').get(s1.uid).c, capBefore, '已 closed 不消耗 capToken');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, notifBefore, '零通知重放');
});

test('并发双 close：仅单赢家跑副作用（通知/留档不翻倍）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const d1 = seedDemand(raw, s1.uid, 'open');
  assert.equal((await handleCreateSigning(db, { conversationId: c1, demandId: d1, price: 150, schedule: '每周六', method: 'offline' }, reqOf(t1.token))).status, 201);
  const [a, b] = await Promise.all([
    handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid, 'cap-s1') }, reqOf(s1.token)),
    handleCloseConversation(db, c1, { capToken: await capOf(raw, t1.sessionId, t1.uid, 'cap-t1') }, reqOf(t1.token)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 200], '双 close 均 200（一赢家一幂等 alreadyClosed）');
  // seed 的 handleCreateSigning 已产生 1 条 SIGNING_REQUEST_SENT；级联只由赢家产生一套（不翻倍）
  const types = raw.prepare('SELECT type FROM notifications').all().map(n => n.type);
  assert.equal(types.filter(t => t === 'CONVERSATION_CLOSED').length, 1, 'CONVERSATION_CLOSED 恰 1 条（不翻倍）');
  assert.equal(types.filter(t => t === 'SIGNING_REJECTED').length, 1, 'SIGNING_REJECTED 恰 1 条（不翻倍）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts WHERE signing_status=\'rejected\'').get().c, 1, 'pending signing 只 rejected 一次');
});

test('双方元组定位：conversation_id=NULL 的签约/合同行同样收束', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const d1 = seedDemand(raw, s1.uid, 'contracted');
  // 同元组 conversation_id=NULL 的进行中合同（AI-4b 兜底独立行形态）
  Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,demand_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id)
     VALUES (?,?,NULL,?,'contract','signed','signing',?,150,'x','offline',?)`).run(s1.uid, t1.uid, d1, t1.uid, t1.uid).lastInsertRowid);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token));
  assert.equal(r.status, 200);
  const row = raw.prepare('SELECT revoked FROM signing_contracts WHERE demand_id=?').get(d1);
  assert.equal(row.revoked, 1, 'conversation_id=NULL 行经双方元组命中收束');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'revoked');
});

test('无待收束行：active 会话 close 正常，仅 CONVERSATION_CLOSED + conversation.close', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  const req = reqOf(s1.token);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, req);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, closed: true, signingsRejected: 0, contractsRevoked: 0 });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications WHERE type=\'CONVERSATION_CLOSED\'').get().c, 1, '仅 CONVERSATION_CLOSED');
  await logRequest(db, { method: 'POST', path: '/api/conversations/1/close', body: {}, status: 200, req });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM activity_log WHERE action=\'conversation.close\'').get().c, 1);
});

test('关闭方发起的 pending 签约不自通知（SIGNING_REJECTED 跳过 initiator=closer）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const d1 = seedDemand(raw, s1.uid, 'open');
  // s1（学生）发起 pending 签约
  assert.equal((await handleCreateSigning(db, { conversationId: c1, demandId: d1, price: 150, schedule: '每周六', method: 'offline' }, reqOf(s1.token))).status, 201);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token));
  assert.equal(r.status, 200);
  const notifs = raw.prepare('SELECT type FROM notifications').all().map(n => n.type);
  assert.ok(!notifs.includes('SIGNING_REJECTED'), '关闭方自己的 pending 签约不自通知');
  assert.equal(notifs.filter(t => t === 'CONVERSATION_CLOSED').length, 1, '仅对端收 CONVERSATION_CLOSED');
});
