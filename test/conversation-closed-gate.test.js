/**
 * AI-2：合同/签约操作生命周期门禁——关系已关闭（会话 status='closed'）后，5 个写入 handler
 * （sign/modify/revoke/cancel/respond）一律 403 CONVERSATION_CLOSED；verify（只读存证校验）豁免
 * （AI-1「已 signed/revoked 历史存证保留」的访问入口，AI-2 有意决定注释）。
 *
 * 本测试直接手工置会话 status='closed'（不经 AI-1 级联——聚焦门禁本身；合同行保留原状态以通过
 * loadContractFor 白名单走到门禁）。变异守护：删任一 handler 的门禁行 → 403 变非 403（红）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js'; // verify 需要存证台账表
import { encryptField } from '../src/server/core/crypto.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import {
  handleSignContract, handleModifyContract, handleRevokeContract, handleCancelContract, handleVerifyContract, handleRespondSigning,
} from '../src/server/domains/contract/api.js';

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

// 种子：s1/t1 + 会话（close 参数控制初始状态）+ 三行 signing_contracts（signing 合同 / signed 合同 / pending 签约）
async function seed(db, raw, { closed = false } = {}) {
  await initDb(db, ENV);
  await initLedgerTable(db); // worker 启动链 initDb → initLedgerTable（verify 存证校验读台账表）
  const s1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run().lastInsertRowid);
  const t1Id = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run().lastInsertRowid);
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1Id, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  const c1 = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (?,?,?)')
    .run(s1Id, t1Id, closed ? 'closed' : 'active').lastInsertRowid);
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, sessionId, uid };
  };
  const s1 = await mk('s1', s1Id), t1 = await mk('t1', t1Id);
  const mdEnc = await encryptField('测试合同正文');
  // 进行中合同（stage=contract, contract_status='signing'）——modify/cancel/sign 门禁目标
  const icId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id,contract_md)
     VALUES (?,?,?,'contract','signed','signing',?,150,'x','offline',?,?)`).run(s1Id, t1Id, c1, t1Id, t1Id, mdEnc).lastInsertRowid);
  // 已签署合同（stage=contract, contract_status='signed' + 双确认）——revoke 门禁目标 + verify 豁免目标
  const scId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id,contract_md,drafter_confirmed,other_confirmed)
     VALUES (?,?,?,'contract','signed','signed',?,150,'x','offline',?,?,1,1)`).run(s1Id, t1Id, c1, t1Id, t1Id, mdEnc).lastInsertRowid);
  // pending 签约（stage='signing', signing_status='pending'）——respond 门禁目标
  const psId = Number(raw.prepare(
    `INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status,initiator_user_id,price,schedule,method,drafter_user_id)
     VALUES (?,?,?,'signing','pending','',?,150,'x','offline',0)`).run(s1Id, t1Id, c1, t1Id).lastInsertRowid);
  return { s1, t1, c1, icId, scId, psId };
}

// 断言门禁错误码（D3 失败语义）：403 + code='CHAT_CONVERSATION_CLOSED'——删门禁后落 REAUTH_FAILED（也是 403）仍会红
const closedCode = async r => { assert.equal(r.status, 403); assert.equal((await r.json()).code, 'CHAT_CONVERSATION_CLOSED'); };

test('关系已关闭：sign/modify/cancel 对进行中合同 403 CONVERSATION_CLOSED', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, icId } = await seed(db, raw, { closed: true });
  // 学生 s1 是 other 方（drafter=t1）；modify/cancel 用 drafter（t1）或 other 均走到参与方校验后门禁
  const req = reqOf(t1.token);
  await closedCode(await handleSignContract(db, icId, {}, req));
  await closedCode(await handleModifyContract(db, icId, { contractMd: 'x', version: 0 }, req));
  await closedCode(await handleCancelContract(db, icId, {}, req));
  // 门禁在业务门禁（status/revoked/capToken）之前：无 capToken 也 403（而非 REAUTH_FAILED），合同行零变化
  const row = raw.prepare('SELECT contract_status, revoked FROM signing_contracts WHERE id=?').get(icId);
  assert.deepEqual([row.contract_status, row.revoked], ['signing', 0], '合同行零变化');
});

test('关系已关闭：revoke 对已签署合同 403；respond 对 pending 签约 403', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, s1, scId, psId } = await seed(db, raw, { closed: true });
  await closedCode(await handleRevokeContract(db, scId, {}, reqOf(t1.token)));
  await closedCode(await handleRespondSigning(db, psId, { accept: false }, reqOf(s1.token)));
  assert.equal(raw.prepare('SELECT revoked FROM signing_contracts WHERE id=?').get(scId).revoked, 0, '已签署合同零变化');
  assert.equal(raw.prepare('SELECT signing_status FROM signing_contracts WHERE id=?').get(psId).signing_status, 'pending', 'pending 签约零变化');
});

test('verify 豁免：关系已关闭仍可校验历史合同存证（只读）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, scId } = await seed(db, raw, { closed: true });
  const r = await handleVerifyContract(db, scId, reqOf(t1.token));
  assert.equal(r.status, 200, 'verify 豁免门禁（AI-2 有意决定）');
});

test('对照：active 会话合同操作不被门禁拦（正常业务门禁路径）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, icId, scId } = await seed(db, raw, { closed: false });
  // 无 capToken 走 REAUTH_FAILED（403）而非 CONVERSATION_CLOSED——区分门禁
  const r1 = await handleSignContract(db, icId, {}, reqOf(t1.token));
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).code, 'AUTH_REAUTH_FAILED', 'active 会话走到 capToken（非 CONVERSATION_CLOSED）');
  // cancel 同样走到 capToken
  const r2 = await handleCancelContract(db, icId, {}, reqOf(t1.token));
  assert.equal(r2.status, 403);
  assert.equal((await r2.json()).code, 'AUTH_REAUTH_FAILED', 'active 会话 cancel 到 capToken');
});
