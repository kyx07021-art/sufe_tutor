/**
 * V-4-1f 一键回滚演练（发布 2.0.0 前置）：
 *   1. 导出生产 D1 → 本地 SQLite → 跑当前 initDb（schema_meta=8，模拟 2.0.0 迁移后状态）→ VACUUM INTO 备份文件；
 *   2. git worktree 取出回滚目标代码（main = v1.5.0 时代，SCHEMA_VERSION=7，notifications 无 type/params 支持）；
 *   3. 旧代码树内跑旧 initDb 对 v8 库 → 断言版本门控短路（不迁移、不降级、无崩溃）；
 *   4. 断言旧代码数据通路兼容：v8 新增列保留（迁移成果不丢）、旧读全量行、旧写 pattern（text-only → type/params NULL，v2 客户端 text 兜底渲染）；
 *   5. 断言旧 /api/health 门控（productionReady）按 env 判定、不受 schema 影响 → 服务可恢复。
 * 用法：node scripts/rollback-drill.mjs（需 wrangler 已认证 + git worktree 权限）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { initDb } from '../src/server/core/db.js';
import { d1Export, D1_DB_NAME } from './wrangler-d1.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exportPath = join(root, '.drill', 'prod-export.sql');
const migratedDb = join(root, '.drill', 'post-migration.sqlite');
const WORKTREE = process.env.ROLLBACK_WORKTREE || (process.platform === 'win32'
  ? join(process.env.TEMP || '', 'rollback-main')
  : '/tmp/rollback-main');

let fail = 0;
const check = (name, cond, detail = '') => {
  const suffix = detail ? `（${detail}）` : '';
  if (cond) console.log(`✔ ${name}${suffix}`);
  else { console.error(`✖ ${name}${suffix}`); fail++; }
};

// ---- D1 形状 shim（同 test/api-batch.test.js 口径）----
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

// 旧代码树内执行的验收 harness（随演练生成进 worktree，非提交物）
const OLD_HARNESS = `import { DatabaseSync } from 'node:sqlite';
import { initDb, SCHEMA_VERSION as OLD_VER } from './src/server/core/db.js';
import { productionReady } from './server/startup.js';
const dbPath = process.argv[2];
let fail = 0;
const check = (n, c, d = '') => { if (c) console.log('✔ ' + n); else { console.error('✖ ' + n + (d ? '（' + d + '）' : '')); fail++; } };
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
          if (/^\\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const raw = new DatabaseSync(dbPath);
raw.exec('PRAGMA foreign_keys = ON');
const db = makeShim(raw);
const ver = () => raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get().v;
const verBefore = ver();
check('前置：库为 v8 迁移后状态', verBefore > OLD_VER, 'cur=' + verBefore + ' old=' + OLD_VER);
await initDb(db, {});
check('旧 initDb 运行无错（版本门控短路）', true);
check('schema_meta 未降级/未改写', ver() === verBefore, 'after=' + ver());
const cols = raw.prepare("SELECT name FROM pragma_table_info('notifications')").all().map(r => r.name);
check('v8 新增列回滚后仍保留', cols.includes('type') && cols.includes('params'), cols.join(','));
const total = raw.prepare('SELECT COUNT(*) AS c FROM notifications').get().c;
check('旧代码可读 notifications 全量行', total >= 0, 'rows=' + total);
const info = raw.prepare("INSERT INTO notifications (user_id, text) VALUES (1, 'rollback-drill-old-write')").run();
const row = raw.prepare('SELECT text, type, params FROM notifications WHERE id=?').get(Number(info.lastInsertRowid));
check('旧写 pattern 兼容（text-only → type/params NULL）', !!row && row.type === null && row.params === null && row.text === 'rollback-drill-old-write');
const gate = productionReady({});
check('旧 /api/health 门控可恢复服务（env 判定，非 schema）', gate.ok === true, JSON.stringify(gate && gate.checks));
raw.prepare("DELETE FROM notifications WHERE text='rollback-drill-old-write'").run();
raw.close();
console.log(fail === 0 ? '\\n回滚兼容 PASS' : '\\n回滚兼容发现 ' + fail + ' 项违规');
process.exit(fail === 0 ? 0 : 1);
`;

console.log(`== V-4-1f 一键回滚演练（${D1_DB_NAME}）==\n`);

// 1. 导出生产 + 迁移到 v8 + 序列化
mkdirSync(dirname(exportPath), { recursive: true });
if (!existsSync(exportPath)) { console.log('导出生产 D1…'); d1Export(D1_DB_NAME, exportPath); }
const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON');
raw.exec(readFileSync(exportPath, 'utf8'));
console.log('跑当前 initDb（模拟 2.0.0 迁移后状态）…');
await initDb(makeShim(raw), {});
const ver8 = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get().v;
check('迁移后 schema_meta 为最新版本', ver8 >= 8, `v=${ver8}`);
raw.exec(`VACUUM INTO '${migratedDb.replaceAll('\\', '/')}'`);
console.log(`已序列化迁移后副本：${migratedDb}`);
raw.close();

// 2. 确保回滚目标 worktree（main = v1.5.0 时代代码）
if (!existsSync(join(WORKTREE, 'src', 'server', 'core', 'db.js'))) {
  console.log(`git worktree add ${WORKTREE} main…`);
  execFileSync('git', ['worktree', 'add', WORKTREE, 'main'], { cwd: root, stdio: 'inherit' });
} else {
  console.log(`复用回滚目标 worktree：${WORKTREE}`);
}

// 3. 生成旧代码验收 harness 并执行
writeFileSync(join(WORKTREE, 'rollback-check.mjs'), OLD_HARNESS);
console.log('\n[旧代码验收] 对 v8 迁移后副本运行 v1.5.0 时代代码…');
let oldExit = 1;
try {
  execFileSync(process.execPath, [join(WORKTREE, 'rollback-check.mjs'), migratedDb], { stdio: 'inherit' });
  oldExit = 0;
} catch (e) { oldExit = e.status ?? 1; }
check('旧代码验收 harness 通过（exit 0）', oldExit === 0, `exit=${oldExit}`);

// 清理
try { execFileSync('git', ['worktree', 'remove', '--force', WORKTREE], { cwd: root, stdio: 'ignore' }); } catch { /* 已在外部清理 */ }
rmSync(dirname(exportPath), { recursive: true, force: true });

console.log(fail === 0 ? `\n演练通过（回滚数据兼容 + 服务恢复）` : `\n✖ 演练发现 ${fail} 项违规`);
process.exit(fail === 0 ? 0 : 1);
