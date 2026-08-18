/**
 * V-4-1c D1 副本演练：迁移幂等实测（发布 2.0.0 前置）。
 *   1. 导出生产 D1（schema+数据）到本地 SQL；
 *   2. 载入全新本地 SQLite（foreign_keys=ON，镜像生产约束）→ 快照各表行数与列集；
 *   3. 跑真实迁移编排 initDb（src/server/core/db.js，与 2.0.0 部署同源）→ 断言无错 + notifications 补 type/params 列；
 *   4. 幂等：清 schema_meta 强制重跑全量迁移 → 断言第二次运行零新增变更（行数/列集全表一致）；
 *   5. 报告首次迁移的数据增量（预期：schema_meta +1；管理员硬删除等迁移变换逐项列明供人工裁决）。
 * 用法：node scripts/d1-migration-drill.mjs [--export <sql路径>]
 *   --export 复用已有导出文件则跳过远程导出；缺省自动导出生产库。
 * 注意：迁移读取的 ADMIN_USERNAMES 走 env 回落本地 secrets.js（生产用 Worker Secrets），
 *   演练中任何 admin 行删除都会显式报告，供人工对照生产名单裁决。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../src/server/core/db.js';
import { d1Export } from './wrangler-d1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_NAME = 'sufe-tutor-db-apac';
const argExport = process.argv.find((a, i) => a === '--export' && process.argv[i + 1]);
const exportPath = argExport || join(root, '.drill', 'prod-export.sql');

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

// ---- D1 形状 shim（同 test/api-batch.test.js 口径）：prepare→bind→all/first/run + batch ----
function makeShim(raw) {
  const exec = sql => { raw.exec(sql); };
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

// ---- 快照：表名 → { count, cols[] }（业务表，排除 sqlite_sequence）----
function snapshot(raw) {
  const out = {};
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  for (const { name } of tables) {
    const c = raw.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
    const cols = raw.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name);
    out[name] = { count: Number(c), cols };
  }
  return out;
}

const diff = (a, b) => {
  const rows = Object.keys(b).filter(t => (a[t]?.count ?? 0) !== b[t].count).map(t => `${t}: ${a[t]?.count ?? 0}→${b[t].count}`);
  const colDiff = Object.keys(b).filter(t => JSON.stringify(a[t]?.cols) !== JSON.stringify(b[t].cols)).map(t => `${t} 列集变化`);
  return { rows, colDiff };
};

console.log(`== V-4-1c D1 副本迁移幂等演练（${DB_NAME}）==\n`);

// 1. 导出生产
if (argExport || existsSync(exportPath)) {
  console.log(`复用导出文件：${exportPath}`);
} else {
  mkdirSync(dirname(exportPath), { recursive: true });
  console.log('导出生产 D1（schema+数据）…');
  d1Export(DB_NAME, exportPath);
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
const d1 = diff(before, after1);
check('首次迁移完成无错', true);
check('notifications 补 type/params 列（V-2-4 结构化）',
  after1.notifications && after1.notifications.cols.includes('type') && after1.notifications.cols.includes('params'),
  after1.notifications ? after1.notifications.cols.join(',') : '表缺失');
console.log(`首次迁移行数增量：${d1.rows.length ? d1.rows.join('；') : '无（纯幂等）'}`);
if (d1.colDiff.length) { console.log(`首次迁移列集变化：${d1.colDiff.join('；')}`); }
// 管理员行若被硬删除，显式报告供人工对照生产 ADMIN_USERNAMES 裁决
const adminsBefore = before.users ? before.users.count : null;
const adminsAfter = after1.users ? after1.users.count : null;
if (adminsBefore != null && adminsAfter != null && adminsBefore !== adminsAfter) {
  console.log(`⚠ 报告：users 行数 ${adminsBefore}→${adminsAfter}（admin 硬删除等迁移变换；演练 ADMIN_USERNAMES 走本地 secrets，须对照生产名单裁决）`);
}

// 4. 幂等：清 schema_meta 强制重跑
console.log('\n[运行 2] 清 schema_meta 强制重跑全量迁移（幂等实测）…');
raw.exec(`DELETE FROM schema_meta`);
await initDb(db, {});
const after2 = snapshot(raw);
const d2 = diff(after1, after2);
check('第二次迁移运行完成无错', true);
check('第二次运行零新增变更（行数一致）', d2.rows.length === 0, d2.rows.join('；') || '零增量');
check('第二次运行列集全表一致', d2.colDiff.length === 0, d2.colDiff.join('；') || '零变化');
check('schema_meta 收敛为单版本行', after2.schema_meta && after2.schema_meta.count === 1, after2.schema_meta ? String(after2.schema_meta.count) : '表缺失');

console.log(fail === 0 ? `\n演练通过（迁移幂等 + 数据保持）` : `\n✖ 演练发现 ${fail} 项违规`);
if (!argExport) rmSync(dirname(exportPath), { recursive: true, force: true }); // 仅清理自产导出文件
process.exit(fail === 0 ? 0 : 1);
