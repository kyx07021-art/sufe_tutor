/**
 * Contract signing compliance (S5 standalone model) — full-chain server tests.
 *
 * Origin (v0.25.37): the signature block was a blank placeholder "甲方确认：＿＿ 乙方确认：＿＿";
 * handleSignContract only set a confirmed flag and the ledger recorded a single row after both
 * confirmations — no per-side signing event or identity.
 *
 * Legal conclusion: an ordinary tutoring service contract is not excluded by the E-Signature Law;
 * the parties may agree "reliable conditions" per Article 13(2) (real-name account + password
 * second confirmation + server timestamp + content hash chain); no CA certificate required.
 *
 * S5 adaptation (2026-08-22): the contract moved to the standalone `contracts` table —
 *   - signing layer dropped (no stage / signing_status / demand_id / price columns; hourly_rate -> rate)
 *   - contract_status is 2-state ('signing' | 'signed') plus a `revoked` marker
 *   - the contract carries its own party tuple; conversation_id is a nullable historical link
 *   - drafting (handleCreateContract) now requires a fresh capToken (dangerous op) and has no demand gate
 *   - revoke / admin remove no longer release a linked demand (S5-13)
 *
 * Covered (server-side full chain):
 *   - draft: body contains Article 10 signature record, both "待签署", no blank placeholder;
 *     the contracts row is 'signing' / revoked=0 / rate persisted; the conversation is untouched
 *   - single sign: signed_at set + body shows that party "已签署·时间" + one ledger row + still 'signing'
 *   - double sign: status='signed' + body both signed + two ledger rows + verify passes with 2 entryList rows
 *   - modify: confirmed party blocked (409); unconfirmed party edit resets signed_at/confirmed, rebuilds "待签署"
 *   - cancel: my side signed / other not -> roll back to 'signing', contract retained
 *   - revoke: after double sign -> revoked=1, row retained, idempotent rejection
 *   - verify: entryList per-row (seq + created_at)
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';
import { handleCreateContract, handleSignContract, handleModifyContract, handleVerifyContract, handleCancelContract, handleRevokeContract, handleAdminRemoveContract } from '../src/server/domains/contract/api.js';
import { dbGetContractById, dbGetMyContracts } from '../src/server/domains/contract/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { LIMITS } from '../src/shared/config.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // real D1 throws on empty batch (same contract as the content-admin shim)
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

/** Seed: s1 student + t1 teacher; d1 = s1's demand (S3 single-subject shape; status 'contracted' is
 *  harmless — contracts are decoupled from demands, the row only satisfies the conversation FK and
 *  backs the "admin remove releases no demand" U-3g assertion); C1 = s1-t1 conversation. */
async function seed(db, raw) {
  await initDb(db, ENV);
  await initLedgerTable(db); // worker boot chain: initDb -> initLedgerTable (env.LEDGER_DB || env.DB)
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  // v1.2.0 T3: eligible teacher profile (chsi_verified=1 + required fields), draft eligibility gate depends on it
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  // S5: standalone contract model — the demand is not linked to any contract row (conversations.demand_id FK only)
  raw.prepare(`INSERT INTO student_demands (user_id, subject, grade, province, teaching_method, status)
    VALUES (?,?,?,?,?,?)`).run(s1, 'math', 'senior1', 'shanghai', 'online', 'contracted');
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  // Conversation carries a session (danger_caps session binding; issue/verify resolves via currentSessionId)
  const mkSession = async name => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), sessionId, 'x', '2099-01-01 00:00:00');
    return { token, sessionId };
  };
  return { s1, t1, d1, idOf, t1S: await mkSession('t1'), s1S: await mkSession('s1') };
}
// S5 draft body: no demandId (contracts are not demand-bound); rate replaces the old hourlyRate.
const contractBody = (convId) => ({
  conversationId: convId, method: 'online', plan: '补基础', rate: 150,
  schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '',
  firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '',
});
// capToken is written straight to danger_caps (full real confirmDangerOtp SQL chain: session binding +
// hit-and-delete + expiry comparison). issueCapToken is not used: its exp is written as a UTC ISO string
// compared against datetime('now','localtime'), which only self-consistent under Cloudflare Worker (UTC);
// on a UTC+8 host a freshly issued token is already "expired" -> permanent 403 (test-env timezone artifact,
// not a production defect). expires_at uses 2099 to sidestep the timezone comparison; the verify logic
// (DELETE hit-and-delete) itself is fully covered.
const capOf = async (raw, name, sessionId, idOf) => {
  const cap = `cap-${name}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(idOf(name), sessionId, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
};
// S5-06: drafting is a dangerous operation — every draft requires a fresh capToken for the drafter.
const draftOf = async (raw, name, sessionId, idOf, convId) => ({
  ...contractBody(convId),
  capToken: await capOf(raw, name, sessionId, idOf),
});

test('起草后正文含第十条 签署记录（双方待签署），无空占位「甲方确认：＿＿」', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  const r = await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token));
  assert.equal(r.status, 201);
  const ct = await dbGetContractById(db, 1);
  assert.ok(ct.contract_md.includes('## 第十条 签署记录'), '正文内嵌签署记录');
  assert.ok(!ct.contract_md.includes('甲方确认：'), '空占位落款已删除（缺陷源头）');
  assert.ok(ct.contract_md.includes('签署状态：待签署'), '起草后双方待签署');
  assert.ok(ct.contract_md.includes('#CD000001'), '正文含存证流水号');
  assert.ok(ct.contract_md.includes('可靠条件'), '第九条明文约定电子签名可靠条件（电子签名法 13 条 2 款）');
  assert.equal(ct.drafter_signed_at, '', '起草后无签署时间');
  assert.equal(ct.other_signed_at, '', '起草后无签署时间');
  // S5: standalone contracts row — signing state, not revoked, rate persisted, conversation untouched
  const row = raw.prepare('SELECT contract_status, revoked, rate FROM contracts WHERE id=1').get();
  assert.equal(row.contract_status, 'signing', '起草后 contracts 行 signing');
  assert.equal(row.revoked, 0, '起草后未撤销');
  assert.equal(row.rate, 150, 'rate 落库（hourly_rate 泛化）');
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=1').get().status, 'active', '起草不驱动会话状态');
});

test('单方签署：signed_at 置位 + 正文该方已签署（含时间）+ 台账落一条 + 仍 signing', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  // drafter t1 signs (capToken second confirmation)
  const cap = await capOf(raw, 't1', t1S.sessionId, idOf);
  const res = await handleSignContract(db, 1, { capToken: cap }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, signed: false }, '单方签署后仍未 signed');
  const ct = await dbGetContractById(db, 1);
  assert.ok(ct.drafter_signed_at, '起草方 signed_at 已置位');
  assert.equal(ct.other_signed_at, '', '对方未签');
  assert.ok(ct.contract_md.includes('签署状态：已签署　签署时间：'), '正文该方已签署 + 时间');
  assert.ok(ct.contract_md.includes('签署状态：待签署'), '对方仍待签署');
  const n = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(n, 1, '单方签署也落台账（不再仅双方确认后）');
  const row = raw.prepare('SELECT contract_status FROM contracts WHERE id=1').get();
  assert.equal(row.contract_status, 'signing', '单方签署后状态仍 signing');
  // capToken is one-time: reuse is rejected (dangerous-op second confirmation is not replayable)
  const again = await handleSignContract(db, 1, { capToken: cap }, reqOf(t1S.token));
  assert.equal(again.status, 403, 'capToken 一次性，复用被拒');
});

test('双方签署：status=signed + 正文双方已签署 + 台账两条 + verify 通过且 entryList 两条', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  const r1 = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(r1.status, 200);
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.deepEqual(await r2.json(), { ok: true, signed: true }, '双方签署后 signed');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.status, 'signed');
  assert.ok(ct.drafter_signed_at && ct.other_signed_at, '双方 signed_at 置位');
  assert.ok(!ct.contract_md.includes('待签署'), '正文无「待签署」残留');
  const signedCount = (ct.contract_md.match(/已签署/g) || []).length;
  assert.equal(signedCount, 2, '正文双方均已签署');
  const n = raw.prepare('SELECT COUNT(*) AS c FROM contract_ledger WHERE contract_id=1').get().c;
  assert.equal(n, 2, '每次签署一条台账（单方正文 + 双方正文各一条哈希链）');
  // verify: chain structure + latest-entry body replay
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  const data = await v.json();
  assert.equal(data.recorded, true);
  assert.equal(data.valid, true, '哈希链校验通过');
  assert.equal(data.entries, 2);
  assert.equal(data.entryList.length, 2, 'verify 回传逐条台账明细');
  assert.equal(data.entryList[0].seq, 1);
  assert.ok(data.entryList[0].createdAt, '条目含记档时间');
});

test('修改合同（v0.25.87 R6）：已确认方禁改（409）；未确认方修改 → 清空 signed_at/confirmed 重建「待签署」', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  const before = await dbGetContractById(db, 1);
  assert.ok(before.drafter_signed_at, '修改前起草方已签');
  // R6: the confirmed party (drafter t1) modifying -> 409 (contract content locked)
  const ver = before.version;
  const locked = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(t1S.token));
  assert.equal(locked.status, 409, '已确认方修改被拒');
  // unconfirmed party (receiver s1) modifies -> back to signing-selection state (other's sign is reset)
  const upd = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(s1S.token));
  assert.equal(upd.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.equal(after.drafter_signed_at, '', '修改后签署时间清空（含对方已签）');
  assert.equal(after.other_signed_at, '', '修改后签署时间清空');
  assert.equal(after.drafter_confirmed, 0, '确认标志回退');
  assert.ok(after.contract_md.includes('签署状态：待签署'), '正文重建全部待签署');
  assert.ok(after.contract_md.includes('补基础+真题演练'), '新业务条款生效');
  assert.ok(!after.contract_md.includes('已签署'), '旧签名区块被重拼丢弃');
});

test('R7 取消签约：我方已签对方未签 → 回退待签约、合同保留不删（v0.25.87）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  // drafter t1 signed, receiver s1 not signed
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  const before = await dbGetContractById(db, 1);
  assert.ok(before.drafter_confirmed, '起草方已确认');
  // t1 cancels (capToken) -> roll back to signing, clear my confirmation, contract retained
  // v0.25.94 (feedback dedup): the rollback state is 'signing' — the legacy 'pending' state was removed
  const res = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.ok(after, '合同保留未删除');
  assert.equal(after.status, 'signing', '状态回退「待签约」');
  assert.equal(after.drafter_confirmed, 0, '我方确认标志清空');
  assert.equal(after.drafter_signed_at, '', '我方签署时间清空');
  // the unsigned party s1 may also cancel (signing state)
  const res2 = await handleCancelContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(res2.status, 200);
});

test('R7 撤销合同：双方签后撤销 → 置 revoked 标记、合同保留、幂等拒绝（v0.25.87）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  const before = await dbGetContractById(db, 1);
  assert.equal(before.status, 'signed', '双方已签');
  // revoke (capToken) -> set revoked, keep the row
  const res = await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  const after = await dbGetContractById(db, 1);
  assert.ok(after, '撤销后合同保留');
  assert.equal(after.revoked, 1, '置撤销标记');
  assert.equal(after.revoked_by, idOf('t1'), '记录撤销人');
  // idempotent rejection
  const again = await handleRevokeContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(again.status, 409, '已撤销拒绝重复操作');
  // after double sign, cancel is routed to revoke (409)
  const cancelRes = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(cancelRes.status, 409, '双方已签不可取消，须撤销');
});

// Z-5-F4 regression: ledger write failure -> contract still reaches signed (no deadlock) — returning 500
// would strand a both-confirmed contract in 'signing' with no actionable path.
test('Z-5-F4 回归：台账失败不返 500，合同进 signed 缺口可 verify 暴露', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  raw.exec('DROP TABLE contract_ledger'); // force a ledger write failure (INSERT throws -> ledgerRecord retries exhaust and throws)
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r2.status, 200, '台账失败不返 500（原返 500 卡死双确认 signing 态）');
  const data = await r2.json();
  assert.equal(data.signed, true, '合同仍进 signed（不卡死）');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.status, 'signed', '终态 signed（缺口经 verify 面板暴露，非静默）');
});

// Z-5-F4 (d) recovery-path regression: contract reached signed but the ledger is missing (dropped table)
// -> rebuild the ledger table, then re-sign the SIGNED contract -> the gate admits SIGNED -> flag UPDATE
// changes=0 -> idempotent backfill. Before the fix that path was unreachable (409 CONTRACT_STATE_INVALID).
test('Z-5-F4 恢复路径：SIGNED 重签幂等补记台账缺口', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  raw.exec('DROP TABLE contract_ledger'); // force ledger failure (DROP then INSERT throws)
  const r2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).signed, true, '缺口后仍进 signed（不卡死）');
  assert.equal((await dbGetContractById(db, 1)).status, 'signed');
  await initLedgerTable(db); // simulate ops repair: rebuild the ledger table (empty = gap still present)
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 0, '重建后空表（缺口存在）');
  // re-sign the SIGNED contract -> gate admits SIGNED -> flag status guard changes=0 -> idempotent backfill
  const r3 = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(r3.status, 200, 'SIGNED 重签放行（修复前 409 CONTRACT_STATE_INVALID）');
  assert.equal((await r3.json()).signed, true, '幂等返回已签署');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 1, 'backfill 幂等补记一条（缺口可恢复，非死代码）');
  // re-sign again: zero side effect (idempotent; NOT EXISTS dedup prevents double-linking)
  const r4 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(r4.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contract_ledger').get().c, 1, '重复重签仍一条（幂等）');
});

// Z-5-O2/O3 regression: draft gate strengthened — closed conversation blocks drafting (the old handler
// lacked a conversation-state check) + rate clamped to BUDGET_MAX (previously unbounded).
test('Z-5-O2/O3 回归：关闭会话禁起草 + 时薪钳制 BUDGET_MAX', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  // O2: closed conversation -> 403. The gate fires before capToken consumption, so no capToken is passed.
  raw.prepare("UPDATE conversations SET status='closed' WHERE id=1").run();
  const closed = await handleCreateContract(db, contractBody(1), reqOf(t1S.token));
  assert.equal(closed.status, 403, '关闭会话起草合同 → 403（修复前放行）');
  // restore active, draft succeeds; O3: an oversized rate is clamped
  raw.prepare("UPDATE conversations SET status='active' WHERE id=1").run();
  const body = { ...contractBody(1), rate: 999999999, capToken: await capOf(raw, 't1', t1S.sessionId, idOf) };
  assert.equal((await handleCreateContract(db, body, reqOf(t1S.token))).status, 201, 'active 会话可起草');
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.rate, LIMITS.BUDGET_MAX, '时薪钳制为 BUDGET_MAX（修复前存 999999999）');
});

// Z-5-F5 regression: after cancel the body's Article 10 reflects the rolled-back sign state
// (previously only the columns were cleared while the body still showed "已签署" to the other party).
test('Z-5-F5 回归：取消后正文重拼为回退签署态', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  let ct = await dbGetContractById(db, 1);
  assert.ok(ct.contract_md.includes('签署状态：已签署'), '前置：签署后正文已签署');
  const res = await handleCancelContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200);
  ct = await dbGetContractById(db, 1);
  assert.ok(!ct.contract_md.includes('签署状态：已签署'), '取消后正文不再显示已签署（F5 修复：原正文残留）');
  assert.equal((ct.contract_md.match(/待签署/g) || []).length, 2, '双方均回退待签署');
});

// Z-5-F7 regression: prev_business is encrypted at rest (same N-05 material as contract_md); both
// dbGetContractById and the list mapper decrypt on the way out.
test('Z-5-F7 回归：prev_business 密文落库 + mapper 出口解密', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, 1), reqOf(t1S.token))).status, 201);
  const ct0 = await dbGetContractById(db, 1);
  const ver = ct0.version;
  const upd = await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(s1S.token));
  assert.equal(upd.status, 200);
  const row = raw.prepare('SELECT prev_business FROM contracts WHERE id=1').get();
  assert.ok(String(row.prev_business).startsWith('enc:v1:'), 'prev_business 密文落库（F7 修复：原明文）');
  // S5: dbGetContractById also decrypts prev_business (the detail view needs the diff baseline)
  const ct = await dbGetContractById(db, 1);
  assert.ok(String(ct.prev_business).includes('家教服务合同'), 'dbGetContractById 出口解密 prev_business');
  const mine = await dbGetMyContracts(db, s1); // s1 is the receiver (participant)
  const mineCt = mine.find(x => x.id === 1);
  assert.ok(mineCt && mineCt.prev_business, '列表 mapper 出口有 prev_business');
  assert.ok(!String(mineCt.prev_business).startsWith('enc:v1:'), '列表出口已解密为明文（前端 diff 可用）');
  assert.ok(String(mineCt.prev_business).includes('家教服务合同'), 'prev_business = 修改前业务部分（diff 基线）');
});

// U-3g: admin remove = dangerous operation (deletes the row; S5-13: no demand release), P12 requires
// capToken second confirmation. Mutation: dropping confirmDangerOtp in handleAdminRemoveContract -> the
// no-capToken branch returns 200 -> red.
test('U-3g：handleAdminRemoveContract 无 capToken 403 + 带 capToken 200（S5：无需求联动）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, idOf, t1S } = await seed(db, raw);
  // admin user + session (danger_caps session binding)
  raw.exec("INSERT INTO users (username,password_hash,salt,role) VALUES ('admin_x','h','s','admin')");
  const adminSession = { token: 'admin-x-token', sessionId: 'sess-admin-x' };
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
    .run(await tokenDigest(adminSession.token), idOf('admin_x'), adminSession.sessionId, 'x', '2099-01-01 00:00:00');
  // create a contract (t1 drafts with a capToken)
  const convId = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  const cr = await handleCreateContract(db, await draftOf(raw, 't1', t1S.sessionId, idOf, convId), reqOf(t1S.token));
  assert.equal(cr.status, 201, '合同创建');
  const cid = raw.prepare('SELECT id FROM contracts ORDER BY id DESC LIMIT 1').get().id;
  // admin without capToken -> 403, contract retained
  const noCap = await handleAdminRemoveContract(db, cid, {}, reqOf(adminSession.token));
  assert.equal(noCap.status, 403, '管理员无 capToken 拒绝');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contracts').get().c, 1, '合同未被删');
  // admin with capToken -> 200, contract deleted; the linked demand is NOT released (S5-13)
  const cap = await capOf(raw, 'admin_x', adminSession.sessionId, idOf);
  const withCap = await handleAdminRemoveContract(db, cid, { capToken: cap }, reqOf(adminSession.token));
  assert.equal(withCap.status, 200, '管理员带 capToken 移除成功');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contracts').get().c, 0, '合同已删');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'contracted', '管理删不再释放需求（S5-13）');
});
