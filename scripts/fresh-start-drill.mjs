/**
 * 全新开始迁移演练（用户 2026-08-23 决策：丢弃全部业务历史数据，保留账户+留档+个人资料可迁移字段）
 * -----------------------------------------------------------------------------
 * 决策原文：「直接把用户历史数据全丢了，什么需求签约聊天记录，就留着账户数据和
 * 账户相关操作的留档记录，以及个人资料里的可迁移字段。新站点新开始」
 *
 * 保留集（KEEP，原位保留零搬运）：
 *   users                 -- 账户数据（44 行，含密码哈希/联系方式/角色）
 *   activity_log          -- 账户相关操作留档（3403 行）
 *   teacher_profiles      -- 教师个人资料可迁移字段（11 行）
 *   teacher_verifications -- 教师核验状态（5 行：2 approved/2 pending/1 rejected）
 *   schema_meta           -- 版本元数据（保留以走 v13->v18 迁移链）
 * 丢弃集（DROP，业务历史数据全删）：
 *   conversations/messages/uploads（聊天）· student_demands（需求）·
 *   signing_contracts/contract_ledger（签约/合同/台账）· posts/post_likes/post_favorites（帖子）·
 *   reviews（评价）· complaints/feedbacks（投诉/反馈）· notifications（通知）·
 *   auth_sessions/rate_limits/verification_codes/danger_caps（会话/限流/验证码/capToken 运行时）·
 *   invite_codes（邀请码）· demand_intents/demand_pushes/teacher_awards/user_settings/
 *   request_metrics/data_versions（S 域已删旧表）
 *
 * 方案：保留集表原位保留（一个字节不动），只 DROP 业务表 -> initDb v13->v18 迁移
 * （保留集表 ensureColumns 补列 + 业务表重建为空；全部结构变更走已验证迁移链）。
 * 不搬 activity_log 3403 行 -> 零数据丢失风险；生产写操作最小化（一个 DROP SQL）。
 *
 * 用法：node scripts/fresh-start-drill.mjs [--export <sql路径>] [--emit-drop <out.sql>]
 *   --export    复用已有导出（跳过远程导出）；缺省自动导出生产（私有 0o600）
 *   --emit-drop 输出生产可执行 DROP 业务表 SQL 到文件（供 deploy checklist 使用）
 *
 * 断言：保留集 4 数据表稳定列迁移前后一致（迁移回填/遗留清空列除外，见 3a 详注）；业务表全部重建
 *       且 count=0；schema v18；FK 零违规；幂等复跑零变更。
 *
 * 模拟终点说明（审计 F3）：本演练模拟终点 = initDb 结束。生产 worker boot（_worker.js:239）还会
 *   initLedgerTable(env.LEDGER_DB || env.DB) 重建空 contract_ledger —— 演练终态 contract_ledger
 *   不存在（initDb 不建它），生产终态 = 存在且空；差异在 checklist §5b 补充验证闭合。
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../src/server/core/db.js';
import { d1Export, D1_DB_NAME } from './wrangler-d1.mjs';

const DRILL_DIR = mkdtempSync(join(tmpdir(), 'sufe-fresh-'));
const expIdx = process.argv.indexOf('--export');
const argExport = expIdx !== -1 && process.argv[expIdx + 1] ? process.argv[expIdx + 1] : undefined;
const exportPath = argExport || join(DRILL_DIR, 'prod-export.sql');
const emitIdx = process.argv.indexOf('--emit-drop');
const emitPath = emitIdx !== -1 && process.argv[emitIdx + 1] ? process.argv[emitIdx + 1] : undefined;

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

const KEEP_TABLES = ['users', 'activity_log', 'teacher_profiles', 'teacher_verifications', 'schema_meta'];

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

// 显式列 digest（锁「业务列内容不变」而非全列——迁移会补新列，全列比较会假红）
// users 业务列 = 迁移前就存在的新站契约列（v13 列集 ∩ 新站列集，排除 v13 遗留 auth_token/token_expires）；
// 口令列单独核算（password_hash/salt 逐行锁，防 seedAdmins 覆盖）。
const USERS_BUSINESS_COLS = ['id', 'username', 'role', 'banned', 'created_at', 'avatar',
  'deactivated', 'phone', 'phone_hash', 'email', 'email_hash', 'username_changed_at'];
const USERS_CRED_COLS = ['id', 'username', 'password_hash', 'salt', 'role'];

const rowDigest = (rows, cols) => {
  const h = createHash('sha256');
  for (const r of rows) {
    h.update(JSON.stringify(cols.map(c => r[c] ?? null))).update('\n');
  }
  return h.digest('hex');
};

// 迁移前列集（从导出副本回放读，真实「迁移前」列——审计 F1：不可用迁移后 raw 读）
function exportColsOf(sql, name) {
  const raw0 = new DatabaseSync(':memory:');
  raw0.exec('PRAGMA foreign_keys = ON');
  raw0.exec(sql);
  const cols = raw0.prepare(`PRAGMA table_info('${name}')`).all().map(r => r.name);
  raw0.close();
  return cols;
}

// 迁移后列集（当前演练库）
function currentColsOf(raw, name) {
  return raw.prepare(`PRAGMA table_info('${name}')`).all().map(r => r.name);
}

// 稳定列 = 迁移前列 ∩ 迁移后列（排除迁移回填列），用于保留集「内容不变」比较
function stableCols(sql, raw, name, exclude) {
  const pre = exportColsOf(sql, name);
  const post = currentColsOf(raw, name);
  return post.filter(c => pre.includes(c) && !exclude.includes(c));
}

// 从导出文件读某表全行（重建独立内存库，不动主演练库）
function readExportRows(sql, table) {
  const raw0 = new DatabaseSync(':memory:');
  raw0.exec('PRAGMA foreign_keys = ON');
  raw0.exec(sql);
  const rows = raw0.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
  raw0.close();
  return rows;
}

function snapshot(raw) {
  const out = {};
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY name`).all();
  for (const { name } of tables) {
    const count = Number(raw.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
    const cols = raw.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name);
    const s = { count, cols };
    out[name] = s;
  }
  return out;
}

const tableExists = (raw, name) => !!raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);

console.log(`== 全新开始迁移演练（丢弃业务数据 · 保留账户/留档/个人资料 · ${D1_DB_NAME}）==\n`);

// 1. 导出生产
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
const before = snapshot(raw);
console.log(`生产副本载入：${Object.keys(before).length} 张业务表`);

// 前置基线
const preV = raw.prepare(`SELECT v FROM schema_meta WHERE k='schema'`).get();
check('生产副本 schema_meta v13（待迁移）', preV && Number(preV.v) === 13, `v=${preV ? preV.v : '缺'}`);
for (const t of KEEP_TABLES) {
  check(`保留集 ${t} 就位（count=${before[t]?.count ?? '缺'}）`, !!before[t], '表应在导出中');
}

// 2. 模拟生产 DROP 业务表（保留集原位）
console.log('\n[步骤 A] DROP 业务表（保留集原位）…');
const dropList = Object.keys(before).filter(t => !KEEP_TABLES.includes(t));
check(`业务表清单（${dropList.length} 张待 DROP）`, dropList.length > 0, dropList.join(','));
raw.exec('BEGIN');
for (const t of dropList) raw.prepare(`DROP TABLE IF EXISTS "${t}"`).run();
raw.exec('COMMIT');
const afterDrop = snapshot(raw);
const keptCounts = {};
for (const t of KEEP_TABLES) keptCounts[t] = afterDrop[t]?.count ?? 0;
check('DROP 后保留集数据表原位保留（行数不变）',
  keptCounts.users === before.users.count && keptCounts.activity_log === before.activity_log.count
  && keptCounts.teacher_profiles === before.teacher_profiles.count && keptCounts.teacher_verifications === before.teacher_verifications.count,
  `users=${keptCounts.users}/${before.users.count} · activity_log=${keptCounts.activity_log}/${before.activity_log.count} · tp=${keptCounts.teacher_profiles}/${before.teacher_profiles.count} · tv=${keptCounts.teacher_verifications}/${before.teacher_verifications.count}`);
check('DROP 后业务表全部消失', Object.keys(afterDrop).every(t => KEEP_TABLES.includes(t)), '仅保留集+schema_meta 在');

// 3. initDb v13→v18
console.log('\n[步骤 B] initDb 全量迁移（v13→v18）…');
const db = makeShim(raw);
let initError = null;
try { await initDb(db, {}); } catch (e) { initError = e; }
check('initDb 完成无错', initError === null, initError ? String(initError.message || initError).slice(0, 120) : '');
const after1 = snapshot(raw);
const smV = raw.prepare(`SELECT v FROM schema_meta WHERE k='schema'`).get();
check('schema_meta v=18', smV && smV.v === 18, String(smV?.v));

// 3a. 保留集内容逐字节一致（users 口令列单独核算；teacher_profiles 允许迁移回填列）
// 稳定列 = 迁移前列 ∩ 迁移后列（审计 F1 修复：真交集），排除迁移新增/回填列
const TP_MIG_COLS = ['price_min', 'price_max', 'rating', 'rating_count', 'rating_sum', 'teacher_name', 'experience_years', 'philosophy', 'updated_at'];
const USERS_COUNT = before.users.count;
const LOG_COUNT = before.activity_log.count;
const TV_COUNT = before.teacher_verifications.count;
const TP_COUNT = before.teacher_profiles.count;

{
  const u0All = readExportRows(sqlText, 'users'); // 迁移前全行（含遗留列）
  const d0Main = rowDigest(u0All, USERS_BUSINESS_COLS);
  const d0NonAdmin = rowDigest(u0All.filter(r => r.role !== 'admin'), USERS_CRED_COLS);
  const d0Admin = rowDigest(u0All.filter(r => r.role === 'admin'), USERS_CRED_COLS);

  const u1 = raw.prepare('SELECT * FROM users ORDER BY rowid').all();
  check(`users 业务列零变化（${USERS_COUNT} 行/用户名/角色/联系方式）`, rowDigest(u1, USERS_BUSINESS_COLS) === d0Main, '业务列 digest');
  check('users 非 admin 口令列零变化', rowDigest(u1.filter(r => r.role !== 'admin'), USERS_CRED_COLS) === d0NonAdmin, '非 admin 凭证');
  check('users admin 口令列零变化（seedAdmins 不覆盖保留集 admin）', rowDigest(u1.filter(r => r.role === 'admin'), USERS_CRED_COLS) === d0Admin, 'admin 凭证');

  const stableLog = stableCols(sqlText, raw, 'activity_log', []);
  check(`activity_log 稳定列零变化（${LOG_COUNT} 行留档）`,
    rowDigest(readExportRows(sqlText, 'activity_log'), stableLog) === rowDigest(raw.prepare('SELECT * FROM activity_log ORDER BY rowid').all(), stableLog),
    `${stableLog.length} 列`);

  const stableTv = stableCols(sqlText, raw, 'teacher_verifications', []);
  check(`teacher_verifications 稳定列零变化（${TV_COUNT} 行核验状态）`,
    rowDigest(readExportRows(sqlText, 'teacher_verifications'), stableTv) === rowDigest(raw.prepare('SELECT * FROM teacher_verifications ORDER BY rowid').all(), stableTv),
    `${stableTv.length} 列`);

  const stableTp = stableCols(sqlText, raw, 'teacher_profiles', TP_MIG_COLS);
  check(`teacher_profiles 稳定列零变化（${TP_COUNT} 行，除迁移回填列）`,
    rowDigest(readExportRows(sqlText, 'teacher_profiles'), stableTp) === rowDigest(raw.prepare('SELECT * FROM teacher_profiles ORDER BY rowid').all(), stableTp),
    `${stableTp.length} 列`);
}

// 3b. 业务表重建且 count=0（新站 schema 重建的空表）。
// contract_ledger 由 initLedgerTable 独立创建（_worker.js:239 boot 调用，不在 initDb 编排内）——
// 本演练模拟终点 = initDb 结束（不含 worker boot 的 initLedgerTable），故演练终态 contract_ledger 不存在
// （生产终态 = 部署后 initLedgerTable 重建空表，见 checklist §5b 补充验证）。
const rebuilt = ['conversations', 'messages', 'uploads', 'student_demands', 'contracts', 'posts', 'post_likes', 'post_favorites', 'reviews', 'feedbacks', 'complaints', 'notifications', 'auth_sessions', 'rate_limits', 'invite_codes', 'verification_codes', 'danger_caps'];
const emptyBad = rebuilt.filter(t => !tableExists(raw, t) || Number(raw.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n) !== 0);
check(`业务表重建为空（${rebuilt.length - emptyBad.length}/${rebuilt.length}）`, emptyBad.length === 0, emptyBad.join(',') || '全空');
// 旧 S 域表不再存在（initDb 不建）；request_metrics 是 initMetrics 观测表（预期存在且空）
const goneOld = ['demand_intents', 'demand_pushes', 'teacher_awards', 'user_settings', 'signing_contracts', 'data_versions'];
const goneOk = goneOld.filter(t => !tableExists(raw, t));
check(`旧 S 域表不存在（${goneOk.length}/${goneOld.length}）`, goneOk.length === goneOld.length, goneOld.filter(t => !goneOk.includes(t)).join(',') || '全消失');
const rmCount = tableExists(raw, 'request_metrics') ? Number(raw.prepare('SELECT COUNT(*) AS n FROM request_metrics').get().n) : -1;
check('request_metrics 观测表存在且空（initMetrics 建）', tableExists(raw, 'request_metrics') && rmCount === 0, `count=${rmCount}`);
// 无意外新表（演练终态表集 ⊆ 保留集 ∪ 重建清单 ∪ 已知表）
const knownPost = new Set([...KEEP_TABLES, ...rebuilt, 'request_metrics', 'contract_ledger']);
const unexpected = Object.keys(after1).filter(t => !knownPost.has(t));
check('无意外新表', unexpected.length === 0, unexpected.join(',') || '零意外');

// 3c. FK 零违规
const fkCheck = raw.prepare(`PRAGMA foreign_key_check`).all();
check('迁移后零 FK 违规', fkCheck.length === 0, `${fkCheck.length} 违规`);

// 4. 幂等复跑（结构 + 行数 + 保留集内容全比）
console.log('\n[步骤 C] 清 schema_meta 强制重跑（幂等实测）…');
// 首次迁移后的保留集内容 digest（after1 时刻，供复跑后比较）
const idemCols = t => currentColsOf(raw, t);
const d1Digest = {};
for (const t of KEEP_TABLES) {
  if (t === 'schema_meta') continue;
  d1Digest[t] = rowDigest(raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all(), idemCols(t));
}
raw.exec(`DELETE FROM schema_meta`);
let initError2 = null;
try { await initDb(db, {}); } catch (e) { initError2 = e; }
check('第二次 initDb 完成无错', initError2 === null, initError2 ? String(initError2.message || initError2).slice(0, 120) : '');
const after2 = snapshot(raw);
const countDiff = Object.keys(after2).filter(t => (after1[t]?.count ?? 0) !== after2[t].count).map(t => `${t}: ${after1[t]?.count}->${after2[t].count}`);
check('第二次运行结构/行数零变更', countDiff.length === 0, countDiff.join('；') || '零增量');
const smV2 = raw.prepare(`SELECT v FROM schema_meta WHERE k='schema'`).get();
check('复跑后仍 v=18', smV2 && smV2.v === 18, String(smV2?.v));
// 幂等内容断言：保留集数据表内容复跑后与首次迁移后逐字节一致（G2 锁真实行为）
const idemDiffs = [];
for (const t of KEEP_TABLES) {
  if (t === 'schema_meta') continue;
  const d2 = rowDigest(raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all(), idemCols(t));
  if (d2 !== d1Digest[t]) idemDiffs.push(t);
}
check('幂等复跑保留集内容零变更', idemDiffs.length === 0, idemDiffs.join(',') || '4 数据表全一致');

// 5. 产出 DROP SQL（生产执行清单用）
if (emitPath) {
  const dropSql = dropList.map(t => `DROP TABLE IF EXISTS "${t}";`).join('\n');
  writeFileSync(emitPath, dropSql, { mode: 0o600 });
  console.log(`\n已产出生产 DROP SQL（${dropList.length} 条）：${emitPath}`);
}

if (!argExport) rmSync(DRILL_DIR, { recursive: true, force: true });
console.log(fail === 0 ? `\n全新开始演练通过（保留集原位零丢失 + 业务表全清 + v18 幂等）` : `\n✖ 演练发现 ${fail} 项违规`);
process.exit(fail === 0 ? 0 : 1);
