/**
 * Z-4-F1 回归：messages.kind CHECK 保数据换表迁移（signing_request/signing_response 生产插入
 * 曾被 CHECK 拒绝致 1101 断线）+ 终态补 name/thumb 列。
 *
 * 初审 FAIL 修正（规则 28 回滚重做）：
 *   - 索引回归：idx_messages_conv 曾放换表条件分支内，新库 MESSAGES_DDL 已是终态 CHECK → 短路
 *     跳过 → 索引永不创建。现移 migrate postEnsure 无条件路径（本测试「新库必建索引」断言锁死）。
 *   - 条件对齐：显式检查全部 6 个 kind 缺任一即换表（原只查 contract+signing_request，中间态漏迁）。
 *   - 动态 carry：PRAGMA 探测旧表列，name/thumb 有则随迁（旧库保真），终态库无谓换表消除。
 *
 * 场景：noCols（旧表无 name/thumb）/ noThumb（有 name 无 thumb）/ full（终态跳过）/ 回滚（预置
 * messages_old 使 RENAME 失败整批回滚）/ 新库索引。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, SCHEMA_VERSION } from '../src/server/core/db.js';
import * as chatSchema from '../src/server/domains/chat/schema.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

const OLD_MESSAGES_DDL = (extra) => `CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract')),
      body TEXT NOT NULL DEFAULT '',
      ${extra}
      created_at DATETIME DEFAULT (datetime('now','localtime')))`;

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = OFF'); // 隔离迁移逻辑（旧表不挂 FK 引用行）
  const db = d1Shim(raw);
  await initDb(db, ENV); // 建全表（messages 为终态）
  return { raw, db };
}
const kindSqlOf = (raw) => raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get().sql;
const idxExists = (raw, name) => !!raw.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='index' AND name=?").get(name);

test('Z-4-F1: 新库必建 idx_messages_conv（初审 FAIL 索引回归锁死）', async () => {
  const { raw } = await setup();
  assert.ok(idxExists(raw, 'idx_messages_conv'), '新库（终态 messages）必须建 conversation_id+id 索引');
});

test('Z-4-F1: noCols 旧表（无 name/thumb）→ 换表保数据 + 终态列 + 新 kind 可插入', async () => {
  const { raw, db } = await setup();
  raw.exec('DROP TABLE messages');
  raw.exec(OLD_MESSAGES_DDL(''));
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (1, 1, 'text', 'hi'), (1, 1, 'file', 'f')").run();
  await chatSchema.migrate(db, { phase: 'postCreate' });
  const sql = kindSqlOf(raw);
  assert.ok(sql.includes("'signing_request'") && sql.includes("'signing_response'"), 'CHECK 含新 kind');
  assert.ok(sql.includes('name TEXT') && sql.includes('thumb TEXT'), '终态含 name/thumb 列');
  const rows = raw.prepare('SELECT id, kind, body FROM messages ORDER BY id').all();
  assert.equal(rows.length, 2, '数据逐行保真');
  assert.equal(rows[1].body, 'f');
  // 新 kind 插入成功（修复前 CHECK 拒绝 → 生产 1101）
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (1, 1, 'signing_request', 's')").run();
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM messages WHERE kind=\'signing_request\'').get().c, 1);
  assert.ok(!raw.prepare("SELECT 1 x FROM sqlite_master WHERE name='messages_old'").get(), '旧表已删');
});

test('Z-4-F1: noThumb 中间态（有 name 无 thumb）→ name 保真 + thumb 补空', async () => {
  const { raw, db } = await setup();
  raw.exec('DROP TABLE messages');
  raw.exec(OLD_MESSAGES_DDL(`name TEXT NOT NULL DEFAULT '',`));
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body, name) VALUES (1, 1, 'file', 'f', 'pic.png')").run();
  await chatSchema.migrate(db, { phase: 'postCreate' });
  const r = raw.prepare("SELECT name, thumb FROM messages WHERE body='f'").get();
  assert.equal(r.name, 'pic.png', 'name 随迁保真');
  assert.equal(r.thumb, '', 'thumb 补空列');
});

test('Z-4-F1: full 终态库无谓换表消除（短路跳过，数据原样）', async () => {
  const { raw, db } = await setup();
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (1, 1, 'signing_response', 'sr')").run();
  await chatSchema.migrate(db, { phase: 'postCreate' });
  assert.ok(!raw.prepare("SELECT 1 x FROM sqlite_master WHERE name='messages_old'").get(), '终态库不换表');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM messages WHERE kind='signing_response'").get().c, 1, '数据未动');
  assert.ok(idxExists(raw, 'idx_messages_conv'), '终态库索引仍在');
});

test('Z-4-F1: 回滚安全——预置 messages_old 使 RENAME 失败，整批 ROLLBACK 原表不动', async () => {
  const { raw, db } = await setup();
  raw.exec('DROP TABLE messages');
  raw.exec(OLD_MESSAGES_DDL(''));
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (1, 1, 'text', 'keep')").run();
  raw.exec(`CREATE TABLE messages_old (id INTEGER PRIMARY KEY, note TEXT)`); // 制造 RENAME 冲突
  raw.prepare("INSERT INTO messages_old (id, note) VALUES (999, 'pre-existing')").run();
  await assert.rejects(chatSchema.migrate(db, { phase: 'postCreate' }), '预置冲突应使迁移抛错');
  // 整批回滚：messages 原样（旧 CHECK + 数据保留），messages_old 未被改写
  const sql = kindSqlOf(raw);
  assert.ok(!sql.includes("'signing_request'"), 'messages 未被改写（回滚）');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM messages WHERE body='keep'").get().c, 1, '原数据保留');
  assert.equal(raw.prepare("SELECT note FROM messages_old WHERE id=999").get().note, 'pre-existing', '冲突表未被破坏');
});

// Z-4-F1 复审 FAIL 修正：SCHEMA_VERSION 漏 bump（8→9）致生产版本门控短路迁移永不执行（V-4-1c 同型）。
// 回归钉死：存量 v8 库（生产 v2.0.1 形状：5-kind CHECK + name/thumb 带数据）initDb 必须跑迁移。
test('Z-4-F1: v8 存量库（5-kind + name/thumb 带数据）initDb 重跑迁移补 signing_response + 版本更新', async () => {
  const { raw, db } = await setup();
  // 模拟生产 v2.0.1 形状：上一版迁移产物（5-kind CHECK 缺 signing_response）+ name/thumb 已带数据
  raw.exec('DROP TABLE messages');
  raw.exec(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL, sender_user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text','image','file','contract','signing_request')),
    body TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', thumb TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now','localtime')))`);
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body, name, thumb) VALUES (1, 1, 'file', 'f', 'pic.png', 't.png')").run();
  raw.prepare("UPDATE schema_meta SET v=8 WHERE k='schema'").run();
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('messages') WHERE name='thumb'`).get().n, 1, '前置：v8 库已含 name/thumb');
  await initDb(db, ENV); // 版本落后（8<9）→ 全量迁移（chat postCreate migrateMessagesKind 换表补 6-kind）
  const sql = kindSqlOf(raw);
  assert.ok(sql.includes("'signing_response'"), '换表后 CHECK 含 signing_response（修复目标在生产生效）');
  const r = raw.prepare("SELECT name, thumb FROM messages WHERE body='f'").get();
  assert.equal(r.name, 'pic.png', '存量数据保真');
  assert.equal(r.thumb, 't.png', 'thumb 保真');
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (1, 1, 'signing_response', 'sr')").run(); // 修复前 CHECK 拒绝 → 1101
  assert.ok(true, 'signing_response 可插入');
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '版本更新到最新');
});
