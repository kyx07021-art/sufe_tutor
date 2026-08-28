/**
 * 结束关系接口（POST /api/conversations/:id/close）——会话 active→closed + 级联自动收束。
 *
 * S3/S5 新模型定案：
 * - S3 单科目：需求状态收敛 open/closed（无 contracted/revoked）；需求不随 close 释放
 * （dbCloseConversationCascade 无需求释放语句，返回 { closeWon, rejected: [], revoked }）。
 * - S5 独立合同：contracts 表（无 stage/signing_status/demand_id/initiator）；关闭会话应撤销
 * 进行中（contract_status='signing'）合同、保留已签署（signed）合同存证（A5 终态门禁）；
 * signing 层（pending 签约 / SIGNING_REJECTED 通知 / 气泡终态覆写）整体删除。
 *
 * 当前可跑用例（不依赖级联 SQL）：
 * 1. 鉴权/参与方：无令牌 401；非参与方 close → 404（不泄露会话存在性）；
 * 2. capToken 门禁：无/错 capToken → 403，会话仍 active、级联零发生。
 *
 * 级联用例（主链路/幂等/并发/双方元组/无待收束）已改写至 contracts 表，与 S2 落地的
 * dbCloseConversationCascade（SELECT contracts WHERE contract_status='signing' AND revoked=0 →
 * 逐行 UPDATE revoked=1, revoked_by=0）逐条对齐；响应形状 { ok, closed, contractsRevoked } 按
 * handler 实况断言（无 signingsRejected 字段——signing 层已删除）。
 * 注：原「快照漂移竞态」用例依赖 signing_contracts 专属 driftShim，S5 contracts 表的等价 shim
 * 依赖 S2 落地 SQL 形状——由 S2-落地时重建（锁 UPDATE 守卫承重面）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCloseConversation } from '../src/server/domains/chat/api.js';
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

// S3 单科目需求：状态收敛 open/closed（无 contracted/revoked）
const seedDemand = (raw, userId, status) => Number(raw.prepare(
  `INSERT INTO student_demands (user_id, subject, grade, teaching_method, status)
   VALUES (?,?,?,?,?)`).run(userId, 'math', 'senior1', 'online', status).lastInsertRowid);

// S5 独立合同：contracts 表（无 stage/signing_status/demand_id）。播种直接 INSERT。
const seedContract = (raw, s, t, c, { status, revoked = 0 }) => Number(raw.prepare(
  `INSERT INTO contracts (student_user_id,teacher_user_id,conversation_id,contract_status,drafter_user_id,contract_md,plan,rate,revoked)
   VALUES (?,?,?,?,?,?,?,?,?)`).run(s, t, c, status, t, 'x', '每周两次', 150, revoked).lastInsertRowid);

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

// ---- 级联用例（S5 contracts 模型，S2 已落地 dbCloseConversationCascade）----

test('主链路级联：进行中合同撤销 + signed 保留 + 通知/留档（S5 contracts 模型）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  // 进行中合同（contract_status='signing'）——关闭应撤销
  const icId = seedContract(raw, s1.uid, t1.uid, c1, { status: 'signing' });
  // 已签署合同（contract_status='signed' + 双确认）——终态存证保留
  const scId = Number(raw.prepare(
    `INSERT INTO contracts (student_user_id,teacher_user_id,conversation_id,contract_status,drafter_user_id,contract_md,plan,rate,drafter_confirmed,other_confirmed)
     VALUES (?,?,?,'signed',?,?,?,150,1,1)`).run(s1.uid, t1.uid, c1, t1.uid, 'x', '每周两次').lastInsertRowid);

  const req = reqOf(s1.token);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, req);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.closed, true);
  assert.equal(body.contractsRevoked, 1, '进行中合同撤销 1 条');

  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=?').get(c1).status, 'closed');
  const ic = raw.prepare('SELECT revoked, revoked_by, contract_status FROM contracts WHERE id=?').get(icId);
  assert.equal(ic.revoked, 1, '进行中合同撤销');
  assert.equal(ic.revoked_by, 0, '系统自动撤销 revoked_by=0');
  assert.equal(raw.prepare('SELECT revoked FROM contracts WHERE id=?').get(scId).revoked, 0, '已签署合同保留存证');

  // 通知：t1 收 CONVERSATION_CLOSED + CONTRACT_REVOKED（s1 关闭方视角）
  const notifs = raw.prepare('SELECT type, params, user_id FROM notifications ORDER BY id').all();
  assert.ok(notifs.some(n => n.user_id === t1.uid && n.type === 'CONVERSATION_CLOSED'));
  assert.ok(notifs.some(n => n.user_id === t1.uid && n.type === 'CONTRACT_REVOKED'));

  // 留档：conversation.close + contract.auto_revoke（S3 单科目：无 signing.auto_reject）
  await logRequest(db, { method: 'POST', path: '/api/conversations/1/close', body: {}, status: 200, req });
  const actions = raw.prepare('SELECT action FROM activity_log ORDER BY id').all().map(r => r.action);
  assert.ok(actions.includes('conversation.close'), 'conversation.close 留档');
  assert.ok(actions.includes('contract.auto_revoke'), 'contract.auto_revoke 留档');
});

test('幂等：已 closed 再次 close → alreadyClosed，不消耗 capToken、零级联重放', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  assert.equal((await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token))).status, 200);
  const capBefore = raw.prepare('SELECT COUNT(*) AS c FROM danger_caps WHERE user_id=?').get(s1.uid).c;
  const notifBefore = raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c;
  const r2 = await handleCloseConversation(db, c1, {}, reqOf(s1.token));
  assert.equal(r2.status, 200);
  assert.deepEqual(await r2.json(), { ok: true, alreadyClosed: true });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM danger_caps WHERE user_id=?').get(s1.uid).c, capBefore, '已 closed 不消耗 capToken');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c, notifBefore, '零通知重放');
});

test('并发双 close：仅单赢家跑副作用（通知/留档不翻倍）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  seedContract(raw, s1.uid, t1.uid, c1, { status: 'signing' });
  const [a, b] = await Promise.all([
    handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid, 'cap-s1') }, reqOf(s1.token)),
    handleCloseConversation(db, c1, { capToken: await capOf(raw, t1.sessionId, t1.uid, 'cap-t1') }, reqOf(t1.token)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 200], '双 close 均 200（一赢家一幂等 alreadyClosed）');
  const types = raw.prepare('SELECT type FROM notifications').all().map(n => n.type);
  assert.equal(types.filter(t => t === 'CONVERSATION_CLOSED').length, 1, 'CONVERSATION_CLOSED 恰 1 条（不翻倍）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE revoked=1').get().c, 1, '进行中合同只撤销一次');
});

test('双方元组定位：conversation_id=NULL 的合同行同样收束', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  // 同元组 conversation_id=NULL 的进行中合同（独立存证兜底形态）
  seedContract(raw, s1.uid, t1.uid, null, { status: 'signing' });
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, reqOf(s1.token));
  assert.equal(r.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE revoked=1').get().c, 1, 'conversation_id=NULL 行经双方元组命中收束');
});

test('无待收束行：active 会话 close 正常，仅 CONVERSATION_CLOSED + conversation.close', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  const req = reqOf(s1.token);
  const r = await handleCloseConversation(db, c1, { capToken: await capOf(raw, s1.sessionId, s1.uid) }, req);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.closed, true);
  assert.equal(body.contractsRevoked, 0);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications WHERE type=\'CONVERSATION_CLOSED\'').get().c, 1, '仅 CONVERSATION_CLOSED');
  await logRequest(db, { method: 'POST', path: '/api/conversations/1/close', body: {}, status: 200, req });
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM activity_log WHERE action=\'conversation.close\'').get().c, 1);
});
// 注：原「快照漂移竞态」用例依赖 signing_contracts 专属 driftShim（batch 事务内模拟对端并发推进），
// S5 contracts 表的等价 shim 依赖 S2 落地的级联 SQL 形状，无法预写——由 S2-落地时重建该用例
// （锁 UPDATE 守卫 WHERE contract_status='signing' AND revoked=0 的承重面）。
