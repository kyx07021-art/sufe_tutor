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
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb, SCHEMA_VERSION } from '../src/server/core/db.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
  'reviews', 'invite_codes', 'conversations', 'messages', 'posts', 'post_likes',
  'post_favorites', 'complaints', 'uploads', 'feedbacks',
  'contracts', 'schema_meta']; // S5: merged signing_contracts -> standalone contracts; S2: intents/pushes removed; S6: user_settings dropped (privacy decommissioned)

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

// Q-2g 抓出（第三次踩坑）：Q-2d-F2 给 messages 加 client_key 列 + idx_messages_client_key 唯一索引时
// 未 bump SCHEMA_VERSION（9→9 漏步）——存量 v9 库（schema_meta=9 + messages 缺 client_key）在 initDb
// 版本判断下 `cur(9) >= 9` 短路跳过全量迁移 → client_key 永不补上 → 聊天发送/合同气泡全 500。
// 回归钉死：版本 bump 必须覆盖「上一版本库」的待补列 + 索引（V-4-1c → Z-4-F1 → Q-2d-F2 同型）。
test('版本落后到上一版（v9 存量库缺 messages.client_key）：重跑迁移补列 + 唯一索引', async (t) => {
  const { raw, db } = setup(t);
  await initDb(db, ENV); // 先建出最新全量
  // 模拟 v9 存量生产形状：messages 无 client_key 列 + schema_meta=9（本机 SQLite ≥3.35 支持 DROP COLUMN）
  raw.exec('DROP INDEX IF EXISTS idx_messages_client_key'); // v9 库本无此索引（Q-2d 才引入），先删再卸列
  raw.exec('ALTER TABLE messages DROP COLUMN client_key');
  raw.exec("UPDATE schema_meta SET v=9 WHERE k='schema'");
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('messages') WHERE name='client_key'`).get().n, 0, '前置：messages 无 client_key');
  await initDb(db, ENV); // 版本落后 → 全量迁移
  const cols = raw.prepare(`SELECT name FROM pragma_table_info('messages')`).all().map(r => r.name);
  assert.ok(cols.includes('client_key'), 'messages 重跑迁移后补 client_key');
  const idx = raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_messages_client_key'`).get().n;
  assert.equal(idx, 1, 'idx_messages_client_key 唯一索引重建');
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '重跑后版本更新到最新');
});


// S5-02: merged signing_contracts table (AI-4a) -> standalone contracts table migration.
// Legacy DB re-run copies stage='contract' rows 1:1 (contract number #CD{id} and ledger contract_id
// stay unchanged -> zero remap), maps ''/'pending' contract_status -> 'signing', generalizes hourly_rate
// -> rate, then DROPs signing_contracts. Re-run is a no-op (idempotent).
test('S5 migration: legacy signing_contracts -> standalone contracts (id 1:1 / status mapping / rate generalization / old table dropped / idempotent)', async (t) => {
  const { raw, db } = setup(t);
  await initDb(db, ENV); // build the latest full schema first (contracts exists, no signing_contracts)
  // seed users + a conversation (contracts carries no FK; the conversation row is only the historical link shape)
  const s1 = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s5_s1','x','x','student')").run().lastInsertRowid);
  const t1 = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s5_t1','x','x','teacher')").run().lastInsertRowid);
  const convId = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t1).lastInsertRowid);
  // seed the legacy merged table with the exact AI-4a SIGNING_CONTRACTS_DDL shape (signing layer +
  // contract layer). Every contract field is NOT NULL DEFAULT in the real merged table, so the S5
  // migration SELECT reads non-NULL values into the standalone contracts NOT NULL columns.
  raw.exec(`CREATE TABLE signing_contracts (
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
    updated_at DATETIME DEFAULT (datetime('now')))`);
  raw.prepare("INSERT INTO signing_contracts (id, student_user_id, teacher_user_id, conversation_id, demand_id, stage, contract_status, hourly_rate, drafter_user_id, contract_md, prev_business) VALUES (7,?,?,?,555,'contract','pending',150,?,?,?)")
    .run(s1, t1, convId, t1, 'migrated-body-A', 'prior-business-A');
  raw.prepare("INSERT INTO signing_contracts (id, student_user_id, teacher_user_id, conversation_id, stage, contract_status, hourly_rate, drafter_user_id, contract_md) VALUES (8,?,?,?, 'contract','signed',200,?,?)")
    .run(s1, t1, convId, t1, 'migrated-body-B');
  // signing-layer row must NOT be copied (the signing layer is dropped wholesale, S5-19)
  raw.prepare("INSERT INTO signing_contracts (id, student_user_id, teacher_user_id, conversation_id, stage, signing_status, hourly_rate) VALUES (9,?,?,?, 'signing','pending',0)")
    .run(s1, t1, convId);
  // simulate a legacy DB: one schema version behind + the merged table present
  raw.prepare("UPDATE schema_meta SET v=? WHERE k='schema'").run(SCHEMA_VERSION - 1);
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='signing_contracts'`).get().n, 1, 'precondition: legacy signing_contracts table exists');
  await initDb(db, ENV); // version behind -> full migration -> postEnsure S5-02 copy + DROP
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='contracts'`).get().n, 1, 'contracts table exists');
  const rows = raw.prepare('SELECT id, contract_status, rate, contract_md, prev_business, conversation_id FROM contracts ORDER BY id').all().map(r => ({ ...r }));
  assert.equal(rows.length, 2, 'only stage=contract rows migrated (signing layer dropped)');
  assert.deepEqual(rows[0], { id: 7, contract_status: 'signing', rate: 150, contract_md: 'migrated-body-A', prev_business: 'prior-business-A', conversation_id: convId }, 'pending -> signing mapping + hourly_rate -> rate + id 1:1');
  assert.deepEqual(rows[1], { id: 8, contract_status: 'signed', rate: 200, contract_md: 'migrated-body-B', prev_business: null, conversation_id: convId }, 'signed passes through + id 1:1');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='signing_contracts'`).get().n, 0, 'signing_contracts dropped');
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, 'version updated to latest after migration');
  // idempotent: re-trigger full migration (signing_contracts gone -> copy skipped) -> contracts data unchanged
  raw.prepare("UPDATE schema_meta SET v=? WHERE k='schema'").run(SCHEMA_VERSION - 1);
  await initDb(db, ENV);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM contracts').get().n, 2, 'idempotent re-run leaves contracts data unchanged');
  const ver2 = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver2.v, SCHEMA_VERSION, 'idempotent re-run still ends at latest version');
});
