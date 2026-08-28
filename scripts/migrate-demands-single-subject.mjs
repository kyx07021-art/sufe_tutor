/**
 * student_demands 数组模型 → 单科目新模型 存量迁移（S3 ）
 *
 * Migrates the legacy v2 array-shaped `student_demands` table
 * (target_subjects JSON array / current_scores JSON array / status open|contracted|revoked)
 * to the S3 single-subject model (subject single value / current_score single value / status
 * open|closed). Mirrors the S3 DDL in src/server/domains/demand/schema.js (the script is
 * self-contained so it can run against production D1 before the new-site deploy; a parity
 * test locks the column sets together).
 *
 * Migration rules:
 * - Each legacy row is split into N rows, one per target_subjects element; the other fields
 * are copied verbatim: grade=student_grade, province, teaching_method, address_area=address,
 * expected_time, preferred_tags=preferred_personality_tags, preferred_gender=preferred_teacher_gender,
 * budget_min/max, additional_info, created_at.
 * - current_score = score of that subject from the current_scores array (fall back to the
 * grade letter when score is empty, else '').
 * - status mapping: open→open; contracted→closed (already transacted, no longer accepting
 * intents); revoked→open (revocation returns the demand to the open pool).
 * - A row whose target_subjects is empty/invalid is dropped with a warning (no dirty rows).
 * - Idempotent: re-running is a no-op once every row carries a non-empty `subject` (the
 * "already migrated" signal). Mixed-shape tables (schema.js ensureColumns path, where the
 * new columns were added but old rows still have subject='') are re-split correctly.
 * - Table shape: default rebuilds in place — DROP the old table, rename the new table into
 * `student_demands`; `--keep-old` preserves the old table as `student_demands_legacy`.
 *
 * NOTE (FK cascade): dropping the old parent table with foreign_keys=ON implicitly runs
 * ON DELETE CASCADE against demand_intents / demand_pushes, wiping their rows. Those two
 * sub-systems are in S2's deletion scope (⑤), so this is intentional; it is surfaced in
 * the --apply output.
 *
 * NOTE (R-1 · conversations preservation): chat/schema.js declares
 * conversations.demand_id REFERENCES student_demands(id) ON DELETE SET NULL,
 * so dropping the legacy table would NULL out every conversation's demand link. This migration
 * preserves the link with two co-operating mechanisms:
 * 1. id preservation — each legacy row's FIRST split row keeps the legacy id (AUTOINCREMENT
 * continues past the largest preserved id), so the old demand_id value resolves to a valid
 * row in the new table after the swap. This alone would be enough if the DROP did not fire
 * FK actions, but it does.
 * 2. snapshot-restore — because D1 enforces foreign keys always-on and cannot toggle
 * `PRAGMA foreign_keys`, the ON DELETE SET NULL from the DROP cannot be prevented. So the
 * old id → conversation mapping is snapshotted before the DROP and re-applied after the
 * swap (the preserved ids are valid in the new table). The local path mirrors the SQL path.
 *
 * Modes:
 * node scripts/migrate-demands-single-subject.mjs --dry-run # read-only statistics
 * node scripts/migrate-demands-single-subject.mjs --apply # execute the migration
 * node scripts/migrate-demands-single-subject.mjs --drill # in-memory self-check
 * node scripts/migrate-demands-single-subject.mjs --help
 * (add --keep-old to preserve the old table instead of dropping it)
 *
 * Reads go through the d1ReadQuery semantic read-only gate (changed_db=false asserted);
 * writes execute one transactional SQL file via `wrangler d1 execute --file`.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// New-shape DDL (S3 ; single source of truth = src/server/domains/demand/schema.js).
// The `student_demands_new` name is swapped to `student_demands` by the migration.
// ---------------------------------------------------------------------------
export const STUDENT_DEMANDS_NEW_DDL = `CREATE TABLE IF NOT EXISTS student_demands_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,                -- single subject (split from target_subjects array)
      grade TEXT NOT NULL,                  -- was student_grade
      province TEXT DEFAULT '',
      teaching_method TEXT NOT NULL DEFAULT 'online',   -- online|offline|both
      current_score TEXT DEFAULT '',        -- single value (score string or grade letter)
      address_area TEXT DEFAULT '',         -- was address
      expected_time TEXT DEFAULT '',
      preferred_tags TEXT NOT NULL DEFAULT '[]',        -- was preferred_personality_tags
      preferred_gender TEXT NOT NULL DEFAULT '',        -- was preferred_teacher_gender
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      additional_info TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',  -- open|closed (was open|contracted|revoked)
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`;

// Columns read from the legacy table (only what the new model needs).
const OLD_SELECT_COLUMNS = [
  'id', 'user_id', 'province', 'student_grade', 'target_subjects', 'current_scores',
  'teaching_method', 'address', 'expected_time', 'preferred_personality_tags',
  'preferred_teacher_gender', 'budget_min', 'budget_max', 'additional_info', 'status', 'created_at',
];

// ---------------------------------------------------------------------------
// Pure helpers (exported for the test suite)
// ---------------------------------------------------------------------------
export function parseJsonArray(str, fallback) {
  if (str == null) return fallback;
  try {
    const v = JSON.parse(String(str));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Status convergence (⑥): open stays open; contracted is closed; revoked is open again. */
export function mapStatus(status) {
  switch (String(status ?? '')) {
    case 'contracted': return 'closed';
    case 'revoked': return 'open';
    case 'closed': return 'closed';
    case 'open': return 'open';
    default: return 'open';
  }
}

function normalizeJsonArr(v) {
  const arr = parseJsonArray(v, []);
  return Array.isArray(arr) ? JSON.stringify(arr) : '[]';
}

/** score wins; the grade letter (等第) is the fallback so no per-subject value is lost. */
function scoreOf(entry) {
  if (entry == null) return '';
  if (entry.score != null && String(entry.score).trim() !== '') return String(entry.score).trim();
  if (entry.grade != null && String(entry.grade).trim() !== '') return String(entry.grade).trim();
  return '';
}

function emptyStats() {
  return { total: 0, dropped: 0, newRowCount: 0, remapped: 0, status: { open: 0, closed: 0 } };
}
function bumpStatus(stats, status) {
  if (status === 'closed') stats.status.closed++;
  else stats.status.open++;
}

/**
 * Turn legacy (or mixed-shape) demand rows into new-shape rows.
 * @param rows  array of row objects. Old shape: legacy columns only.
 *              Mixed shape (schema.js ensureColumns path): both old and new columns; rows with a
 *              non-empty `subject` are already migrated and are copied verbatim.
 * @param opts.hasSubject  true when the source table already carries the new `subject` column.
 */
export function computeMigratedRows(rows, { hasSubject = false } = {}) {
  const out = [];
  const warnings = [];
  const stats = emptyStats();
  stats.total = rows.length;

  for (const r of rows) {
    // Already-migrated row in a mixed-shape table: carry the new columns through untouched.
    if (hasSubject && r.subject != null && String(r.subject).trim() !== '') {
      const row = {
        _legacyId: r.id,               // memory-only: source legacy id, never written to the DB
        user_id: r.user_id,
        subject: String(r.subject).trim(),
        grade: r.grade ?? r.student_grade ?? '',
        province: r.province ?? '',
        teaching_method: r.teaching_method || 'online',
        current_score: r.current_score ?? '',
        address_area: r.address_area ?? r.address ?? '',
        expected_time: r.expected_time ?? '',
        preferred_tags: normalizeJsonArr(r.preferred_tags ?? r.preferred_personality_tags),
        preferred_gender: r.preferred_gender ?? r.preferred_teacher_gender ?? '',
        budget_min: r.budget_min ?? 0,
        budget_max: r.budget_max ?? 0,
        additional_info: r.additional_info ?? '',
        status: mapStatus(r.status),
        created_at: r.created_at ?? null,
      };
      out.push(row);
      bumpStatus(stats, row.status);
      continue;
    }

    // Legacy array row: split target_subjects into one new row per subject.
    const subjects = parseJsonArray(r.target_subjects, null);
    if (!subjects || subjects.length === 0) {
      stats.dropped++;
      warnings.push(`demand #${r.id}: target_subjects 为空/非法，丢弃`);
      continue;
    }
    const scores = parseJsonArray(r.current_scores, []);
    const scoreBy = new Map();
    for (const s of scores) {
      if (s && s.subject != null && !scoreBy.has(String(s.subject))) {
        scoreBy.set(String(s.subject), scoreOf(s));
      }
    }
    const newStatus = mapStatus(r.status);
    for (const rawSubject of subjects) {
      const subject = String(rawSubject);
      if (!subject) {
        warnings.push(`demand #${r.id}: 空科目元素，跳过`);
        continue;
      }
      const row = {
        _legacyId: r.id,               // memory-only: source legacy id, never written to the DB
        user_id: r.user_id,
        subject,
        grade: r.student_grade ?? '',
        province: r.province ?? '',
        teaching_method: r.teaching_method || 'online',
        current_score: scoreBy.get(subject) ?? '',
        address_area: r.address ?? '',
        expected_time: r.expected_time ?? '',
        preferred_tags: normalizeJsonArr(r.preferred_personality_tags),
        preferred_gender: r.preferred_teacher_gender ?? '',
        budget_min: r.budget_min ?? 0,
        budget_max: r.budget_max ?? 0,
        additional_info: r.additional_info ?? '',
        status: newStatus,
        created_at: r.created_at ?? null,
      };
      out.push(row);
      bumpStatus(stats, row.status);
    }
  }

  stats.newRowCount = out.length;
  return { rows: out, warnings, stats };
}

/**
 * Partition migrated rows into explicit-id rows (the first split row per legacy id) and auto rows,
 * and return the preserved legacy ids. Single source for the R-1 id-preservation strategy shared by
 * the local (runMigrationOnLocal) and SQL (buildApplySql) paths — applyRemote uses the same
 * preservedIds so the post-apply conversations restore expectation matches what the SQL restores.
 */
export function partitionPreservedRows(newRows) {
  const explicitRows = [];
  const autoRows = [];
  const seenLegacy = new Set();
  for (const r of newRows) {
    const legacyId = r._legacyId;
    if (legacyId != null && !seenLegacy.has(legacyId)) {
      seenLegacy.add(legacyId);
      explicitRows.push(r);
    } else {
      autoRows.push(r);
    }
  }
  return { explicitRows, autoRows, preservedIds: [...seenLegacy].map(Number) };
}

/**
 * R-1 · conversations.demand_id restore expectation (Gap 2) — pure.
 * D1 keeps FKs always-on: DROP TABLE student_demands fires ON DELETE SET NULL on every conversation
 * with a non-NULL demand_id, and the buildApplySql snapshot-restore re-points exactly the
 * conversations whose demand_id is a preserved legacy id. So after a successful apply,
 * COUNT(conversations.demand_id IS NOT NULL) must equal the number of conversations whose pre-apply
 * demand_id ∈ preservedIds. Pure so the remote post-check (applyRemote) and the test suite share one
 * source of truth.
 * @param {Array<number|null>} conversationDemandIds  pre-apply conversations.demand_id values
 * @param {number[]}            preservedIds          preserved legacy ids (partitionPreservedRows)
 * @returns {number} expected post-apply COUNT(*) WHERE demand_id IS NOT NULL
 */
export function expectedRestoredConversationCount(conversationDemandIds, preservedIds) {
  const preserved = new Set(preservedIds.map(Number));
  return conversationDemandIds.filter(id => id != null && preserved.has(Number(id))).length;
}

// ---------------------------------------------------------------------------
// Local (node:sqlite) migration core — shared by --drill and the test suite
// ---------------------------------------------------------------------------
export function describeTable(raw, tableName) {
  return raw.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name);
}

/** True when any row still needs migration (old shape, or mixed shape with subject='' rows). */
export function hasUnmigratedRows(raw, tableName) {
  const cols = describeTable(raw, tableName);
  if (!cols.includes('subject')) return true;
  const n = Number(raw.prepare(`SELECT COUNT(*) AS n FROM "${tableName}" WHERE subject IS NULL OR subject=''`).get().n);
  return n > 0;
}

/**
 * Rebuild the legacy table into the S3 shape in place (CREATE _new → INSERT → DROP|KEEP → RENAME).
 * @param raw       node:sqlite DatabaseSync
 * @param tableName table to migrate (default student_demands)
 * @param keepOld   true → keep the old table as <table>_legacy instead of dropping it
 */
export function runMigrationOnLocal(raw, { tableName = 'student_demands', keepOld = false } = {}) {
  const cols = describeTable(raw, tableName);
  const hasSubject = cols.includes('subject');
  if (hasSubject && !hasUnmigratedRows(raw, tableName)) {
    return { alreadyMigrated: true, warnings: [], stats: emptyStats(), rows: [] };
  }
  if (hasSubject && !cols.includes('target_subjects')) {
    throw new Error(
      `table "${tableName}" has empty-subject rows but the legacy target_subjects column is missing — ` +
      `inconsistent intermediate state, cannot split`);
  }

  const rows = raw.prepare(`SELECT * FROM "${tableName}"`).all();
  const { rows: newRows, warnings, stats } = computeMigratedRows(rows, { hasSubject });

  const newTable = `${tableName}_new`;
  raw.exec(`DROP TABLE IF EXISTS "${newTable}"`);
  raw.exec(STUDENT_DEMANDS_NEW_DDL.replaceAll('student_demands_new', newTable));

  // ---- R-1 · id preservation (Approach B, explicit-first) ----
  // Every legacy id's FIRST split row keeps the legacy id; all other split rows go through
  // AUTOINCREMENT. Inserting the explicit-id rows FIRST guarantees AUTOINCREMENT continues past
  // the largest preserved id, so it can never collide with another preserved legacy id. Because
  // conversations.demand_id still holds the old id, it resolves to the first split row after the
  // swap — no per-row remap UPDATE is needed (the least code that stays correct on D1, where the
  // pure-SQL path cannot know AUTOINCREMENT ids in advance).
  const { explicitRows, autoRows, preservedIds } = partitionPreservedRows(newRows);
  const insert = raw.prepare(
    `INSERT INTO "${newTable}" (id, user_id, subject, grade, province, teaching_method, current_score,
       address_area, expected_time, preferred_tags, preferred_gender,
       budget_min, budget_max, additional_info, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of explicitRows) {
    const legacyId = Number(r._legacyId);
    if (!Number.isInteger(legacyId)) throw new Error(`非法 legacy id（${String(r._legacyId)}），无法保留原 id`);
    insert.run(legacyId, r.user_id, r.subject, r.grade, r.province, r.teaching_method, r.current_score,
      r.address_area, r.expected_time, r.preferred_tags, r.preferred_gender,
      r.budget_min, r.budget_max, r.additional_info, r.status, r.created_at);
  }
  for (const r of autoRows) {
    insert.run(null, r.user_id, r.subject, r.grade, r.province, r.teaching_method, r.current_score,
      r.address_area, r.expected_time, r.preferred_tags, r.preferred_gender,
      r.budget_min, r.budget_max, r.additional_info, r.status, r.created_at);
  }

  // ---- R-1 · conversations snapshot-restore ----
  // chat/schema.js declares conversations.demand_id REFERENCES student_demands(id) ON DELETE SET NULL.
  // D1 enforces FKs always-on and cannot toggle `PRAGMA foreign_keys`, so the DROP below would NULL
  // every conversation's demand link. We snapshot the old-id → conversation mapping in memory and
  // re-apply it after the swap — the preserved ids are valid in the new table, so the restore's FK
  // check passes. Local path mirrors the buildApplySql snapshot-restore so both behave identically.
  const convCols = describeTable(raw, 'conversations');
  const hasConversations = convCols.includes('id') && convCols.includes('demand_id');
  let convSnapshot = null;
  if (hasConversations && preservedIds.length > 0) {
    const withDemand = raw.prepare('SELECT id AS conversation_id, demand_id FROM conversations WHERE demand_id IS NOT NULL').all();
    convSnapshot = withDemand.filter(c => {
      const d = Number(c.demand_id);
      return Number.isInteger(d) && preservedIds.includes(d);
    });
  }

  if (keepOld) raw.exec(`ALTER TABLE "${tableName}" RENAME TO "${tableName}_legacy"`);
  else raw.exec(`DROP TABLE "${tableName}"`);
  raw.exec(`ALTER TABLE "${newTable}" RENAME TO "${tableName}"`);

  let remapped = 0;
  if (convSnapshot && convSnapshot.length > 0) {
    const upd = raw.prepare('UPDATE conversations SET demand_id = ? WHERE id = ?');
    for (const c of convSnapshot) {
      upd.run(Number(c.demand_id), c.conversation_id);
      remapped++;
    }
  }
  stats.remapped = remapped;

  return { alreadyMigrated: false, warnings, stats, rows: newRows };
}

// ---------------------------------------------------------------------------
// Production D1 path (wrangler)
// ---------------------------------------------------------------------------
function sq(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build the full apply SQL (single transactional file for `wrangler d1 execute --file`). */
export function buildApplySql(newRows, { keepOld = false } = {}) {
  const stmts = [];
  stmts.push(STUDENT_DEMANDS_NEW_DDL);
  // R-1 · id preservation (same explicit-first strategy as runMigrationOnLocal, so the local path
  // and the D1 path are behaviourally identical). The first split row per legacy id is INSERTed with
  // an explicit `id = legacy id`; every other split row is AUTOINCREMENT.
  const { explicitRows, autoRows, preservedIds } = partitionPreservedRows(newRows);
  const baseCols = `user_id, subject, grade, province, teaching_method, current_score,
      address_area, expected_time, preferred_tags, preferred_gender,
      budget_min, budget_max, additional_info, status, created_at`;
  const baseVals = r => `${sq(r.user_id)}, ${sq(r.subject)}, ${sq(r.grade)}, ${sq(r.province)}, ${sq(r.teaching_method)},
      ${sq(r.current_score)}, ${sq(r.address_area)}, ${sq(r.expected_time)}, ${sq(r.preferred_tags)},
      ${sq(r.preferred_gender)}, ${sq(r.budget_min)}, ${sq(r.budget_max)}, ${sq(r.additional_info)},
      ${sq(r.status)}, ${sq(r.created_at)}`;
  for (const r of explicitRows) {
    const legacyId = Number(r._legacyId);
    if (!Number.isInteger(legacyId)) throw new Error(`非法 legacy id（${String(r._legacyId)}），无法保留原 id`);
    stmts.push(`INSERT INTO student_demands_new (id, ${baseCols}) VALUES (${legacyId}, ${baseVals(r)})`);
  }
  for (const r of autoRows) {
    stmts.push(`INSERT INTO student_demands_new (${baseCols}) VALUES (${baseVals(r)})`);
  }
  // R-1 · conversations snapshot-restore (D1 keeps FKs always-on; `PRAGMA foreign_keys` cannot be
  // toggled there). Snapshot the old-id → conversation mapping, DROP (which fires ON DELETE SET NULL
  // and NULLs every conversation.demand_id), swap the new table into place, then re-point the
  // conversations from the snapshot — preserved ids are valid in the new table, so the FK check
  // passes at commit. Conversations whose legacy demand was dropped (no preserved id) stay NULL.
  if (preservedIds.length > 0) {
    // Unique intermediate name + self-heal on re-run (a partial prior run could have left it behind).
    stmts.push('DROP TABLE IF EXISTS _s3_conv_demand_snapshot');
    stmts.push(`CREATE TABLE _s3_conv_demand_snapshot AS
      SELECT id AS conversation_id, demand_id FROM conversations
      WHERE demand_id IS NOT NULL AND demand_id IN (${preservedIds.map(Number).join(', ')})`);
  }
  if (keepOld) stmts.push('ALTER TABLE student_demands RENAME TO student_demands_legacy');
  else stmts.push('DROP TABLE student_demands');
  stmts.push('ALTER TABLE student_demands_new RENAME TO student_demands');
  if (preservedIds.length > 0) {
    stmts.push(`UPDATE conversations SET demand_id = (
        SELECT s.demand_id FROM _s3_conv_demand_snapshot s WHERE s.conversation_id = conversations.id)
      WHERE id IN (SELECT conversation_id FROM _s3_conv_demand_snapshot) AND demand_id IS NULL`);
    stmts.push('DROP TABLE _s3_conv_demand_snapshot');
  }
  // Hot-path indexes (mirror demand/schema.js migrate()) so the migrated table is queryable immediately.
  stmts.push('CREATE INDEX IF NOT EXISTS idx_demands_created ON student_demands(created_at, id)');
  stmts.push('CREATE INDEX IF NOT EXISTS idx_demands_user ON student_demands(user_id)');
  stmts.push('CREATE INDEX IF NOT EXISTS idx_demands_subject_status ON student_demands(subject, status)');
  return stmts.join(';\n') + ';';
}

/**
 * Read the current student_demands state remotely through the semantic read-only gate.
 * Returns { alreadyMigrated, rows, cols, hasSubject }.
 */
async function readRemoteState() {
  const { d1ReadQuery, D1_DB_NAME } = await import('./wrangler-d1.mjs');
  const cols = d1ReadQuery(D1_DB_NAME, 'PRAGMA table_info(student_demands)').map(c => c.name);
  if (cols.includes('subject')) {
    const empty = Number(d1ReadQuery(D1_DB_NAME, `SELECT COUNT(*) AS n FROM student_demands WHERE subject IS NULL OR subject=''`)[0].n);
    if (empty === 0) return { alreadyMigrated: true, rows: [], cols, hasSubject: true };
    if (!cols.includes('target_subjects')) {
      throw new Error('student_demands 含 subject 空值行但缺少 target_subjects 列——不一致中间态，无法拆分');
    }
    const rows = d1ReadQuery(D1_DB_NAME, 'SELECT * FROM student_demands');
    return { alreadyMigrated: false, rows, cols, hasSubject: true };
  }
  if (!cols.includes('target_subjects')) {
    throw new Error('student_demands 既无 subject 列也无 target_subjects 列——未知表形状');
  }
  const selectCols = OLD_SELECT_COLUMNS.filter(c => cols.includes(c));
  const rows = d1ReadQuery(D1_DB_NAME, `SELECT ${selectCols.join(', ')} FROM student_demands`);
  return { alreadyMigrated: false, rows, cols, hasSubject: false };
}

function printStats(stats) {
  console.log(`旧行数: ${stats.total}`);
  console.log(`将生成新行: ${stats.newRowCount}（丢弃 ${stats.dropped} 行: target_subjects 为空/非法）`);
  console.log(`新 status 分布: open=${stats.status.open}  closed=${stats.status.closed}`);
}

async function dryRunRemote() {
  console.log('== S3-3 student_demands 单科目迁移 --dry-run（只读统计）==\n');
  const state = await readRemoteState();
  if (state.alreadyMigrated) {
    console.log('已迁移：student_demands 已含 subject 列且全部非空，无待迁移数据。');
    return;
  }
  const { rows: newRows, warnings, stats } = computeMigratedRows(state.rows, { hasSubject: state.hasSubject });
  printStats(stats);
  if (warnings.length) {
    console.log('\n警告:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
}

async function applyRemote({ keepOld }) {
  const d1mod = await import('./wrangler-d1.mjs');
  const { d1ReadQuery, runWrangler, D1_DB_NAME } = d1mod;
  console.log(`== S3-3 student_demands 单科目迁移 --apply（${keepOld ? '保留旧表' : '重建表'}）==\n`);
  const state = await readRemoteState();
  if (state.alreadyMigrated) {
    console.log('已迁移：student_demands 已含 subject 列且全部非空，无操作。');
    return;
  }
  const { rows: newRows, warnings, stats } = computeMigratedRows(state.rows, { hasSubject: state.hasSubject });
  printStats(stats);
  if (warnings.length) {
    console.log('\n警告（将丢弃的行）:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (newRows.length === 0 && stats.total > 0) {
    console.log('无新行可生成，中止（避免空表重建）。');
    return;
  }
  if (!keepOld) {
    console.log('\n⚠ DROP 旧表将级联删除 demand_intents / demand_pushes 行（S2 统一删除范围内，有意行为）。');
  }

  // ---- R-1 · conversations.demand_id 恢复后置校验（Gap 2）----
  // 仅重建路径（!keepOld）有 DROP，故只有它面临「DROP 触发 FK ON DELETE SET NULL → 恢复 UPDATE 被中断」
  // 的缺口：中断后会话 demand_id 全 NULL，而新表已就位 → 重跑因 alreadyMigrated 短路、无法自愈，
  // 后置校验是唯一安全网。采用「恢复数匹配」口径：apply 前捕获全部会话 demand_id 值，经纯函数
  // expectedRestoredConversationCount 算出应恢复数（只计 demand_id ∈ 保留 id 的会话——引用被丢弃需求
  // 的会话本就会失去关联，不计入），apply 后断言非空数 === 应恢复数。应恢复数为 0（无关联可保）则跳过。
  const { preservedIds } = partitionPreservedRows(newRows);
  let expectedRestored = null;
  if (!keepOld) {
    try {
      const convCols = d1ReadQuery(D1_DB_NAME, 'PRAGMA table_info(conversations)').map(c => c.name);
      if (convCols.includes('demand_id')) {
        const before = d1ReadQuery(D1_DB_NAME, 'SELECT demand_id FROM conversations').map(r => r.demand_id);
        expectedRestored = expectedRestoredConversationCount(before, preservedIds);
      }
    } catch {
      // conversations 为可选侧表：不存在时无关联可保，后置校验无断言目标。
      expectedRestored = null;
    }
  }

  console.log('\n生成迁移 SQL 并执行…');
  const dir = mkdtempSync(join(tmpdir(), 'sufe-demand-migrate-'));
  const sqlPath = join(dir, 'migrate.sql');
  try {
    writeFileSync(sqlPath, buildApplySql(newRows, { keepOld }), 'utf8');
    try { chmodSync(sqlPath, 0o600); } catch { /* best-effort on Windows */ }
    // Single transactional file: any failed statement rolls the whole migration back.
    runWrangler(['d1', 'execute', D1_DB_NAME, '--remote', '--file', sqlPath]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const afterCols = d1ReadQuery(D1_DB_NAME, 'PRAGMA table_info(student_demands)').map(c => c.name);
  const cnt = Number(d1ReadQuery(D1_DB_NAME, 'SELECT COUNT(*) AS n FROM student_demands')[0].n);
  const empty = Number(d1ReadQuery(D1_DB_NAME, `SELECT COUNT(*) AS n FROM student_demands WHERE subject IS NULL OR subject=''`)[0].n);
  const closed = Number(d1ReadQuery(D1_DB_NAME, `SELECT COUNT(*) AS n FROM student_demands WHERE status='closed'`)[0].n);
  const hasSubjectCol = afterCols.includes('subject');
  const noTargetSubjects = !afterCols.includes('target_subjects');
  console.log(`迁移完成：新表列=${afterCols.length} 行数=${cnt} subject空值=${empty} closed=${closed}`);
  if (!hasSubjectCol || !noTargetSubjects || empty !== 0) {
    console.error('✖ 迁移后校验失败：新表形状不正确。');
    process.exitCode = 1;
  } else {
    console.log('✔ 迁移后校验通过（subject 列存在 / 旧数组列已删 / 无空 subject 行）。');
  }

  // R-1 · conversations.demand_id 恢复断言（应恢复数 > 0 才断言；为 0 = 无关联可保，跳过）。
  if (expectedRestored != null && expectedRestored > 0) {
    const restored = Number(d1ReadQuery(D1_DB_NAME,
      'SELECT COUNT(*) AS n FROM conversations WHERE demand_id IS NOT NULL')[0].n);
    if (restored !== expectedRestored) {
      console.error(`✖ 迁移后校验失败：conversations.demand_id 未恢复（应恢复 ${expectedRestored}，实际非空 ${restored}）。`);
      process.exitCode = 1;
    } else {
      console.log(`✔ conversations.demand_id 恢复校验通过（非空 ${restored}/${expectedRestored}）。`);
    }
  } else if (expectedRestored != null) {
    console.log('conversations 无关联可保（apply 前应恢复数为 0），跳过恢复校验。');
  }
}

// ---------------------------------------------------------------------------
// In-memory drill (self-check; the node --test suite is the authoritative runner)
// ---------------------------------------------------------------------------
function buildOldSchema(raw) {
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT)`);
  raw.exec(`CREATE TABLE student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
      target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
      teaching_method TEXT NOT NULL DEFAULT 'offline',
      address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
      expected_time TEXT DEFAULT '',
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
      student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
      target_type TEXT NOT NULL DEFAULT 'academic',
      preferred_personality_tags TEXT NOT NULL DEFAULT '[]',
      preferred_teacher_gender TEXT NOT NULL DEFAULT '',
      teaching_goal TEXT NOT NULL DEFAULT '[]',
      skill_notes TEXT NOT NULL DEFAULT '[]',
      province TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  raw.exec(`CREATE TABLE demand_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, demand_id INTEGER NOT NULL,
      teacher_user_id INTEGER NOT NULL, created_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(demand_id, teacher_user_id),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE)`);
  raw.exec(`CREATE TABLE demand_pushes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, demand_id INTEGER NOT NULL, student_user_id INTEGER NOT NULL,
      teacher_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (demand_id) REFERENCES student_demands(id) ON DELETE CASCADE)`);
}

const D = (id, u, g, subs, scores, status, extra = {}) =>
  ({ id, user_id: u, student_grade: g, student_gender: extra.gender ?? 'female',
     target_subjects: JSON.stringify(subs), current_scores: JSON.stringify(scores),
     teaching_method: extra.method ?? 'online', address: extra.address ?? '黄浦区·南京东路街道',
     expected_time: extra.time ?? '[{"day":"sat"}]',
     budget_min: extra.min ?? 150, budget_max: extra.max ?? 200,
     submitter_type: 'self', parent_contact: '', student_contact: '',
     additional_info: extra.info ?? '', preferred_personality_tags: JSON.stringify(extra.tags ?? ['patience']),
     preferred_teacher_gender: extra.prefGender ?? 'female', province: extra.province ?? 'shanghai',
     status, created_at: extra.createdAt ?? '2026-08-01 00:00:00' });

function seedOld(raw) {
  raw.prepare("INSERT INTO users (username, role) VALUES ('s1','student'),('s2','student'),('t1','teacher')").run();
  const ins = raw.prepare(`INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects,
      current_scores, teaching_method, address, expected_time, budget_min, budget_max, submitter_type,
      parent_contact, student_contact, additional_info, preferred_personality_tags,
      preferred_teacher_gender, province, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const d of [
    D(1, 1, 'senior1', ['math', 'physics'], [{ subject: 'math', mode: 'score', scale: 100, score: '120' }, { subject: 'physics', mode: 'grade', scale: 0, score: '', grade: 'A' }], 'open'),
    D(2, 2, 'middle2', ['chinese'], [{ subject: 'chinese', mode: 'grade', scale: 0, score: '', grade: 'B' }], 'contracted'),
    D(3, 1, 'senior1', ['math', 'english'], [], 'revoked'),
    D(4, 2, 'p6', [], [], 'open', { createdAt: '2026-08-02 00:00:00' }),
  ]) {
    ins.run(d.user_id, d.student_grade, d.student_gender, d.target_subjects, d.current_scores,
      d.teaching_method, d.address, d.expected_time, d.budget_min, d.budget_max, d.submitter_type,
      d.parent_contact, d.student_contact, d.additional_info, d.preferred_personality_tags,
      d.preferred_teacher_gender, d.province, d.status, d.created_at);
  }
  raw.prepare('INSERT INTO demand_intents (demand_id, teacher_user_id) VALUES (?,?)').run(1, 3);
}

export function drill() {
  let fail = 0;
  const check = (name, cond, detail = '') => {
    if (cond) console.log(`✔ ${name}`);
    else { console.error(`✖ ${name}${detail ? `（${detail}）` : ''}`); fail++; }
  };

  const raw = new DatabaseSync(':memory:');
  buildOldSchema(raw);
  seedOld(raw);

  const beforeIntents = Number(raw.prepare('SELECT COUNT(*) n FROM demand_intents').get().n);
  const r = runMigrationOnLocal(raw);
  check('迁移执行完成', !r.alreadyMigrated);
  check('旧数组行 4 → 新单科目行 5（含 1 丢弃）', r.stats.newRowCount === 5, `got ${r.stats.newRowCount}`);
  check('contracted→closed 且 revoked→open 映射', r.stats.status.closed === 1 && r.stats.status.open === 4, JSON.stringify(r.stats.status));

  const cols = describeTable(raw, 'student_demands');
  check('新表含 subject 且删 target_subjects', cols.includes('subject') && !cols.includes('target_subjects'));
  const rows = raw.prepare('SELECT subject, current_score, status, province, grade, preferred_tags, preferred_gender FROM student_demands ORDER BY subject, id').all();
  const subj = rows.map(x => x.subject).sort().join(',');
  check('科目拆分正确（chinese,english,math,math,physics）', subj === 'chinese,english,math,math,physics', subj);
  const math = rows.filter(x => x.subject === 'math');
  check('current_score 单值化（math=120 与 math 空）',
    math.some(x => x.current_score === '120') && math.some(x => x.current_score === ''),
    JSON.stringify(math.map(x => x.current_score)));
  const chinese = rows.find(x => x.subject === 'chinese');
  check('current_score 等第字母回填（chinese=B）', chinese.current_score === 'B', chinese.current_score);
  check('province/preferred_tags/grade 保留', rows.every(x => x.province === 'shanghai' && x.grade) && rows.some(x => x.preferred_tags === '["patience"]' && x.preferred_gender === 'female'));
  check('contracted 行关闭（chinese closed）', chinese.status === 'closed');

  const again = runMigrationOnLocal(raw);
  check('幂等：重跑零变更', again.alreadyMigrated === true);
  const cnt2 = Number(raw.prepare('SELECT COUNT(*) n FROM student_demands').get().n);
  check('重跑后行数不变（5）', cnt2 === 5, `got ${cnt2}`);

  // FK cascade: dropping the old parent removes dependent intents (S2 deletion scope).
  const afterIntents = Number(raw.prepare('SELECT COUNT(*) n FROM demand_intents').get().n);
  check('DROP 旧表级联清理 demand_intents（1→0）', beforeIntents === 1 && afterIntents === 0, `${beforeIntents}→${afterIntents}`);

  console.log(fail === 0 ? '\n演练通过' : `\n演练发现 ${fail} 项违规`);
  raw.close();
  return fail === 0;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function printUsage() {
  console.log(`用法: node scripts/migrate-demands-single-subject.mjs [--dry-run|--apply|--drill] [--keep-old]
  --dry-run    只读统计（行数/将拆分行数/status 分布），不写生产库
  --apply      执行迁移（默认重建表；--keep-old 保留旧表为 student_demands_legacy）
  --drill      内存自检演练（建旧表→灌样例→迁移→断言新形状）
  --help       本帮助`);
}

async function main() {
  const args = process.argv.slice(2);
  const keepOld = args.includes('--keep-old');
  if (args.includes('--help') || args.length === 0) { printUsage(); return; }
  if (args.includes('--drill')) {
    console.log('== S3-3 演练：student_demands 数组→单科目 ==\n');
    process.exitCode = drill() ? 0 : 1;
    return;
  }
  if (args.includes('--dry-run')) return dryRunRemote();
  if (args.includes('--apply')) return applyRemote({ keepOld });
  printUsage();
}

// Run the CLI only when executed directly (importing the module for tests must be side-effect free).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await main();
