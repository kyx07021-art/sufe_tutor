/**
 * S2-T3/S2-T4/S2-T6: temp conversation repo layer — dbCreateTempConversation (),
 * tuple lookup temp fields, dbGetMyConversations temp visibility (),
 * dbGetMyRelations temp fields (), dbPrepareTempAdvance (init -> sent -> NULL).
 *
 * Data-layer direct tests (d1Shim in-memory SQLite, initDb pattern from my-relations.test.js).
 * The temp columns live in chat/schema.js (S2-T1 owns the migration); until it lands the columns
 * may be absent, so the seed ensures them idempotently (no-op once the schema adds them).
 *
 * Mutation guards (auditor verifies by temporarily reverting):
 * - removing the temp columns from the SELECT lists of dbGetConversationByTuple /
 * dbGetMyConversations / dbGetMyRelations -> temp_status / temp_initiator_user_id come back
 * undefined -> the field assertions below go red.
 * - removing the whole temp visibility AND-condition in dbGetMyConversations -> the receiver sees
 * the init row -> the leak-prevention assertion (receiver does NOT see init) goes red.
 * - removing only the `temp_status <> 'init'` term -> the sent row becomes invisible to the
 * receiver (temp_initiator is not the receiver) -> the sent-visible assertion goes red.
 * - removing the `temp_status=?` guard in dbPrepareTempAdvance -> the re-advance changes=0
 * assertion goes red (the row would move again from NULL).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  dbGetConversationByTuple,
  dbCreateTempConversation,
  dbGetMyConversations,
  dbGetMyRelations,
  dbPrepareTempAdvance,
} from '../src/server/domains/chat/repo.js';
import { TEMP_STATUS } from '../src/shared/enums.js';

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
// Close the sqlite handle when the test ends so the runner exits promptly (pattern: api-batch/schema-meta).
const mkRaw = (t) => {
  const raw = rawOf();
  t.after(() => { try { raw.close(); } catch { /* already closed */ } });
  return raw;
};

// S2-T1 owns the schema migration; ensure the temp columns exist idempotently (no-op once schema adds them).
function ensureTempColumns(raw) {
  const cols = raw.prepare(`SELECT name FROM pragma_table_info('conversations')`).all().map(r => r.name);
  if (!cols.includes('temp_status')) {
    raw.prepare(`ALTER TABLE conversations ADD COLUMN temp_status TEXT CHECK(temp_status IN ('init','sent'))`).run();
  }
  if (!cols.includes('temp_initiator_user_id')) {
    raw.prepare(`ALTER TABLE conversations ADD COLUMN temp_initiator_user_id INTEGER`).run();
  }
}

// Seed: s1/t1 (formal pair, c1 active), s2/t2 (fresh tuple for temp tests). All ids via lastInsertRowid.
async function seed(db, raw) {
  await initDb(db, ENV);
  ensureTempColumns(raw);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')");
  const s2 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s2','h','s','student')");
  const t2 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')");
  const c1 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t1},'active')`);
  return { s1, t1, s2, t2, c1 };
}

test('dbGetConversationByTuple returns temp fields (formal row -> temp_status NULL)', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const row = await dbGetConversationByTuple(db, s1, t1);
  assert.equal(row.id, c1);
  assert.equal(row.temp_status, null, 'formal row temp_status NULL');
  assert.equal(row.temp_initiator_user_id, null, 'formal row has no initiator');
});

test('dbCreateTempConversation creates an init row and is idempotent on the same tuple', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s2, t2 } = await seed(db, raw);
  const a = await dbCreateTempConversation(db, s2, t2, s2);
  assert.ok(a && a.id > 0, 'creates a row and returns its id');
  assert.equal(a.temp_status, TEMP_STATUS.INIT, 'temp_status init');
  assert.equal(a.temp_initiator_user_id, s2, 'initiator recorded');
  const row = raw.prepare('SELECT status, temp_status, temp_initiator_user_id FROM conversations WHERE id=?').get(a.id);
  assert.equal(row.status, 'active', 'temp conversation starts active');
  assert.equal(row.temp_status, TEMP_STATUS.INIT, 'db row temp_status init');
  assert.equal(row.temp_initiator_user_id, s2, 'db row initiator recorded');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 2, 'formal c1 + temp = 2');
  const b = await dbCreateTempConversation(db, s2, t2, s2);
  assert.equal(b.id, a.id, 'duplicate tuple resolves to the existing row');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 2, 'no duplicate row');
});

test('dbCreateTempConversation returns a pre-existing formal row unchanged (INSERT OR IGNORE semantics)', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const a = await dbCreateTempConversation(db, s1, t1, s1);
  assert.equal(a.id, c1, 'existing formal conversation reused, not a new temp row');
  assert.equal(a.temp_status, null, 'formal row stays formal');
  assert.equal(a.temp_initiator_user_id, null, 'formal row has no temp initiator');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, 'no new row');
});

test('dbGetMyConversations temp visibility: initiator sees init; receiver does NOT see init; both see sent; formal visible to both', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s1, t1, s2, t2, c1 } = await seed(db, raw);
  // tempInit: s2 initiates with t2, stays init (invisible to receiver t2).
  const tempInit = await dbCreateTempConversation(db, s2, t2, s2);
  // tempSent: s1 initiates with t2, then advanced to sent (visible to receiver t2).
  const tempSent = await dbCreateTempConversation(db, s1, t2, s1);
  const adv = dbPrepareTempAdvance(db);
  const moved = adv.run(TEMP_STATUS.SENT, tempSent.id, TEMP_STATUS.INIT);
  assert.equal(moved.meta.changes, 1, 'init -> sent transition setup');

  // Initiator sees their init row.
  const s2Convs = await dbGetMyConversations(db, s2);
  const s2Ids = s2Convs.map(r => r.id);
  assert.ok(s2Ids.includes(tempInit.id), 'initiator s2 sees own init row');
  const s2Init = s2Convs.find(r => r.id === tempInit.id);
  assert.equal(s2Init.temp_status, TEMP_STATUS.INIT, 'init row carries temp_status init');
  assert.equal(s2Init.temp_initiator_user_id, s2, 'init row carries initiator');

  // Receiver does NOT see the init row (existence-leak prevention).
  const t2Convs = await dbGetMyConversations(db, t2);
  const t2Ids = t2Convs.map(r => r.id);
  assert.ok(!t2Ids.includes(tempInit.id), 'receiver t2 does NOT see init row (leak prevention)');
  // Receiver DOES see the sent row.
  assert.ok(t2Ids.includes(tempSent.id), 'receiver t2 sees sent row');
  const t2Sent = t2Convs.find(r => r.id === tempSent.id);
  assert.equal(t2Sent.temp_status, TEMP_STATUS.SENT, 'sent row carries temp_status sent');
  assert.equal(t2Sent.temp_initiator_user_id, s1, 'sent row carries original initiator (wasTemp)');

  // Initiator sees their sent row too.
  const s1Convs = await dbGetMyConversations(db, s1);
  const s1Ids = s1Convs.map(r => r.id);
  assert.ok(s1Ids.includes(tempSent.id), 'initiator s1 sees own sent row');
  assert.ok(s1Ids.includes(c1), 'formal c1 visible to participant s1');
  assert.ok(!s1Ids.includes(tempInit.id), 's1 is not a participant of tempInit (not listed)');

  // Formal row visible to the other participant.
  const t1Convs = await dbGetMyConversations(db, t1);
  assert.ok(t1Convs.map(r => r.id).includes(c1), 'formal c1 visible to participant t1');
});

test('dbGetMyRelations exposes temp fields on relation rows (I-15)', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s1, t1, s2, t2, c1 } = await seed(db, raw);
  // S5 owns the signing layer; the standalone contracts refactor dropped signing_contracts from the
  // schema. dbGetMyRelations still LEFT JOINs it (S5's in-flight work), so a minimal empty stub keeps
  // this test scoped to the temp fields it verifies. No-op after S5 lands (join target changes).
  raw.prepare(`CREATE TABLE IF NOT EXISTS signing_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER, teacher_user_id INTEGER, conversation_id INTEGER,
    stage TEXT, signing_status TEXT, contract_status TEXT, revoked INTEGER NOT NULL DEFAULT 0)`).run();
  const temp = await dbCreateTempConversation(db, s2, t2, s2);
  // Initiator relation row carries temp fields.
  const s2Rels = await dbGetMyRelations(db, s2);
  const rel = s2Rels.find(r => r.id === temp.id);
  assert.ok(rel, 'initiator relation listed');
  assert.equal(rel.temp_status, TEMP_STATUS.INIT, 'relation row carries temp_status');
  assert.equal(rel.temp_initiator_user_id, s2, 'relation row carries initiator');
  // Formal relation row has NULL temp fields.
  const s1Rels = await dbGetMyRelations(db, s1);
  const formalRel = s1Rels.find(r => r.id === c1);
  assert.ok(formalRel, 'formal relation listed');
  assert.equal(formalRel.temp_status, null, 'formal relation temp_status NULL');
  assert.equal(formalRel.temp_initiator_user_id, null, 'formal relation has no temp initiator');
});

test('dbPrepareTempAdvance formalizes sent -> NULL and re-advance changes=0', async (t) => {
  const raw = mkRaw(t); const db = d1Shim(raw);
  const { s2, t2 } = await seed(db, raw);
  const temp = await dbCreateTempConversation(db, s2, t2, s2);
  const prep = dbPrepareTempAdvance(db);
  // init -> sent
  const r1 = prep.run(TEMP_STATUS.SENT, temp.id, TEMP_STATUS.INIT);
  assert.equal(r1.meta.changes, 1, 'init -> sent transition wins');
  // sent -> NULL formalize (receiver reply)
  const r2 = prep.run(null, temp.id, TEMP_STATUS.SENT);
  assert.equal(r2.meta.changes, 1, 'sent -> NULL formalize wins');
  const row = raw.prepare('SELECT temp_status, temp_initiator_user_id FROM conversations WHERE id=?').get(temp.id);
  assert.equal(row.temp_status, null, 'formalized: temp_status NULL');
  assert.equal(row.temp_initiator_user_id, s2, 'wasTemp retained on formalization');
  // re-advance: current is NULL, binding current='sent' no longer matches
  const r3 = prep.run(null, temp.id, TEMP_STATUS.SENT);
  assert.equal(r3.meta.changes, 0, 're-advance changes=0 (idempotent guard)');
});
