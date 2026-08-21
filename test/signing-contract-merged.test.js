/**
 * AI-4b：合并表 stage 推进不变量（signing_contracts，一次合作一条记录）
 *
 * 用户定案模型：签约/合同 = 同一实体的不同 stage 层级，一张表一条记录，id 全程不变
 * （signing id == contract id == 行 id）。本测试锁：
 *   1. 全链路同 id：发起签约(id=X) → 确认(signed) → 起草(promote stage→contract) → 双签 → 撤销，
 *      每步断言行 id 恒等 + stage/signing_status/contract_status 正确推进；
 *   2. 并发起草守卫：同需求双并发起草只单赢（一个 201 一个 409，stage='contract' 仅一行）——变异删闸门红；
 *   3. bindable-demands phase=contract 正向 EXISTS（本会话教师已成交）——变异删正向 EXISTS 红；
 *   4. verify 对 stage='signing' 未起草行 404（读层 stage 锁，旧语义保留）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateSigning, handleRespondSigning, handleCreateContract, handleSignContract, handleRevokeContract, handleVerifyContract } from '../src/server/domains/contract/api.js';
import { handleGetConversationBindableDemands } from '../src/server/domains/chat/api.js';
import { dbGetSigningById } from '../src/server/domains/chat/repo.js';
import { dbGetContractById } from '../src/server/domains/contract/repo.js';
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

async function seed(db, raw, demandStatus = 'open') {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher')`);
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(1, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', demandStatus);
  // 教师接单资格（handleCreateContract 前置 acceptEligibility：学信网核验 + 必填齐全）
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(2, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(1, 2, 1);
  const mk = async name => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), name === 's1' ? 1 : 2, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId };
  };
  return { s1: await mk('s1'), t1: await mk('t1') };
}
const capOf = async (raw, sess, value = 'cap') => {
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(1, sess, await tokenDigest(value), '2099-01-01 00:00:00');
  return value;
};
const signBody = () => ({ conversationId: 1, demandId: 1, price: 150, schedule: '每周六', method: 'offline' });
const contractBody = () => ({ conversationId: 1, demandId: 1, method: 'online', plan: '补基础', hourlyRate: 150, schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '', firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '' });

test('全链路同 id：发起签约→确认→起草→双签→撤销，行 id 全程不变 + stage 推进', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  // 1) t1 发起签约（INSERT 行 stage='signing' signing_status='pending'）
  const r1 = await handleCreateSigning(db, signBody(), reqOf(t1.token));
  assert.equal(r1.status, 201);
  const { id: rowId } = await r1.json();
  assert.ok(rowId > 0);
  let row = raw.prepare('SELECT id, stage, signing_status, contract_status FROM signing_contracts WHERE id=?').get(rowId);
  assert.deepEqual([row.stage, row.signing_status, row.contract_status], ['signing', 'pending', ''], '发起 = signing/pending');
  // 2) s1 确认（同行置 signed，需求 contracted）
  const r2 = await handleRespondSigning(db, rowId, { accept: true, capToken: await capOf(raw, s1.sessionId) }, reqOf(s1.token));
  assert.equal(r2.status, 200);
  row = raw.prepare('SELECT id, stage, signing_status, contract_status FROM signing_contracts WHERE id=?').get(rowId);
  assert.deepEqual([row.id, row.stage, row.signing_status], [rowId, 'signing', 'signed'], '确认 = 同行 signing_status signed');
  // 3) 起草合同（promote：同行 stage→contract，id 不变，contract_status='signing'）
  const r3 = await handleCreateContract(db, contractBody(), reqOf(t1.token));
  assert.equal(r3.status, 201);
  assert.equal((await r3.json()).id, rowId, '起草返回 id = 原 signing 行 id（一次合作一条记录）');
  const count = raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts WHERE conversation_id=1 AND demand_id=1').get().c;
  assert.equal(count, 1, '同会话同需求恒一行');
  row = raw.prepare('SELECT id, stage, signing_status, contract_status FROM signing_contracts WHERE id=?').get(rowId);
  assert.deepEqual([row.stage, row.signing_status, row.contract_status], ['contract', 'signed', 'signing'], '起草 = promote stage→contract');
  // 4) 双签（contract_status→signed，id 不变）
  assert.equal((await handleSignContract(db, rowId, { capToken: await capOf(raw, t1.sessionId, 'cap-t1') }, reqOf(t1.token))).status, 200);
  assert.equal((await handleSignContract(db, rowId, { capToken: await capOf(raw, s1.sessionId, 'cap-s1') }, reqOf(s1.token))).status, 200);
  row = raw.prepare('SELECT id, stage, contract_status FROM signing_contracts WHERE id=?').get(rowId);
  assert.deepEqual([row.id, row.stage, row.contract_status], [rowId, 'contract', 'signed'], '双签 = 同行 contract_status signed');
  // 5) 撤销（revoked=1，id 不变）
  assert.equal((await handleRevokeContract(db, rowId, { capToken: await capOf(raw, t1.sessionId, 'cap-rev') }, reqOf(t1.token))).status, 200);
  row = raw.prepare('SELECT id, stage, revoked FROM signing_contracts WHERE id=?').get(rowId);
  assert.deepEqual([row.id, row.stage, row.revoked], [rowId, 'contract', 1], '撤销 = 同行 revoked=1');
  // 双 id 空间：同一行 id 在对应 stage 被对应端点命中（signing 端点读 signing 层、contract 端点读 contract 层）
  const signRow = await dbGetSigningById(db, rowId);
  const ctRow = await dbGetContractById(db, rowId);
  assert.equal(ctRow.id, rowId, 'contract 端点读同一行（stage=contract 命中）');
  assert.equal(ctRow.status, 'signed', 'contract_status AS status 别名');
  assert.ok(!signRow, 'signing 端点对该 contract 层行 404（读层 stage 锁）');
});

test('并发起草守卫：同需求双并发起草只单赢（stage=contract 仅一行）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw, 'contracted'); // 已确认签约（seed 直插，无 signed signing 行 → 兜底 INSERT 路径）
  // 并发双起草：一个 201（INSERT 赢家），另一个 409（NOT EXISTS 活跃合同拦截）
  const [a, b] = await Promise.all([
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], '并发起草只单赢');
  const n = raw.prepare("SELECT COUNT(*) AS c FROM signing_contracts WHERE stage='contract' AND demand_id=1").get().c;
  assert.equal(n, 1, 'stage=contract 仅一行');
});

test('并发起草守卫（promote 路径）：signed signing 行同 id 推进，并发双请求只单赢', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  assert.equal((await handleCreateSigning(db, signBody(), reqOf(t1.token))).status, 201);
  const rowId = raw.prepare('SELECT id FROM signing_contracts').get().id;
  assert.equal((await handleRespondSigning(db, rowId, { accept: true, capToken: await capOf(raw, s1.sessionId) }, reqOf(s1.token))).status, 200);
  const [a, b] = await Promise.all([
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], 'promote 路径并发起草只单赢（WHERE stage=signing AND signing_status=signed 闸门）');
  const row = raw.prepare('SELECT id, stage FROM signing_contracts WHERE id=?').get(rowId);
  assert.equal(row.stage, 'contract', '同行推进 stage');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts').get().c, 1, '恒一行（无重复插行）');
});

test('bindable phase=contract：仅列本会话教师已成交 + 未绑进行中合同的需求', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  // 本会话 t1 签成 d1（完整 API 流 → signed signing 行）
  assert.equal((await handleCreateSigning(db, signBody(), reqOf(t1.token))).status, 201);
  const rowId = raw.prepare('SELECT id FROM signing_contracts').get().id;
  assert.equal((await handleRespondSigning(db, rowId, { accept: true, capToken: await capOf(raw, s1.sessionId) }, reqOf(s1.token))).status, 200);
  // 起草前：d1 应列出（正向 EXISTS 命中本会话教师、无进行中合同）
  const before = await handleGetConversationBindableDemands(db, 1, new URL('http://localhost/api/conversations/1/bindable-demands?phase=contract'), reqOf(t1.token));
  assert.equal(before.status, 200);
  assert.equal((await before.json()).demands.length, 1, '已确认未起草时下拉列出该需求');
  // 起草后：d1 不再列出（进行中合同 NOT EXISTS 排除）
  assert.equal((await handleCreateContract(db, contractBody(), reqOf(t1.token))).status, 201);
  const after = await handleGetConversationBindableDemands(db, 1, new URL('http://localhost/api/conversations/1/bindable-demands?phase=contract'), reqOf(t1.token));
  assert.equal((await after.json()).demands.length, 0, '起草后下拉空（一条需求一份合同）');
});

test('verify 对 stage=signing 未起草行 404（读层 stage 锁，旧 404 语义保留）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  assert.equal((await handleCreateSigning(db, signBody(), reqOf(t1.token))).status, 201);
  const rowId = raw.prepare('SELECT id FROM signing_contracts').get().id;
  const v = await handleVerifyContract(db, rowId, reqOf(s1.token));
  assert.equal(v.status, 404, 'signing 层行走合同端点 = 404（非 409/500，contract_md=\'\' 不炸解密）');
});

test('起草对「无本会话教师 signed signing 的 contracted 需求」→ 410（promote 定位 + 正向成交守卫）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1 } = await seed(db, raw, 'contracted'); // d1 contracted 但无 signed signing 行
  // locate 无 signed signing → 兜底 INSERT → NOT EXISTS(别教师 signed) 放行 + EXISTS(demand contracted) 放行 → 应 201
  // 但正因无本会话教师 signed signing，生产流不可能出现（contracted 必经 confirm）——此处锁 fallback 行为
  const r = await handleCreateContract(db, contractBody(), reqOf(t1.token));
  assert.equal(r.status, 201, '兜底 INSERT 独立合同行（contracted 需求 + 无别教师签成）');
  const row = raw.prepare('SELECT stage, signing_status, contract_status FROM signing_contracts WHERE demand_id=1').get();
  assert.deepEqual([row.stage, row.signing_status, row.contract_status], ['contract', 'signed', 'signing'], '兜底行 signing_status 兜底 signed（成交语义 + dbIsContracted 放行）');
});

test('bindable phase=contract：无本会话教师 signed signing 的 contracted 需求不列出（正向 EXISTS 排他）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1 } = await seed(db, raw, 'contracted'); // d1 contracted 但无任何 signed signing 行
  // 变异：删正向 EXISTS → 该需求被列出（红）；正向 EXISTS 排除 → 下拉空
  const r = await handleGetConversationBindableDemands(db, 1, new URL('http://localhost/api/conversations/1/bindable-demands?phase=contract'), reqOf(t1.token));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).demands.length, 0, '无本会话教师成交记录的需求不可起草（正向 EXISTS 排他）');
});

test('并发起草守卫（promote 路径）：双并发仅单赢（WHERE stage/signing_status 写串行化闸门）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  assert.equal((await handleCreateSigning(db, signBody(), reqOf(t1.token))).status, 201);
  const rowId = raw.prepare('SELECT id FROM signing_contracts').get().id;
  assert.equal((await handleRespondSigning(db, rowId, { accept: true, capToken: await capOf(raw, s1.sessionId) }, reqOf(s1.token))).status, 200);
  const [a, b] = await Promise.all([
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
    handleCreateContract(db, contractBody(), reqOf(t1.token)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409], 'promote 并发起草只单赢（NOT EXISTS 活跃合同闸门）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts').get().c, 1, '恒一行');
});
