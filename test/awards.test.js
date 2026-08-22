/**
 * awards 域下线态回归（S6-A5）：awards 在新站不上线（W1 不保留向后兼容）——
 * teacher_awards 表不创建、无路由注册、无迁移动作。
 *
 * 锁下线态（变异实证：把 routes 改回非空 / createStatements 加建表 / migrate 恢复建表 → 断言红）。
 * schema 文件保留导出签名（db.js SCHEMAS 注册契约）；api 文件保留 routes 导出（app.js 拼接契约）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { createStatements, ensureColumns, migrate } from '../src/server/domains/awards/schema.js';
import { routes } from '../src/server/domains/awards/api.js';

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      raw.exec('BEGIN');
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}

test('awards schema 下线态：不建表、无列迁移、migrate noop', async () => {
  assert.deepEqual(createStatements, [], 'createStatements 空：不创建 teacher_awards');
  assert.deepEqual(ensureColumns, [], 'ensureColumns 空：无列迁移');
  assert.equal(typeof migrate, 'function', 'migrate 导出保留（db.js SCHEMAS 注册契约）');
  // migrate noop：以真实迁移调用形态调用不抛错
  await migrate(null, { phase: 'postCreate' });
});

test('awards api 下线态：零路由注册', () => {
  assert.deepEqual(routes, [], 'routes 空：无 awards 路由');
});

test('awards 表真实不创建（initDb 集成锁，变异：migrate 恢复建表 → 红）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' });
  const t = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teacher_awards'").get();
  assert.equal(t, undefined, 'teacher_awards 表不创建');
});
