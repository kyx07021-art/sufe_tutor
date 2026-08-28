/**
 * S5 contract domain — standalone-model guard tests (load-bearing lines 1 & 2).
 *
 * The S5 refactor replaces the a merged signing_contracts table with an independent
 * `contracts` table: no signing layer (no stage / signing_status / demand_id / initiator /
 * price), 2-state contract_status ('signing' | 'signed') + a revoked marker, self-contained
 * party tuple, and a nullable conversation_id with NO FK (contracts are independent evidence
 * that survive conversation deletion).
 *
 * Two load-bearing lines, each locked with mutation guards:
 * 1. State machine: draft -> double sign -> revoke (2-state + revoked marker, no demand /
 * conversation coupling).
 * 2. Evidence chain: ledger idempotency (contract_id + body_hash, time-decoupled) +
 * verifyChain tamper detection + archived structure-only validation.
 *
 * Also carries the //acceptance assertions migrated from the deleted
 * test/contract-revoked-rebuild.test.js:
 * - draft entry strips the business separator from user fields
 * - a revoked contract rejects further sign (409) and never backfills the ledger
 * - cancel re-reads and re-rebuilds the body when the version-CAS race is lost
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable, migrate as migrateContractSchema } from '../src/server/domains/contract/schema.js';
import {
  handleCreateContract, handleSignContract, handleModifyContract, handleRevokeContract, handleCancelContract,
  handleVerifyContract, handleGetContractById, ledgerRecord, verifyChain, CONTRACT_BUSINESS_END,
} from '../src/server/domains/contract/api.js';
import { dbGetContractById } from '../src/server/domains/contract/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// D1 shim over node:sqlite DatabaseSync (same contract as the legacy test fixtures:
// prepare -> bind -> all/first/run + a transactional batch for initDb's create phase).
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

/** Seed: s1 student + t1 teacher (eligible profile), an open demand, and an active conversation. */
async function seed(db, raw, demandStatus = 'open') {
  await initDb(db, ENV);
  await initLedgerTable(db);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  // Eligible teacher profile (chsi_verified=1 + complete required fields) — create gate depends on it.
  raw.prepare('INSERT INTO teacher_profiles (user_id, province, grade, gender, subjects, price_min, price_max, time_slots, teaching_method, chsi_verified) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(t1, 'shanghai', 'freshman', 'male', '["math"]', 100, 200, '[{"day":"sat"}]', 'online');
  raw.prepare(`INSERT INTO student_demands (user_id, subject, grade, province, teaching_method, current_score, preferred_tags, budget_min, budget_max, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(s1, 'math', 'senior1', 'shanghai', 'online', '110', '[]', 150, 200, demandStatus);
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  const mkSession = async name => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), sessionId, 'x', '2099-01-01 00:00:00');
    return { token, sessionId };
  };
  return { s1, t1, d1, idOf, t1S: await mkSession('t1'), s1S: await mkSession('s1') };
}

// S5 draft body: standalone contract, no demandId, rate (not hourlyRate).
const contractBody = (convId) => ({
  conversationId: convId, method: 'online', plan: '补基础', rate: 150,
  schedule: '每周六晚', location: '线上', payMethod: 'per_session', payMethodOther: '',
  firstLessonDate: '2026-09-01', trialPay: 'normal', trialPayOther: '',
});

// One-time capToken row in danger_caps (real confirmDangerOtp SQL path: session-bound,
// hit-and-delete, expires_at 2099 to dodge the UTC/local timezone comparison artifact).
const capOf = async (raw, name, sessionId, idOf) => {
  const cap = `cap-${name}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(idOf(name), sessionId, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
};

const ledgerCount = (raw, contractId) => raw.prepare('SELECT COUNT(*) c FROM contract_ledger WHERE contract_id=?').get(contractId).c;

// Proxy that forces the sign/cancel rebuild UPDATE (`SET contract_md=... WHERE id=? AND version=?`)
// to return changes=0 on its Nth call — simulates a concurrent writer that advanced the version
// between the row read and the rebuild write (the / loser-of-double-sign race).
function raceMdUpdateDb(db, failAt) {
  let calls = 0;
  return new Proxy(db, {
    get(t, prop) {
      const v = Reflect.get(t, prop);
      if (prop !== 'prepare') return v;
      return (sql, ...rest) => {
        const st = t.prepare(sql, ...rest);
        if (/SET contract_md=.*version=version\+1 WHERE id=\? AND version=\?/.test(String(sql))) {
          calls++;
          const origRun = st.run.bind(st);
          st.run = async (...p) => (calls === failAt ? { meta: { changes: 0 } } : origRun(...p));
        }
        return st;
      };
    },
  });
}

// Proxy that forces the ledger prev-read (`SELECT content_hash ... ORDER BY id DESC LIMIT 1`,
// without the body_hash filter) to return a stale tail — simulates a concurrent append between
// the writer's prev read and its conditional INSERT (the chain-tail CAS race).
function stalePrevLedgerDb(db, stalePrev) {
  // Anchored: only the standalone prev-read statement (not the INSERT whose subquery embeds it).
  const isPrevRead = sql => /^SELECT content_hash FROM contract_ledger WHERE contract_id=\? ORDER BY id DESC LIMIT 1$/.test(String(sql));
  return new Proxy(db, {
    get(t, prop) {
      const v = Reflect.get(t, prop);
      if (prop !== 'prepare') return v;
      return (sql, ...rest) => {
        const st = t.prepare(sql, ...rest);
        if (isPrevRead(sql)) {
          const fake = { _sql: sql, _params: [] };
          fake.bind = (...p) => { fake._params = p; return fake; };
          fake.first = () => ({ content_hash: stalePrev });
          return fake;
        }
        return st;
      };
    },
  });
}

// ============================================================
// Load-bearing line 1 — state machine: draft -> double sign -> revoke
// ============================================================

test('S5 state machine: draft row -> double sign -> signed + 2 ledger entries -> revoke retains row + no ledger append', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, idOf, t1S, s1S } = await seed(db, raw);
  const demandBefore = raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status;

  // Draft: standalone contract row, no demand write, no conversation mutation.
  const cr = await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(cr.status, 201, 'draft succeeds');
  const ct1 = await dbGetContractById(db, 1);
  assert.ok(ct1.id > 0, 'row created');
  assert.equal(ct1.status, 'signing', 'initial state is signing (2-state)');
  assert.equal(ct1.revoked, 0, 'not revoked');
  assert.equal(ct1.rate, 150, 'rate column stores hourly rate');
  assert.equal(ct1.conversation_id, 1, 'historical conversation link');
  assert.ok(ct1.contract_md.includes(`#CD${String(ct1.id).padStart(6, '0')}`), 'body carries flow number #CD{id}');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, demandBefore, 'no demand write');
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=1').get().status, 'active', 'no conversation mutation');

  // Both parties sign -> signed.
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  const s2 = await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(s2.status, 200);
  assert.deepEqual(await s2.json(), { ok: true, signed: true }, 'double sign -> signed');
  const ct2 = await dbGetContractById(db, 1);
  assert.equal(ct2.status, 'signed', '2-state terminal');
  assert.equal(ledgerCount(raw, 1), 2, 'each sign records one ledger entry');

  // Verify passes (chain + latest body replay).
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  assert.equal((await v.json()).valid, true, 'evidence chain valid after double sign');

  // Revoke: marker set, status stays signed, ledger NOT appended.
  assert.equal((await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  const ct3 = await dbGetContractById(db, 1);
  assert.equal(ct3.revoked, 1, 'revoked marker set');
  assert.equal(ct3.status, 'signed', 'status kept signed (revoked is a marker)');
  assert.equal(ledgerCount(raw, 1), 2, 'revoke does not append the ledger');
  // Revoked row keeps its evidence: verify still passes.
  const v2 = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal((await v2.json()).valid, true, 'revoked contract retains verifiable evidence');
  // Repeat revoke idempotently rejected.
  const again = await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(again.status, 409, 'repeat revoke rejected');
});

test('S5 mutation: loser of the double-sign mdUpdate race does NOT write the ledger', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal(ledgerCount(raw, 1), 1, 'first sign recorded one entry');

  // Second sign loses the version-CAS on the body rebuild (simulated concurrent advance).
  const racyDb = raceMdUpdateDb(db, 1);
  const res = await handleSignContract(racyDb, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false, signed: false }, 'loser reports not-signed');
  // Mutation: removing the loser skip (`if (!(mdUpdate.meta.changes > 0)) return ...`)
  // lets the loser call ledgerRecord -> the ledger would gain a second entry -> this assertion goes red.
  assert.equal(ledgerCount(raw, 1), 1, 'loser must NOT append the ledger (only the winner records)');
});

// ============================================================
// Load-bearing line 2 — evidence chain: idempotency + tamper detection + archived
// ============================================================

test('S5 ledger: same body twice (cross second) -> 1 entry; different body -> contiguous prev chain; verifyChain ok', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initLedgerTable(db);
  // Idempotency key = contract_id + body_hash (time-decoupled) — same body across seconds dedups.
  await ledgerRecord(db, 1, 'BODY_X');
  await ledgerRecord(db, 1, 'BODY_X');
  assert.equal(ledgerCount(raw, 1), 1, 'same body deduped (NOT EXISTS idempotency)');
  await ledgerRecord(db, 1, 'BODY_Y');
  const rows = raw.prepare('SELECT id, contract_id, content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=1 ORDER BY id ASC').all();
  assert.equal(rows.length, 2, 'different body appends');
  assert.equal(rows[1].prev_hash, rows[0].content_hash, 'prev links contiguous');
  const chk = await verifyChain(rows, { contractId: 1, contractMd: 'BODY_Y' });
  assert.equal(chk.ok, true, 'chain structure valid');
  assert.equal(chk.lastRehashValid, true, 'latest body replay valid');
});

test('S5 ledger mutation: NOT EXISTS idempotency removed -> duplicate link on repeat', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initLedgerTable(db);
  await ledgerRecord(db, 1, 'BODY_X');
  // Same body re-recorded after a signed-then-500 style retry must NOT double-link.
  await ledgerRecord(db, 1, 'BODY_X');
  // Mutation: dropping the `AND NOT EXISTS (... body_hash=?)` guard makes the retry append a
  // second entry with the same body -> this assertion goes red.
  assert.equal(ledgerCount(raw, 1), 1, 'repeat of the same body stays a single entry');
});

test('S5 verifyChain: tampering the middle content_hash breaks the chain link', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initLedgerTable(db);
  await ledgerRecord(db, 1, 'BODY_A');
  await ledgerRecord(db, 1, 'BODY_B');
  await ledgerRecord(db, 1, 'BODY_C');
  const rows = raw.prepare('SELECT id, contract_id, content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=1 ORDER BY id ASC').all();
  assert.equal(rows.length, 3);
  rows[1].content_hash = rows[1].content_hash.replace(/^./, 'f'); // tamper the middle entry
  const r = await verifyChain(rows, { contractId: 1, contractMd: 'BODY_C' });
  assert.equal(r.linksValid, false, 'adjacent prev_hash continuity broken');
  assert.equal(r.ok, false, 'tampered chain fails verification');
});

test('S5 verifyChain: archived (no body) does structure-only validation; empty chain invalid', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initLedgerTable(db);
  await ledgerRecord(db, 1, 'BODY_A');
  await ledgerRecord(db, 1, 'BODY_B');
  const rows = raw.prepare('SELECT id, contract_id, content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=1 ORDER BY id ASC').all();
  const a = await verifyChain(rows, { archived: true });
  assert.equal(a.lastRehashValid, null, 'archived: no body to replay');
  assert.equal(a.ok, true, 'archived: structure only');
  const e = await verifyChain([]);
  assert.equal(e.ok, false, 'empty chain invalid');
});

test('S5 ledger mutation: chain-tail CAS removed -> a stale-prev writer is accepted and double-links', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initLedgerTable(db);
  await ledgerRecord(db, 1, 'BODY_A'); // tail = H_A
  // Simulate a concurrent writer that appended after this writer read the (now stale) tail.
  // The conditional INSERT (`WHERE current_tail = prevHash`) must reject the stale writer; a
  // removal of the CAS lets it insert with prev_hash=STALE_PREV -> the chain is double-linked.
  const racy = stalePrevLedgerDb(db, 'STALE_PREV');
  await assert.rejects(ledgerRecord(racy, 1, 'BODY_B'), /ledger insert retry exhausted/);
  assert.equal(ledgerCount(raw, 1), 1, 'stale-prev writer rejected, chain intact');
});

// ============================================================
// / migrated: revoked gate + cancel re-read-rebuild
// ============================================================

test('Q-2e-F4: revoked contract rejects further sign (409) and never backfills the ledger', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200);
  assert.equal((await handleRevokeContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  const before = ledgerCount(raw, 1);
  const res = await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  // Mutation: dropping the `if (ct.revoked) return 409` gate lets the sign flow re-enter the
  // SIGNED backfill branch and return {ok:true,signed:true} -> this 409 assertion goes red.
  assert.equal(res.status, 409, 'revoked contract sign rejected');
  assert.equal(ledgerCount(raw, 1), before, 'no ledger backfill on revoked sign');
});

test('Q-2e-F5: cancel re-reads and re-rebuilds the body after a lost version-CAS race', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.ok((await dbGetContractById(db, 1)).contract_md.includes('签署状态：已签署'), 'precondition: signed body');

  // First rebuild UPDATE loses the version CAS -> handler must re-read and re-build once.
  const racyDb = raceMdUpdateDb(db, 1);
  const res = await handleCancelContract(racyDb, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token));
  assert.equal(res.status, 200, 'cancel succeeds');
  const after = await dbGetContractById(db, 1);
  assert.equal(after.status, 'signing', 'status rolled back to signing');
  // Mutation: removing the re-read-rebuild loop (single attempt, changes=0 -> give up) leaves
  // the old signed body in place -> this assertion goes red.
  assert.ok(!after.contract_md.includes('签署状态：已签署'), 'body rolled back (re-read-rebuild)');
  assert.equal((after.contract_md.match(/签署状态：待签署/g) || []).length, 2, 'both parties back to pending');
});

// ============================================================
// New-model core semantics: drafting never drives the conversation / demand
// ============================================================

test('S5 semantics: drafting is self-contained — conversation and demand are untouched', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, idOf, t1S } = await seed(db, raw, 'open'); // open demand: no contracted gate applies
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=?').get(d1).status, 'open', 'demand status unchanged');
  assert.equal(raw.prepare('SELECT status FROM conversations WHERE id=1').get().status, 'active', 'conversation status unchanged');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM student_demands').get().c, 1, 'no demand row written');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM conversations').get().c, 1, 'no conversation row written');
  // Mutation: a re-introduced demand-status gate in handleCreateContract would reject drafting
  // against an open demand (the old signing flow demanded contracted) -> the 201 above goes red.
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.contract_status, 'signing');
  assert.equal(ct.student_user_id, raw.prepare("SELECT id FROM users WHERE username='s1'").get().id, 'contract carries its own tuple');
});

// ============================================================
// Independent lifecycle: no FK cascade + legacy signing_contracts migration
// ============================================================

test('S5 lifecycle: contract survives conversation deletion (no FK cascade); verify + getContractById still work', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200);
  assert.equal((await dbGetContractById(db, 1)).status, 'signed');

  raw.prepare('DELETE FROM conversations WHERE id=?').run(1);
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM conversations').get().c, 0, 'conversation deleted');
  // contracts has NO FK on conversation_id -> the signed evidence row is retained.
  const ct = await dbGetContractById(db, 1);
  assert.ok(ct, 'contract row survives conversation deletion');
  assert.equal(ct.status, 'signed');
  assert.equal(ct.conversation_id, 1, 'historical link retained');
  // Mutation: adding `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE`
  // to the contracts DDL would cascade-delete this row -> the assertion above goes red.
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  assert.equal((await v.json()).valid, true, 'evidence verifiable after conversation deletion');
  const g = await handleGetContractById(db, 1, reqOf(t1S.token));
  assert.equal(g.status, 200, 'participant can still read the retained contract by tuple');
});

test('S5 migration: signing_contracts -> contracts (id preserved 1:1, pending->signing, table dropped, rerun no-op)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV); // fresh DB: contracts table exists, no signing_contracts
  // Recreate the legacy a merged table shape + one seeded row.
  raw.exec(`CREATE TABLE signing_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_user_id INTEGER NOT NULL, teacher_user_id INTEGER NOT NULL,
    conversation_id INTEGER, stage TEXT NOT NULL DEFAULT 'signing', contract_status TEXT NOT NULL DEFAULT 'pending',
    drafter_user_id INTEGER NOT NULL DEFAULT 0, plan TEXT NOT NULL DEFAULT '', hourly_rate INTEGER NOT NULL DEFAULT 0,
    pay_method TEXT NOT NULL DEFAULT '', pay_method_other TEXT NOT NULL DEFAULT '', first_lesson_date TEXT NOT NULL DEFAULT '',
    trial_pay TEXT NOT NULL DEFAULT '', trial_pay_other TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT 'offline',
    schedule TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', contract_md TEXT NOT NULL DEFAULT '',
    prev_business TEXT, version INTEGER NOT NULL DEFAULT 0, drafter_confirmed INTEGER NOT NULL DEFAULT 0,
    other_confirmed INTEGER NOT NULL DEFAULT 0, drafter_signed_at TEXT NOT NULL DEFAULT '', other_signed_at TEXT NOT NULL DEFAULT '',
    revoked INTEGER NOT NULL DEFAULT 0, revoked_by INTEGER NOT NULL DEFAULT 0, created_at DATETIME, updated_at DATETIME)`);
  raw.prepare(`INSERT INTO signing_contracts (id, student_user_id, teacher_user_id, conversation_id, stage, contract_status, drafter_user_id, plan, hourly_rate, method, schedule, location, contract_md, version, drafter_confirmed, other_confirmed, drafter_signed_at, other_signed_at, revoked, revoked_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(42, 1, 2, 5, 'contract', 'pending', 1, '补基础', 150, 'online', '每周六晚', '线上', 'ENC_MD', 0, 0, 0, '', '', 0, 0, '2026-08-22 10:00:00', '2026-08-22 10:00:00');

  await migrateContractSchema(db, { phase: 'postEnsure' });
  const ct = raw.prepare('SELECT * FROM contracts WHERE id=42').get();
  assert.ok(ct, 'migrated row present with preserved id (mutation: id not preserved -> 42 missing -> red)');
  assert.equal(ct.rate, 150, 'hourly_rate mapped to rate');
  assert.equal(ct.contract_status, 'signing', "pending mapped to signing (mutation: no CASE -> CHECK violation / 'pending' -> red)");
  assert.equal(ct.conversation_id, 5);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='signing_contracts'").get().c, 0, 'signing_contracts dropped');

  // Rerun: zero change (idempotent).
  await migrateContractSchema(db, { phase: 'postEnsure' });
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contracts').get().c, 1, 'rerun copies nothing');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='signing_contracts'").get().c, 0);
});

// ============================================================
// migrated: draft entry strips the business separator
// ============================================================

test('Q-2e-F3: draft entry strips the business separator injected in schedule/plan/location', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S } = await seed(db, raw);
  const SEP = '<!-- 业务条款结束，以下法律条款由平台固定，不可修改 -->';
  const r = await handleCreateContract(db, {
    ...contractBody(1),
    schedule: '每周六晚' + SEP + '恶意尾部',
    plan: '补基础' + SEP,
    location: '线上' + SEP + 'x',
    capToken: await capOf(raw, 't1', t1S.sessionId, idOf),
  }, reqOf(t1S.token));
  assert.equal(r.status, 201);
  const ct = await dbGetContractById(db, 1);
  // The platform template itself contains exactly one legal separator before the fixed clauses.
  // Any injected extra separator must be stripped (mutation: stripSep removed -> split length 3 -> red).
  assert.equal(ct.contract_md.split(SEP).length, 2, 'SEP appears only once (platform template)');
  assert.ok(!ct.contract_md.includes('恶意尾部<!-- 业务条款结束'), 'injected separator no longer forms a marker');
});

// a signing-state contract whose body was edited after a partial sign must NOT verify
// as invalid. The ledger holds the partial-sign body; handleModifyContract changes the body without
// touching the ledger, so replaying the current draft body against the stale tail would misreport
// invalid. The verify gate limits chain validation to the signed terminal state (revoked rows keep
// status 'signed', so retained evidence still verifies).
test('PA-1e-F2: signing-state verify reports not-signed (no false invalid) after an edit following a partial sign', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  // Partial sign -> ledger gains one entry with the partial-sign body.
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal(ledgerCount(raw, 1), 1, 'precondition: partial sign recorded one ledger entry');
  assert.equal((await dbGetContractById(db, 1)).status, 'signing', 'precondition: still signing');
  // The unconfirmed party edits the body (does not append the ledger) -> the ledger tail is now stale.
  const ver = (await dbGetContractById(db, 1)).version;
  assert.equal((await handleModifyContract(db, 1, { contractMd: '补基础+真题演练', version: ver }, reqOf(s1S.token))).status, 200);
  assert.equal(ledgerCount(raw, 1), 1, 'modify does not append the ledger');
  // Verify must not report invalid: a signing-state contract is a draft, not committed evidence.
  const v = await handleVerifyContract(db, 1, reqOf(s1S.token));
  assert.equal(v.status, 200);
  const data = await v.json();
  // Mutation: dropping the signing-state gate (reverting to unconditional verifyContractLedger)
  // replays the edited body against the stale partial-sign tail -> data.valid becomes false -> red.
  assert.equal(data.valid, undefined, 'signing-state verify returns no validity verdict (not invalid)');
  assert.equal(data.signed, false, 'signing-state verify reports not-signed');
  assert.equal(data.status, 'signing', 'signing-state verify reports current status');
});

// ============================================================
// capToken guards (dangerous ops) + read-only verify exemption
// ============================================================

test('S5 capToken: create/sign/revoke require a fresh capToken (403); verify is read-only exempt', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { idOf, t1S, s1S } = await seed(db, raw);

  // Draft without capToken -> 403 REAUTH_FAILED (no row written).
  const noCapCreate = await handleCreateContract(db, contractBody(1), reqOf(t1S.token));
  assert.equal(noCapCreate.status, 403);
  assert.equal((await noCapCreate.json()).code, 'AUTH_REAUTH_FAILED');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM contracts').get().c, 0, 'no row written without capToken');

  // With capToken -> 201.
  assert.equal((await handleCreateContract(db, { ...contractBody(1), capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 201);
  // Sign without capToken -> 403.
  assert.equal((await handleSignContract(db, 1, {}, reqOf(t1S.token))).status, 403);
  assert.equal(ledgerCount(raw, 1), 0, 'no ledger write without capToken');
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 't1', t1S.sessionId, idOf) }, reqOf(t1S.token))).status, 200);
  assert.equal((await handleSignContract(db, 1, { capToken: await capOf(raw, 's1', s1S.sessionId, idOf) }, reqOf(s1S.token))).status, 200);
  // Revoke without capToken -> 403.
  assert.equal((await handleRevokeContract(db, 1, {}, reqOf(t1S.token))).status, 403);
  assert.equal((await dbGetContractById(db, 1)).revoked, 0, 'not revoked without capToken');
  // Verify is read-only: no capToken needed.
  const v = await handleVerifyContract(db, 1, reqOf(t1S.token));
  assert.equal(v.status, 200);
  assert.equal((await v.json()).valid, true, 'verify exempt from capToken');
});
