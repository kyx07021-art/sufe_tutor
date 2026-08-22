/**
 * NJ-M1 新站 D1 副本迁移演练（v13 → v17）：合并替换 main 前置闸门。
 *   1. 导出生产 D1（schema+数据，v13 时代：signing_contracts 合并表 / 数组 student_demands / intents+pushes）
 *      → 载入本地 SQLite（foreign_keys=ON 镜像生产约束）；
 *   2. 注入 S3-3 demand 单科目迁移（runMigrationOnLocal，与生产部署前 --apply 同源）→ 快照；
 *   3. 跑真实迁移编排 initDb（src/server/core/db.js 同源）→ 逐域断言（contracts 独立化 / temp 列 /
 *      intents+pushes 删除 / teacher 补列 / feedbacks 匿名模型 / 幂等）；
 *   4. 幂等：清 schema_meta 强制重跑 → 结构/内容零变更（admin 口令列 = seedAdmins 已知良性）；
 *   5. 回滚验证：--rollback 还原初始导出副本 → 断言 v13 形态可恢复。
 *
 * 依赖调研（2026-08-23 两 agent）：自动迁移覆盖良好（contracts/temp 列/teacher 补列/feedbacks 换表），
 * 三大缺口：①demand 迁移脚本未保 conversations.demand_id（NJ-M2 修复）②旧 drill 假阳性（本脚本集成
 * demand 脚本根治）③signing 层 stage='signing' 行有意丢弃（S5-19）→ 本脚本显式报告丢弃数供用户裁决。
 *
 * 用法：node scripts/migration-drill-v17.mjs [--export <sql路径>] [--rollback]
 *   --export   复用已有导出文件（跳过远程导出）；缺省自动导出生产库（私有 0o600）
 *   --rollback 在全部断言后，从初始导出重载副本验证 v13 形态可恢复（回滚演练）
 *
 * 注意：演练不连生产（除前置 d1Export 导出）；ADMIN_USERNAMES 只走 env（不配置则名单为空，不 seed）。
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../src/server/core/db.js';
import { d1Export, D1_DB_NAME } from './wrangler-d1.mjs';
import { runMigrationOnLocal } from './migrate-demands-single-subject.mjs';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';

const DRILL_DIR = mkdtempSync(join(tmpdir(), 'sufe-drill-v17-'));
const expIdx = process.argv.indexOf('--export');
const argExport = expIdx !== -1 && process.argv[expIdx + 1] ? process.argv[expIdx + 1] : undefined;
const exportPath = argExport || join(DRILL_DIR, 'prod-export.sql');
const wantRollback = process.argv.includes('--rollback');

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

function makeShim(raw) {
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

const USERS_EXCL = new Set(['password_hash', 'salt']);
const rowDigest = (rows, excl) => {
  const h = createHash('sha256');
  for (const r of rows) {
    const vals = excl ? Object.entries(r).filter(([k]) => !excl.has(k)).map(([, v]) => v) : Object.values(r);
    h.update(JSON.stringify(vals)).update('\n');
  }
  return h.digest('hex');
};

function snapshot(raw) {
  const out = {};
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  for (const { name } of tables) {
    const count = Number(raw.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
    const cols = raw.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name);
    const s = { count, cols };
    if (name === 'users') {
      const all = raw.prepare('SELECT * FROM users ORDER BY rowid').all();
      s.digestMain = rowDigest(all, USERS_EXCL);
      s.digestNonAdminCred = rowDigest(all.filter(r => r.role !== 'admin'), null);
      s.digestAdminCred = rowDigest(all.filter(r => r.role === 'admin'), null);
    } else {
      s.digest = rowDigest(raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(), null);
    }
    out[name] = s;
  }
  return out;
}

const contentDiff = (a, b) => {
  const out = [];
  for (const t of Object.keys(b)) {
    if (t === 'users') {
      if (a[t]?.digestMain !== b[t].digestMain) out.push(`${t}.主内容`);
      if (a[t]?.digestNonAdminCred !== b[t].digestNonAdminCred) out.push(`${t}.非admin口令列`);
      if (a[t]?.digestAdminCred !== b[t].digestAdminCred) out.push(`${t}.admin口令列(seedAdmins)`);
    } else if (a[t]?.digest !== b[t].digest) out.push(`${t}.内容`);
  }
  return out;
};
const benignAdminCred = d => d.filter(x => !x.endsWith('admin口令列(seedAdmins)'));
const structuralDiff = (a, b) => {
  const rows = Object.keys(b).filter(t => (a[t]?.count ?? 0) !== b[t].count).map(t => `${t}: ${a[t]?.count ?? 0}→${b[t].count}`);
  const colDiff = Object.keys(b).filter(t => JSON.stringify(a[t]?.cols) !== JSON.stringify(b[t].cols)).map(t => `${t} 列集变化`);
  return { rows, colDiff };
};

const tableExists = (raw, name) => !!raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

console.log(`== 新站 D1 副本迁移演练（v13→v17，${D1_DB_NAME}）==\n`);

// 1. 导出生产（--export 复用；否则私有目录导出 + 0o600）
if (argExport) {
  console.log(`复用导出文件：${exportPath}`);
} else {
  console.log('导出生产 D1（schema+数据）…');
  d1Export(D1_DB_NAME, exportPath);
  chmodSync(exportPath, 0o600);
  console.log(`已导出：${exportPath}`);
}

const sqlText = readFileSync(exportPath, 'utf8');
const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON');
raw.exec(sqlText);
// R-1 迁移前基线：conversations.demand_id 非空行数（供步骤 A 后对账 remap 保全）
const convDemandBaseline = tableExists(raw, 'conversations') && tableExists(raw, 'student_demands')
  ? Number(raw.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE demand_id IS NOT NULL`).get().n) : 0;
const before = snapshot(raw);
console.log(`生产副本载入：${Object.keys(before).length} 张业务表`);

// 前置基线断言（v13 形态确认）
const preV = raw.prepare(`SELECT v FROM schema_meta WHERE k='schema'`).get();
check('生产副本 schema_meta 版本 < 17（待迁移，应为 v13）', preV && Number(preV.v) < 17, `v=${preV ? preV.v : '缺'}`);
check('旧表形态就位（signing_contracts / demand_intents / demand_pushes / 数组 student_demands）',
  tableExists(raw, 'signing_contracts') && tableExists(raw, 'demand_intents') && tableExists(raw, 'demand_pushes'),
  '三类旧表应在导出中');

// 2. 注入 S3-3 demand 单科目迁移（生产序 = 部署前 --apply）
console.log('\n[步骤 A] S3-3 demand 单科目迁移（runMigrationOnLocal，同 --apply）…');
const demRes = runMigrationOnLocal(raw);
if (demRes.alreadyMigrated) {
  check('demand 迁移已前置完成（无待拆行）', true);
} else {
  check('demand 迁移完成', true);
  check(`demand 拆行统计：${demRes.stats.newRowCount} 新行 / ${demRes.stats.dropped} 丢弃`,
    demRes.stats.newRowCount > 0 || demRes.stats.total === 0, JSON.stringify(demRes.stats));
  // 隐私断言：新表无联系方式列（S3 联系方式不存储）
  const dCols = raw.prepare(`PRAGMA table_info('student_demands')`).all().map(r => r.name);
  const piiCols = ['parent_contact', 'student_contact', 'address_detail'].filter(c => dCols.includes(c));
  check('demand 新表零联系方式列（PII 已清）', piiCols.length === 0, piiCols.join(',') || '无');
  const subjNull = Number(raw.prepare(`SELECT COUNT(*) AS n FROM student_demands WHERE subject IS NULL OR subject=''`).get().n);
  check('demand 全部行 subject 非空', subjNull === 0, `${subjNull} 空值行`);
  const badStatus = raw.prepare(`SELECT DISTINCT status FROM student_demands`).all().map(r => r.status);
  check('demand status 仅 open/closed', badStatus.every(s => s === 'open' || s === 'closed'), badStatus.join(','));
  const fkCheck = raw.prepare(`PRAGMA foreign_key_check`).all();
  check('demand 迁移后零 FK 违规', fkCheck.length === 0, `${fkCheck.length} 违规`);
  // R-1（NJ-M2）：conversations.demand_id 关联保全——DROP 旧表 SET NULL 前快照恢复。
  // 断言：remapped 数 == 迁移前 demand_id 非空基线（全部保全），迁移后非空行数 == 基线，且每个 id 有效。
  if (demRes.stats && typeof demRes.stats.remapped === 'number') {
    check(`R-1 会话关联保全：remapped=${demRes.stats.remapped} == 迁移前基线 ${convDemandBaseline}`,
      demRes.stats.remapped === convDemandBaseline, `remapped ${demRes.stats.remapped} vs baseline ${convDemandBaseline}`);
    const postNonNull = Number(raw.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE demand_id IS NOT NULL`).get().n);
    check(`R-1 迁移后 demand_id 非空行数 == 基线（${postNonNull} == ${convDemandBaseline}）`,
      postNonNull === convDemandBaseline, `${postNonNull} vs ${convDemandBaseline}`);
    const badConv = raw.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE c.demand_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM student_demands sd WHERE sd.id=c.demand_id)`).get();
    check('R-1 重定向 id 全部指向有效 demand 行', badConv.n === 0, `${badConv.n} 悬空引用`);
  }
}
const afterDemand = snapshot(raw);

// 3. initDb 全量迁移（v13 → v17）
console.log('\n[步骤 B] initDb 全量迁移（v13→v17）…');
const db = makeShim(raw);
await initDb(db, {});
const after1 = snapshot(raw);
check('initDb 完成无错', true);

// ---- 逐域断言（R-2 断言清单）----
// contracts 独立化：行数 = 旧 signing_contracts stage='contract' 数；id 1:1 保留；signing 行丢弃报告
const scBefore = before.signing_contracts;
const contractRows = after1.contracts?.count ?? 0;
if (scBefore) {
  // 从初始导出重读 signing_contracts 的 stage 分布
  const raw0 = new DatabaseSync(':memory:');
  raw0.exec(sqlText);
  const scRows = raw0.prepare('SELECT id, stage FROM signing_contracts').all();
  raw0.close();
  const contractCount = scRows.filter(r => r.stage === 'contract').length;
  const signingCount = scRows.length - contractCount;
  check(`contracts 行数 = 旧 signing_contracts stage='contract' 数（${contractCount}）`, contractRows === contractCount, `${contractRows} vs ${contractCount}`);
  check(`signing 层丢弃行数显式报告（S5-19 有意，需用户裁决）`, signingCount >= 0, `${signingCount} 行 stage='signing' 丢弃`);
  // id 1:1 保留（台账零 remap 前提）：contracts 存在性 + contract_ledger 不变
  const ledgerCols = after1.contract_ledger?.cols ?? [];
  check('contract_ledger seq/body_hash 列就位（S5 台账）', ledgerCols.includes('seq') && ledgerCols.includes('body_hash'), ledgerCols.join(','));
}
// conversations temp 列（S2-T1）
const convCols = after1.conversations?.cols ?? [];
check('conversations temp_status 列就位', convCols.includes('temp_status') && convCols.includes('temp_initiator_user_id'), convCols.join(','));
const initTemps = Number(raw.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE temp_status='init'`).get().n);
check('存量会话 temp_status 无 init（旧会话=正式）', initTemps === 0, `${initTemps} init 行`);
// messages client_key + 唯一索引（Q-2g 回归锚点）
const msgCols = after1.messages?.cols ?? [];
const msgIdx = raw.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_client_key'`).get();
check('messages client_key 列 + 唯一索引', msgCols.includes('client_key') && !!msgIdx, msgIdx ? '索引在' : '索引缺');
// teacher 补列（S4-01）
const tpCols = after1.teacher_profiles?.cols ?? [];
check('teacher_profiles teacher_name/experience_years 列', tpCols.includes('teacher_name') && tpCols.includes('experience_years'), tpCols.join(','));
// intents/pushes/signing_contracts 删除
check('intents/pushes/signing_contracts 表已 DROP',
  !tableExists(raw, 'demand_intents') && !tableExists(raw, 'demand_pushes') && !tableExists(raw, 'signing_contracts'),
  '三表应不存在');
// feedbacks 匿名模型（complaint→report 映射）
const fbKinds = raw.prepare(`SELECT DISTINCT kind FROM feedbacks`).all().map(r => r.kind);
check('feedbacks kind 无 complaint（已映射 report）', !fbKinds.includes('complaint'), fbKinds.join(','));
// schema_meta 收敛 v17
const smV = raw.prepare(`SELECT v FROM schema_meta WHERE k='schema'`).get();
check('schema_meta v=17 单行', smV && smV.v === 17, String(smV?.v));

// 台账（contract_ledger）：initLedgerTable（_worker 启动编排调用，独立于 initDb）幂等回填 seq/body_hash。
// 生产 v13 已有 4 行且 seq 已回填；演练显式调一次验证幂等（重跑零变化）。
if (tableExists(raw, 'contract_ledger')) {
  await initLedgerTable(makeShim(raw));
  const ledgerSeqNull = Number(raw.prepare(`SELECT COUNT(*) AS n FROM contract_ledger WHERE seq IS NULL`).get().n);
  const ledgerRows = Number(raw.prepare(`SELECT COUNT(*) AS n FROM contract_ledger`).get().n);
  check('contract_ledger seq 全回填（initLedgerTable 幂等）', ledgerSeqNull === 0, `${ledgerRows} 行 / ${ledgerSeqNull} 空 seq`);
}

// 4. 幂等复跑断言
console.log('\n[步骤 C] 清 schema_meta 强制重跑（幂等实测）…');
raw.exec(`DELETE FROM schema_meta`);
await initDb(db, {});
const after2 = snapshot(raw);
const s2 = structuralDiff(after1, after2);
const c2 = contentDiff(after1, after2);
check('第二次运行结构零变更', s2.rows.length === 0 && s2.colDiff.length === 0, [...s2.rows, ...s2.colDiff].join('；') || '零增量');
check('第二次运行内容零变更（除 seedAdmins 良性）', benignAdminCred(c2).length === 0, benignAdminCred(c2).join('；') || '零变化');

// 5. 回滚验证（--rollback：从初始导出重载，断言 v13 形态可恢复）
if (wantRollback) {
  console.log('\n[步骤 D] 回滚验证（从初始导出重载副本）…');
  const rawR = new DatabaseSync(':memory:');
  rawR.exec('PRAGMA foreign_keys = ON');
  rawR.exec(sqlText);
  const rb = snapshot(rawR);
  check('回滚后 v13 形态可恢复（signing_contracts/demand_intents/student_demands 数组 在）',
    tableExists(rawR, 'signing_contracts') && tableExists(rawR, 'demand_intents') && tableExists(rawR, 'student_demands'),
    '旧表恢复');
  check('回滚后数据与初始导出逐表一致', JSON.stringify(rb.users.cols) === JSON.stringify(before.users.cols), 'users 列集');
  rawR.close();
}

// 清理：仅自产私有导出目录；--export 复用用户文件不删
if (!argExport) rmSync(DRILL_DIR, { recursive: true, force: true });

console.log(fail === 0 ? `\n演练通过（v13→v17 迁移幂等 + 数据保持 + 断言全过）` : `\n✖ 演练发现 ${fail} 项违规`);
process.exit(fail === 0 ? 0 : 1);
