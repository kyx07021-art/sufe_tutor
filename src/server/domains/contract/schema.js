/**
 * contract 域 schema（V-1-4b + AI-4a/5）：signing_contracts 合并表 DDL（签约/合同同一实体不同 stage）/ 存证台账 DDL / 域专属迁移。
 */
import { dbAll, dbGet, dbRun, ensureColumns as addColumns } from '../../core/util.js';
import { decryptField } from '../../core/crypto.js'; // AI-4a: ledger rehash needs contract_md decrypt


// AI-4a: signing/contract merged table (same entity, stage progresses signing->contract)
export const SIGNING_CONTRACTS_DDL = `CREATE TABLE IF NOT EXISTS signing_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_user_id INTEGER NOT NULL,
  teacher_user_id INTEGER NOT NULL,
  demand_id INTEGER,
  conversation_id INTEGER,
  stage TEXT NOT NULL DEFAULT 'signing' CHECK(stage IN ('signing','contract')),
  signing_status TEXT NOT NULL DEFAULT 'pending' CHECK(signing_status IN ('pending','signed','rejected')),
  initiator_user_id INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  schedule TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'offline',
  message_id INTEGER,
  responded_at DATETIME,
  contract_status TEXT NOT NULL DEFAULT '' CHECK(contract_status IN ('','pending','signing','signed')),
  drafter_user_id INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT '',
  pay_method_other TEXT NOT NULL DEFAULT '',
  first_lesson_date TEXT NOT NULL DEFAULT '',
  trial_pay TEXT NOT NULL DEFAULT '',
  trial_pay_other TEXT NOT NULL DEFAULT '',
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
  legacy_contract_id INTEGER,
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)`;

export const createStatements = [SIGNING_CONTRACTS_DDL]; // AI-5: 旧 contracts 表已删（AI-4a 迁移数据 + AI-4b 读写切换后唯一实体表）

// AI-5: signing_contracts DDL 完整自足（AI-4a 合并全字段），无补列需求——旧 contracts ensureColumns 随表删
export const ensureColumns = [];

export async function migrate(db, ctx) {
  if (ctx.phase !== 'postEnsure') return;
  // AI-5: 旧 contracts 表数据已由 AI-4a 迁入 signing_contracts、读写已由 AI-4b 全切——删表（幂等清理；
  // 跳过 v12 的旧库不保迁移，W1 不保留向后兼容）
  await dbRun(db, 'DROP TABLE IF EXISTS contracts');
  // signing_contracts 热查询索引（起草定位/元组过滤/绑定下拉；postEnsure 幂等）
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_sc_conv ON signing_contracts(conversation_id, stage, signing_status)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_sc_demand ON signing_contracts(demand_id, stage)');
  await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_sc_tuple ON signing_contracts(student_user_id, teacher_user_id, stage)');
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
  await migrateLedgerContractId(db); // AI-4a: ledger contract_id remap + content_hash rehash
}

const sha256Hex = async text => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

// AI-4a: remap ledger contract_id old contracts.id -> signing_contracts.id and rehash content_hash chain.
// BUG-1 修复: 重算 content_hash 的同时把本行 prev_hash 更新为上一行新 content_hash（verifyChain 逐条比较
// prev_hash === 上一条 content_hash；只改 content_hash 不改 prev_hash 则多条目链 link break）。
// 幂等: remap+hash 同一 db.batch 原子（失败回滚下次重跑）；成功后 legacy_contract_id JOIN 不匹配 -> 跳过。
// 仅同库场景（独立 LEDGER_DB 本库无 signing_contracts -> 跳过，backlog）。
async function migrateLedgerContractId(db) {
  const hasSc = await dbGet(db, "SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='signing_contracts'");
  if (!hasSc) return;
  const affected = await dbAll(db, `SELECT DISTINCT sc.id AS new_id, sc.legacy_contract_id AS old_id
    FROM signing_contracts sc JOIN contract_ledger l ON l.contract_id = sc.legacy_contract_id`);
  if (!affected.length) return;
  const stmts = [db.prepare(`UPDATE contract_ledger SET contract_id = (
      SELECT sc.id FROM signing_contracts sc WHERE sc.legacy_contract_id = contract_ledger.contract_id)
    WHERE contract_id IN (SELECT legacy_contract_id FROM signing_contracts WHERE legacy_contract_id IS NOT NULL)`)];
  for (const a of affected) {
    const rows = await dbAll(db, 'SELECT id, body_hash, created_at FROM contract_ledger WHERE contract_id=? ORDER BY id ASC', [a.old_id]);
    let prev = 'GENESIS';
    for (const r of rows) {
      let bodyHash = r.body_hash || '';
      if (!bodyHash) {
        // legacy rows without body_hash (pre Z-5-F3): recompute from contract_md (same DB; failure -> keep empty, verify invalid exposes)
        const sc = await dbGet(db, 'SELECT contract_md FROM signing_contracts WHERE id=?', [a.new_id]);
        if (sc && sc.contract_md) { try { bodyHash = await sha256Hex(await decryptField(sc.contract_md)); } catch { bodyHash = ''; } }
      }
      const contentHash = await sha256Hex(`${bodyHash}|${a.new_id}|${r.created_at}|${prev}`); // new id in hash (verify same rule)
      stmts.push(db.prepare('UPDATE contract_ledger SET content_hash=?, prev_hash=? WHERE id=?').bind(contentHash, prev, r.id)); // BUG-1: relink prev_hash
      prev = contentHash;
    }
  }
  await db.batch(stmts);
}
