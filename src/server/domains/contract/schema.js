/**
 * contract 域 schema（V-1-4b）：合同表 DDL / 存证台账 DDL / 列迁移 / 域专属迁移。
 */
import { dbAll, dbRun, ensureColumns as addColumns } from '../../core/util.js';

export const CONTRACTS_DDL = `CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  drafter_user_id INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'online',
  plan TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT '',
  pay_method_other TEXT NOT NULL DEFAULT '',
  first_lesson_date TEXT NOT NULL DEFAULT '',
  trial_pay TEXT NOT NULL DEFAULT '',
  trial_pay_other TEXT NOT NULL DEFAULT '',
  contract_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','signing','signed')),
  drafter_confirmed INTEGER NOT NULL DEFAULT 0,
  other_confirmed INTEGER NOT NULL DEFAULT 0,
  drafter_signed_at TEXT NOT NULL DEFAULT '',
  other_signed_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_by INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`;

export const createStatements = [CONTRACTS_DDL];

export const ensureColumns = [
  { table: 'contracts', columns: [
    ['demand_id', 'INTEGER'], ['schedule', "TEXT NOT NULL DEFAULT ''"], ['location', "TEXT NOT NULL DEFAULT ''"],
    ['pay_method', "TEXT NOT NULL DEFAULT ''"], ['pay_method_other', "TEXT NOT NULL DEFAULT ''"],
    ['first_lesson_date', "TEXT NOT NULL DEFAULT ''"], ['trial_pay', "TEXT NOT NULL DEFAULT ''"], ['trial_pay_other', "TEXT NOT NULL DEFAULT ''"],
    ['version', 'INTEGER NOT NULL DEFAULT 0'],
    ['prev_business', 'TEXT'],
    ['drafter_signed_at', "TEXT NOT NULL DEFAULT ''"],
    ['other_signed_at', "TEXT NOT NULL DEFAULT ''"],
    ['revoked', 'INTEGER NOT NULL DEFAULT 0'],
    ['revoked_by', 'INTEGER NOT NULL DEFAULT 0'],
    // AI-3：contracts 自持双方元组（relation 抽象父类下平级子实体，业务不再依赖 conversation join；
    // conversation_id 列保留作历史关联与 FK 级联，归属/门禁全走双方元组）
    ['student_user_id', 'INTEGER'], ['teacher_user_id', 'INTEGER'],
  ] },
];

// 旧预留 contracts 表（student/teacher 直连 + active/ended 状态）从未启用过：检测到旧形状即整体换新
async function migrateContractsShape(db) {
  const rows = (await dbAll(db, 'PRAGMA table_info(contracts)')).map(c => c.name);
  if (rows.length && !rows.includes('conversation_id')) {
    await dbRun(db, 'DROP TABLE contracts');
    await dbRun(db, CONTRACTS_DDL);
  }
}

export async function migrate(db, ctx) {
  if (ctx.phase === 'postCreate') {
    await migrateContractsShape(db);
  } else if (ctx.phase === 'postEnsure') {
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_contracts_conv ON contracts(conversation_id)');
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_contracts_demand ON contracts(demand_id)');
    // AI-3：contracts 双方元组存量回填（按 conversation_id 反查会话，幂等只填空不覆写）
    await dbRun(db, `UPDATE contracts SET
        student_user_id = (SELECT c.student_user_id FROM conversations c WHERE c.id = contracts.conversation_id),
        teacher_user_id = (SELECT c.teacher_user_id FROM conversations c WHERE c.id = contracts.conversation_id)
      WHERE student_user_id IS NULL OR teacher_user_id IS NULL`);
  }
}

// ============================================================
// 存证台账（可选独立 LEDGER_DB）：从 contract/api.js 迁入（V-1-4b）
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
}
