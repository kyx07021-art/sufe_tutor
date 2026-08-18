/**
 * V-4-1c D1 副本演练：迁移幂等实测（发布 2.0.0 前置）。
 *   1. 导出生产 D1（schema+数据）到本地 SQL；
 *   2. 载入全新本地 SQLite（foreign_keys=ON，镜像生产约束）→ 快照各表 行数/列集/内容摘要；
 *   3. 跑真实迁移编排 initDb（src/server/core/db.js，与 2.0.0 部署同源）→ 断言无错 + notifications 补 type/params 列；
 *   4. 幂等：清 schema_meta 强制重跑全量迁移 → 断言第二次运行 行数/列集/内容 全表一致
 *      （唯一已知良性例外 = seedAdmins 对既有 admin 重写 password_hash/salt，见下）；
 *   5. 报告首次迁移的内容增量（预期：schema_meta 版本行 +1；admin 口令列重写 = 已知良性非幂等，逐项列明）。
 *
 * 已知良性非幂等（V-4-1c 独立审计 F1 裁决）：seedAdmins（auth/schema.js:82-97）对已存在的 admin
 *   用户名，每次全量迁移都 hashPassword 新盐 → password_hash/salt 恒变。故 users 表内容摘要拆三份：
 *   digestMain（除口令列外全内容，应恒稳）+ digestNonAdminCred（非 admin 行口令列，应恒稳）+
 *   digestAdminCred（admin 行口令列，seedAdmins 良性可变，仅报告不判败）。其余表全列摘要。
 *
 * 用法：node scripts/d1-migration-drill.mjs [--export <sql路径>]
 *   --export 复用已有导出文件则跳过远程导出；缺省自动导出生产库。
 * 注意：迁移读取的 ADMIN_USERNAMES 走 env 回落本地 secrets.js（生产用 Worker Secrets），
 *   演练中任何 admin 行删除都会显式报告，供人工对照生产名单裁决。
 */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../src/server/core/db.js';
import { d1Export, D1_DB_NAME } from './wrangler-d1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 安全（同 rollback-drill 提交审查口径）：生产导出含 PII/加密字段——mkdtempSync 私有目录（POSIX 0o700）
// + 导出文件 chmod 0o600 + finally 清理；--export 显式复用用户文件时不删。
const DRILL_DIR = mkdtempSync(join(tmpdir(), 'sufe-drill-'));
const argExport = process.argv.find((a, i) => a === '--export' && process.argv[i + 1]);
const exportPath = argExport || join(DRILL_DIR, 'prod-export.sql');

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

// ---- D1 形状 shim（同 test/api-batch.test.js 口径）：prepare→bind→all/first/run + batch ----
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

// ---- 内容摘要（sha256 逐行序列化；users 拆三份以隔离 seedAdmins 良性重写）----
const USERS_EXCL = new Set(['password_hash', 'salt']);
const rowDigest = (rows, excl) => {
  const h = createHash('sha256');
  for (const r of rows) {
    const vals = excl ? Object.entries(r).filter(([k]) => !excl.has(k)).map(([, v]) => v) : Object.values(r);
    h.update(JSON.stringify(vals)).update('\n');
  }
  return h.digest('hex');
};

// ---- 快照：表名 → { count, cols[], digest* }（业务表，排除 sqlite_% 系统表）----
function snapshot(raw) {
  const out = {};
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  for (const { name } of tables) {
    const count = Number(raw.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
    const cols = raw.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name);
    const s = { count, cols };
    if (name === 'users') {
      const all = raw.prepare('SELECT * FROM users ORDER BY rowid').all();
      s.digestMain = rowDigest(all, USERS_EXCL);                                    // 除口令列外全内容（应恒稳）
      s.digestNonAdminCred = rowDigest(all.filter(r => r.role !== 'admin'), null); // 非 admin 口令列（应恒稳）
      s.digestAdminCred = rowDigest(all.filter(r => r.role === 'admin'), null);    // admin 口令列（seedAdmins 良性可变）
    } else {
      s.digest = rowDigest(raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(), null);
    }
    out[name] = s;
  }
  return out;
}

// 内容差异（表.域），admin 口令列单独成项（判定时作为已知良性豁免）
function contentDiff(a, b) {
  const out = [];
  for (const t of Object.keys(b)) {
    if (t === 'users') {
      if (a[t]?.digestMain !== b[t].digestMain) out.push(`${t}.主内容`);
      if (a[t]?.digestNonAdminCred !== b[t].digestNonAdminCred) out.push(`${t}.非admin口令列`);
      if (a[t]?.digestAdminCred !== b[t].digestAdminCred) out.push(`${t}.admin口令列(seedAdmins)`);
    } else if (a[t]?.digest !== b[t].digest) {
      out.push(`${t}.内容`); // 未来迁移新建表时 a[t] 为 undefined → 判为内容变化（审计硬化建议）
    }
  }
  return out;
}
const benignAdminCred = d => d.filter(x => !x.endsWith('admin口令列(seedAdmins)'));
const structuralDiff = (a, b) => {
  const rows = Object.keys(b).filter(t => (a[t]?.count ?? 0) !== b[t].count).map(t => `${t}: ${a[t]?.count ?? 0}→${b[t].count}`);
  const colDiff = Object.keys(b).filter(t => JSON.stringify(a[t]?.cols) !== JSON.stringify(b[t].cols)).map(t => `${t} 列集变化`);
  return { rows, colDiff };
};

console.log(`== V-4-1c D1 副本迁移幂等演练（${D1_DB_NAME}）==\n`);

// 1. 导出生产（--export 复用用户文件；否则导出到私有 mkdtemp 目录并收紧权限）
if (argExport) {
  console.log(`复用导出文件：${exportPath}`);
} else {
  console.log('导出生产 D1（schema+数据）…');
  d1Export(D1_DB_NAME, exportPath);
  chmodSync(exportPath, 0o600); // 生产导出含 PII/加密字段：owner-only
  console.log(`已导出：${exportPath}`);
}

// 2. 载入全新本地副本 + 快照
const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON');
raw.exec(readFileSync(exportPath, 'utf8'));
const before = snapshot(raw);
console.log(`生产副本载入：${Object.keys(before).length} 张业务表`);
const db = makeShim(raw);

// 3. 跑真实迁移（第一次 = 2.0.0 部署等价）
console.log('\n[运行 1] initDb 全量迁移…');
await initDb(db, {});
const after1 = snapshot(raw);
const s1 = structuralDiff(before, after1);
const c1 = contentDiff(before, after1);
check('首次迁移完成无错', true);
check('notifications 补 type/params 列（V-2-4 结构化）',
  after1.notifications && after1.notifications.cols.includes('type') && after1.notifications.cols.includes('params'),
  after1.notifications ? after1.notifications.cols.join(',') : '表缺失');
console.log(`首次迁移结构增量：${s1.rows.length ? s1.rows.join('；') : '无（行数不变）'}${s1.colDiff.length ? `；${s1.colDiff.join('；')}` : '；列集仅 notifications 补列'}`);
console.log(`首次迁移内容增量：${c1.length ? c1.join('；') : '无（内容全等）'}（admin 口令列 = seedAdmins 已知良性重写）`);

// 4. 幂等：清 schema_meta 强制重跑
console.log('\n[运行 2] 清 schema_meta 强制重跑全量迁移（幂等实测）…');
raw.exec(`DELETE FROM schema_meta`);
await initDb(db, {});
const after2 = snapshot(raw);
const s2 = structuralDiff(after1, after2);
const c2 = contentDiff(after1, after2);
check('第二次迁移运行完成无错', true);
check('第二次运行结构零变更（行数/列集全表一致）', s2.rows.length === 0 && s2.colDiff.length === 0,
  [...s2.rows, ...s2.colDiff].join('；') || '零增量');
check('第二次运行内容零变更（除 seedAdmins admin 口令良性重写）', benignAdminCred(c2).length === 0,
  benignAdminCred(c2).join('；') || '零变化');
check('schema_meta 收敛为单版本行', after2.schema_meta && after2.schema_meta.count === 1, after2.schema_meta ? String(after2.schema_meta.count) : '表缺失');
if (c2.some(x => x.endsWith('admin口令列(seedAdmins)'))) {
  console.log('ℹ 已知良性非幂等：seedAdmins 重写了既有 admin 口令哈希/盐（PBKDF2 新盐，同口令换盐，功能无影响）');
}

console.log(fail === 0 ? `\n演练通过（迁移幂等 + 数据保持）` : `\n✖ 演练发现 ${fail} 项违规`);
if (!argExport) rmSync(DRILL_DIR, { recursive: true, force: true }); // 仅清理自产私有导出目录
process.exit(fail === 0 ? 0 : 1);
