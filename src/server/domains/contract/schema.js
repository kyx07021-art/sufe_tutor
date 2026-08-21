/**
 * contract 域 schema（V-1-4b）：合同表 DDL / 存证台账 DDL / 列迁移 / 域专属迁移。
 */
import { dbAll, dbGet, dbRun, ensureColumns as addColumns } from '../../core/util.js';
import { decryptField } from '../../core/crypto.js'; // AI-4a: ledger rehash needs contract_md decrypt

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

export const createStatements = [CONTRACTS_DDL, SIGNING_CONTRACTS_DDL];

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
    // AI-4a: migrate signing_requests -> signing_contracts (keep original id so bubble body signing ids stay valid)
    await dbRun(db, `INSERT OR IGNORE INTO signing_contracts
      (id, student_user_id, teacher_user_id, demand_id, conversation_id, stage, signing_status,
       initiator_user_id, price, schedule, method, message_id, responded_at, created_at)
      SELECT id, student_user_id, teacher_user_id, demand_id, conversation_id, 'signing', status,
             initiator_user_id, price, schedule, method, message_id, responded_at, created_at
      FROM signing_requests`);
    // AI-4a: contracts linked to a confirmed signing (same conversation+demand) merge into that row, stage -> contract
    // F-3: JOIN 双方 demand_id 均 COALESCE(demand_id,-1) 归一（与 BUG-2 独立行同口径，NULL 语义一致）
    await dbRun(db, `UPDATE signing_contracts SET
        stage='contract', contract_status=ct.status, drafter_user_id=ct.drafter_user_id,
        plan=ct.plan, hourly_rate=ct.hourly_rate, pay_method=ct.pay_method, pay_method_other=ct.pay_method_other,
        schedule=ct.schedule, method=ct.method,
        first_lesson_date=ct.first_lesson_date, trial_pay=ct.trial_pay, trial_pay_other=ct.trial_pay_other,
        location=ct.location, contract_md=ct.contract_md, prev_business=ct.prev_business, version=ct.version,
        drafter_confirmed=ct.drafter_confirmed, other_confirmed=ct.other_confirmed,
        drafter_signed_at=ct.drafter_signed_at, other_signed_at=ct.other_signed_at,
        revoked=ct.revoked, revoked_by=ct.revoked_by, legacy_contract_id=ct.id, updated_at=ct.updated_at
      FROM contracts ct
      WHERE signing_contracts.stage='signing' AND signing_contracts.signing_status='signed'
        AND signing_contracts.conversation_id=ct.conversation_id
        AND COALESCE(signing_contracts.demand_id,-1)=COALESCE(ct.demand_id,-1)`);
    // AI-4a: contracts without a linked signing become standalone rows stage='contract'
    // BUG-2: NOT EXISTS 用 COALESCE(demand_id,-1) 比较——NULL demand 合同复跑迁移不重复插行
    // F-2: 裸 INSERT 加 OR IGNORE（与 migration a 对称，防悬空 NULL 违约崩全量迁移）
    await dbRun(db, `INSERT OR IGNORE INTO signing_contracts
      (student_user_id, teacher_user_id, demand_id, conversation_id, stage, signing_status, contract_status,
       drafter_user_id, plan, hourly_rate, pay_method, pay_method_other, first_lesson_date, trial_pay, trial_pay_other,
       schedule, method,
       location, contract_md, prev_business, version, drafter_confirmed, other_confirmed,
       drafter_signed_at, other_signed_at, revoked, revoked_by, legacy_contract_id, created_at, updated_at)
      SELECT ct.student_user_id, ct.teacher_user_id, ct.demand_id, ct.conversation_id, 'contract', 'signed', ct.status,
             ct.drafter_user_id, ct.plan, ct.hourly_rate, ct.pay_method, ct.pay_method_other, ct.first_lesson_date, ct.trial_pay, ct.trial_pay_other,
             ct.schedule, ct.method,
             ct.location, ct.contract_md, ct.prev_business, ct.version, ct.drafter_confirmed, ct.other_confirmed,
             ct.drafter_signed_at, ct.other_signed_at, ct.revoked, ct.revoked_by, ct.id, ct.created_at, ct.updated_at
      FROM contracts ct
      WHERE NOT EXISTS (SELECT 1 FROM signing_contracts sc WHERE sc.conversation_id=ct.conversation_id
        AND COALESCE(sc.demand_id,-1)=COALESCE(ct.demand_id,-1))`);
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
