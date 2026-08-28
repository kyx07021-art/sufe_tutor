/**
 * contract mappers expose the `contractStatus` alias — the new frontend reads
 * `contractStatus` on contract rows; `status` is retained for internal/legacy consumers. The alias
 * is added in all three mappers (detail / my-contracts / admin-all).
 *
 * Self-contained on purpose: it imports only the repo mappers (contract/repo.js -> core/{util,crypto}.js,
 * no server/version.js chain) so it keeps running even while parallel agents leave the broader module
 * graph transiently broken. Mutation: dropping `AS contractStatus` in any mapper -> contractStatus
 * undefined -> red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CONTRACTS_DDL } from '../src/server/domains/contract/schema.js';
import { dbGetContractById, dbGetMyContracts, dbGetAllContractsAdmin } from '../src/server/domains/contract/repo.js';

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

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(CONTRACTS_DDL);
  // Minimal users table (the mappers join it for display names).
  raw.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL, password_hash TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'student')`);
  raw.exec(`INSERT INTO users (username, password_hash, salt, role) VALUES
    ('s1','h','s','student'), ('t1','h','s','teacher')`);
  // One signing-state contract (drafter = t1; contract_md empty to skip crypto key setup).
  raw.exec(`INSERT INTO contracts (student_user_id, teacher_user_id, conversation_id, contract_status, drafter_user_id, contract_md)
    VALUES (1, 2, 5, 'signing', 2, '')`);
  return { raw, db: d1Shim(raw) };
}

test('PA-1e-F3: contract mappers expose contractStatus alias (I-44) alongside status', async () => {
  const { raw, db } = await setup();

  // Detail mapper.
  const ct = await dbGetContractById(db, 1);
  assert.equal(ct.contractStatus, 'signing', 'detail row exposes contractStatus (mutation: alias dropped -> undefined -> red)');
  assert.equal(ct.status, 'signing', 'status alias retained for internal consumers');

  // My-contracts list mapper (s1 is the student participant).
  const mine = await dbGetMyContracts(db, 1);
  assert.equal(mine.length, 1, 'participant sees the contract');
  assert.equal(mine[0].contractStatus, 'signing', 'my-contracts row exposes contractStatus');
  assert.equal(mine[0].status, 'signing', 'my-contracts row retains status');
  assert.equal(mine[0].student_name, 's1', 'join student name present');
  assert.equal(mine[0].teacher_name, 't1', 'join teacher name present');

  // Admin-all list mapper.
  const all = await dbGetAllContractsAdmin(db);
  assert.equal(all.length, 1, 'admin-all sees the contract');
  assert.equal(all[0].contractStatus, 'signing', 'admin-all row exposes contractStatus');
  assert.equal(all[0].status, 'signing', 'admin-all row retains status');
  assert.equal(all[0].drafter_name, 't1', 'drafter name present');
});
