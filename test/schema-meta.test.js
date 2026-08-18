/**
 * v0.26.12 initDb 瘦身（冷 isolate 首击 25s 超时治本，C1/C2）：
 *
 * 根因：原 initDb 每次 worker isolate 首击全量跑 19 表 CREATE + ~15 组 ensureColumns
 *（≈13-20 次 D1 往返），Pages 多 isolate 各自冷启动 × D1 冷连接 → 6-25s 超时。
 * 修复：schema_meta 版本判断——冷 isolate 首击 1 次 batch 命中已最新即跳过全量迁移。
 *
 * 覆盖：
 *   - 首次 initDb：建 schema_meta 版本 + 全部表齐全；
 *   - 同库二次 initDb：零 DDL（db 调用计数断言，只发版本判断 batch）；
 *   - 版本落后（v=0）：重跑全量迁移并更新版本到最新。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, SCHEMA_VERSION } from '../src/server/core/db.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function makeShim(raw, calls) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { calls.push('all:' + st._sql.slice(0, 40)); return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { calls.push('first:' + st._sql.slice(0, 40)); return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { calls.push('run:' + st._sql.slice(0, 40)); const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      calls.push('batch:' + stmts.length + 'stmts');
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

function setup(t) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const calls = [];
  const db = makeShim(raw, calls);
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  return { raw, db, calls };
}

const REQUIRED_TABLES = ['users', 'auth_sessions', 'rate_limits', 'teacher_profiles', 'student_demands',
  'reviews', 'invite_codes', 'demand_intents', 'conversations', 'messages', 'posts', 'post_likes',
  'post_favorites', 'complaints', 'demand_pushes', 'uploads', 'feedbacks', 'user_settings', 'contracts',
  'signing_requests', 'schema_meta'];

test('首次 initDb：建 schema_meta 版本 + 全部表齐全', async (t) => {
  const { raw, db } = setup(t);
  await initDb(db, ENV);
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, 'schema_meta 记录最新版本');
  for (const tbl of REQUIRED_TABLES) {
    const row = raw.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?`).get(tbl);
    assert.ok(row, `表 ${tbl} 应存在`);
  }
});

test('同库二次 initDb：跳过全量迁移（零 DDL 调用，只发版本判断 batch）', async (t) => {
  const { raw, db, calls } = setup(t);
  await initDb(db, ENV);
  const n = calls.length;
  await initDb(db, ENV); // 模拟同一 isolate 后续请求（env._dbInited 已缓存时不触发，此处直接再调）
  const delta = calls.slice(n);
  const ddl = delta.filter(c => /CREATE TABLE|ALTER TABLE|PRAGMA|schema_meta/.test(c));
  assert.equal(ddl.length, 0, '二次 initDb 无任何 DDL/迁移调用（全量迁移被版本判断跳过）');
  assert.ok(delta.length <= 2, `二次 initDb 仅 1 次版本判断 batch（实际 ${delta.length} 次 db 调用）`);
  // 版本仍为最新
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '二次 initDb 后版本不变');
});

test('schema 版本落后：重跑全量迁移并更新版本到最新', async (t) => {
  const { raw, db, calls } = setup(t);
  await initDb(db, ENV);
  raw.prepare(`UPDATE schema_meta SET v=0 WHERE k='schema'`).run(); // 模拟版本落后
  const n = calls.length;
  await initDb(db, ENV);
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '版本落后重跑后更新到最新');
  const delta = calls.slice(n);
  // 全量迁移 = 19 表 CREATE 的 batch（batch:Nstmts 摘要；版本判断 batch 仅 2 stmts）
  assert.ok(delta.some(c => /^batch:([3-9]|\d{2,})stmts$/.test(c)), `版本落后时重跑全量迁移（实际调用：${delta.join(', ')}）`);
});

// V-4-1c 抓出：V-2-4a 给 initNotifyTable 加 type/params 列时未 bump SCHEMA_VERSION（7→8 漏步），
// 存量 v7 库（schema_meta=7 + notifications 缺结构化列）在 initDb 版本判断下跳过全量迁移 → 缺列生产事故。
// 回归钉死：版本 bump 必须覆盖「上一版本库」的待补列。
test('版本落后到上一版（v7 存量库缺通知结构化列）：重跑迁移补 type/params', async (t) => {
  const { raw, db } = setup(t);
  await initDb(db, ENV); // 先建出最新全量
  // 模拟 v7 存量生产形状：notifications 无 type/params 列 + schema_meta=7（本机 SQLite ≥3.35 支持 DROP COLUMN）
  raw.exec('ALTER TABLE notifications DROP COLUMN type');
  raw.exec('ALTER TABLE notifications DROP COLUMN params');
  raw.exec("UPDATE schema_meta SET v=7 WHERE k='schema'");
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('notifications') WHERE name IN ('type','params')`).get().n, 0, '前置：notifications 无结构化列');
  await initDb(db, ENV); // 版本落后 → 全量迁移
  const cols = raw.prepare(`SELECT name FROM pragma_table_info('notifications')`).all().map(r => r.name);
  assert.ok(cols.includes('type') && cols.includes('params'), `notifications 重跑迁移后补 type/params（实际列：${cols.join(',')}）`);
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '重跑后版本更新到最新');
});
