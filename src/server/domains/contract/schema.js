/**
 * Contract domain schema (S5 independent tables).
 * - Standalone `contracts` table: signing layer dropped (no stage/signing_status/demand_id/initiator/
 *   price), 2-state contract_status, both-party tuple, conversation_id plain historical link WITHOUT FK
 *   (independent record: deleting a conversation never cascades away signed/revoked contracts).
 * - Ledger table contract_ledger + domain migration.
 */
import { dbGet, dbRun, ensureColumns as addColumns } from '../../core/util.js';


// standalone contracts table (replaces signing_contracts merged table).
// No FK on conversation_id: contract records are self-contained evidence, surviving conversation deletion.
export const CONTRACTS_DDL = `CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_user_id INTEGER NOT NULL,
  teacher_user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  contract_status TEXT NOT NULL DEFAULT 'signing' CHECK(contract_status IN ('signing','signed')),
  drafter_user_id INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT '',
  rate INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT '',
  pay_method_other TEXT NOT NULL DEFAULT '',
  first_lesson_date TEXT NOT NULL DEFAULT '',
  trial_pay TEXT NOT NULL DEFAULT '',
  trial_pay_other TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'offline',
  schedule TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  contract_md TEXT NOT NULL DEFAULT '',
  prev_business TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  drafter_confirmed INTEGER NOT NULL DEFAULT 0,
  other_confirmed INTEGER NOT NULL DEFAULT 0,
  drafter_signed_at TEXT NOT NULL DEFAULT '',
  other_signed_at TEXT NOT NULL DEFAULT '',
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_by INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')))`;

export const createStatements = [CONTRACTS_DDL]; // contracts is the only entity table; table is self-sufficient

// no column additions needed (contracts DDL is complete)
export const ensureColumns = [];

export async function migrate(db, ctx) {
  if (ctx.phase !== 'postEnsure') return;
  // hot-query indexes (tuple lookup / historical conversation association; idempotent)
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_contracts_tuple ON contracts(student_user_id, teacher_user_id)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_contracts_conv ON contracts(conversation_id)');
  // legacy migration from the a merged signing_contracts table (idempotent).
  // Fresh DB: createStatements already built contracts and no signing_contracts exists -> skip copy.
  const hasSc = await dbGet(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='signing_contracts'");
  if (hasSc) {
    // id preserved 1:1 (contract number #CD{id} and ledger contract_id stay unchanged -> ledger zero-remap).
    // contract_status mapping: ''/'pending' -> 'signing' (new 2-state), 'signing'/'signed' pass through.
    await dbRun(db, `INSERT OR IGNORE INTO contracts (id, student_user_id, teacher_user_id, conversation_id, contract_status, drafter_user_id, plan, rate, pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other, method, schedule, location, contract_md, prev_business, version, drafter_confirmed, other_confirmed, drafter_signed_at, other_signed_at, revoked, revoked_by, created_at, updated_at)
      SELECT id, student_user_id, teacher_user_id, conversation_id, CASE WHEN contract_status IN ('','pending') THEN 'signing' ELSE contract_status END, drafter_user_id, plan, hourly_rate, pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other, method, schedule, location, contract_md, prev_business, version, drafter_confirmed, other_confirmed, drafter_signed_at, other_signed_at, revoked, revoked_by, created_at, updated_at
      FROM signing_contracts WHERE stage='contract'`);
    // signing layer dropped (); DROP also removes its idx_sc_* indexes with the table.
    await dbRun(db, 'DROP TABLE IF EXISTS signing_contracts');
  }
}

// ============================================================
// Evidence ledger (optional standalone LEDGER_DB): migrated from contract/api.js ()
// ============================================================
let LEDGER_OVERRIDE = null;
export function bindLedgerDb(env) { LEDGER_OVERRIDE = (env && env.LEDGER_DB) || null; }
export const getLedgerDb = fallback => LEDGER_OVERRIDE || fallback;

export async function initLedgerTable(db) {
  await dbRun(db, `CREATE TABLE IF NOT EXISTS contract_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now')))`);
  await addColumns(db, 'contract_ledger', [
    ['seq', 'INTEGER'],
    ['body_hash', "TEXT NOT NULL DEFAULT ''"],
  ]);
  await dbRun(db, `UPDATE contract_ledger SET seq=(SELECT COUNT(*) FROM contract_ledger c2 WHERE c2.contract_id=contract_ledger.contract_id AND c2.id<=contract_ledger.id) WHERE seq IS NULL`);
  // contracts.id is preserved 1:1 from signing_contracts.id for migrated rows -> ledger contract_id
  // is unchanged and content_hash stays valid -> zero remap / zero rehash. migrateLedgerContractId removed.
}
