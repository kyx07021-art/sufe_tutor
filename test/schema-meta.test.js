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
  'reviews', 'invite_codes', 'demand_intents', 'conversations', 'messages', 'posts', 'post_likes',
  'post_favorites', 'complaints', 'demand_pushes', 'uploads', 'feedbacks', 'user_settings', 'contracts',
  'signing_requests', 'signing_contracts', 'schema_meta'];

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

// AI-3：signing_requests/contracts 自持双方元组（relation 抽象父类平级子实体，业务去 conversation join）。
// 存量 v10 库缺 student_user_id/teacher_user_id 列 → initDb 版本落后重跑迁移补列 + 按 conversation_id 回填双方元组（幂等只填空）。
test('版本落后到上一版（v10 存量库缺双方元组列）：重跑迁移补列 + 回填 + 幂等', async (t) => {
  const { raw, db, calls } = setup(t);
  await initDb(db, ENV); // 先建出最新全量
  // 造一对师生 + 会话 + 签约 + 合同（存量行带 conversation_id）
  const s = raw.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('ai_stu','x','x','student')`).run();
  const studentId = Number(s.lastInsertRowid);
  const tc = raw.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('ai_tea','x','x','teacher')`).run();
  const teacherId = Number(tc.lastInsertRowid);
  const cv = raw.prepare(`INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)`).run(studentId, teacherId);
  const convId = Number(cv.lastInsertRowid);
  const sr = raw.prepare(`INSERT INTO signing_requests (conversation_id, initiator_user_id, price, schedule, method) VALUES (?,?,100,'周一 18:00','online')`).run(convId, studentId);
  const srId = Number(sr.lastInsertRowid);
  const ct = raw.prepare(`INSERT INTO contracts (conversation_id, drafter_user_id, contract_md) VALUES (?,?,'md')`).run(convId, studentId);
  const ctId = Number(ct.lastInsertRowid);
  // 模拟 v10 存量生产形状：双方元组列缺失 + schema_meta=10（本机 SQLite ≥3.35 支持 DROP COLUMN）
  raw.exec('ALTER TABLE signing_requests DROP COLUMN student_user_id');
  raw.exec('ALTER TABLE signing_requests DROP COLUMN teacher_user_id');
  raw.exec('ALTER TABLE contracts DROP COLUMN student_user_id');
  raw.exec('ALTER TABLE contracts DROP COLUMN teacher_user_id');
  raw.exec("UPDATE schema_meta SET v=10 WHERE k='schema'");
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('signing_requests') WHERE name='student_user_id'`).get().n, 0, '前置：signing_requests 无 student_user_id');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('contracts') WHERE name='student_user_id'`).get().n, 0, '前置：contracts 无 student_user_id');
  await initDb(db, ENV); // 版本落后 → 全量迁移补列 + 回填
  const srRow = raw.prepare(`SELECT student_user_id, teacher_user_id FROM signing_requests WHERE id=?`).get(srId);
  assert.equal(srRow.student_user_id, studentId, 'signing_requests 回填 student_user_id');
  assert.equal(srRow.teacher_user_id, teacherId, 'signing_requests 回填 teacher_user_id');
  const ctRow = raw.prepare(`SELECT student_user_id, teacher_user_id FROM contracts WHERE id=?`).get(ctId);
  assert.equal(ctRow.student_user_id, studentId, 'contracts 回填 student_user_id');
  assert.equal(ctRow.teacher_user_id, teacherId, 'contracts 回填 teacher_user_id');
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '重跑后版本更新到最新');
  // 幂等：二次 initDb 无任何 DDL/迁移调用
  const n = calls.length;
  await initDb(db, ENV);
  const delta = calls.slice(n);
  const ddl = delta.filter(c => /CREATE TABLE|ALTER TABLE|PRAGMA/.test(c));
  assert.equal(ddl.length, 0, `二次 initDb 无 DDL（迁移幂等，实际：${delta.join(', ')}）`);
});

// AI-4a：signing/contract 合并表（同一实体不同 stage 层级）+ 存量迁移——signing 行保留原 id（气泡引用不变）；
// signed 签约关联合同合并进该行 stage='contract'（schedule/method 透传合同值而非签约提案值，F-1）；
// 无关联合同独立新行（含 NULL-demand，BUG-2 修复 COALESCE(demand_id,-1) 幂等复跑不重复插）。
// 存量 v11 库无 signing_contracts → 重跑迁移建表 + 迁数据。
test('版本落后到上一版（v11 存量库无 signing_contracts）：重跑迁移建合并表 + 存量迁移 + schedule/method 透传 + NULL-demand 幂等', async (t) => {
  const { raw, db } = setup(t);
  await initDb(db, ENV); // 先建最新全量
  const s = raw.prepare(`INSERT INTO users (username,password_hash,salt,role) VALUES ('v_s1','x','x','student')`).run();
  const s1 = Number(s.lastInsertRowid);
  const tcr = raw.prepare(`INSERT INTO users (username,password_hash,salt,role) VALUES ('v_t1','x','x','teacher')`).run();
  const t1 = Number(tcr.lastInsertRowid);
  const cv = raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t1);
  const convId = Number(cv.lastInsertRowid);
  const dem = raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,'open')`).run(s1, 'senior1','female','["math"]','[]','self','13800000000','13800000000');
  const d1 = Number(dem.lastInsertRowid);
  // pending 签约（提案值：周一 18:00 / online）
  raw.prepare(`INSERT INTO signing_requests (conversation_id,demand_id,initiator_user_id,price,schedule,method,status,student_user_id,teacher_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(convId, d1, s1, 100, '周一 18:00', 'online', 'pending', s1, t1);
  // signed 签约（提案值：周六 09:00 / offline）
  raw.prepare(`INSERT INTO signing_requests (conversation_id,demand_id,initiator_user_id,price,schedule,method,status,student_user_id,teacher_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(convId, d1, s1, 150, '周六 09:00', 'offline', 'signed', s1, t1);
  // 关联合同（草拟阶段协商变更：周一 19:00 / online —— 合并行必须透传合同值，F-1）
  const ct1 = raw.prepare(`INSERT INTO contracts (conversation_id,demand_id,drafter_user_id,contract_md,status,schedule,method,student_user_id,teacher_user_id) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(convId, d1, s1, 'md1', 'signing', '周一 19:00', 'online', s1, t1);
  const ct1Id = Number(ct1.lastInsertRowid);
  // NULL-demand 无关联合同（BUG-2 场景：demand_id 空）——用第二教师造独立会话，不撞 conversations UNIQUE
  const t2r = raw.prepare(`INSERT INTO users (username,password_hash,salt,role) VALUES ('v_t2','x','x','teacher')`).run();
  const t2 = Number(t2r.lastInsertRowid);
  const cv2 = raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t2);
  const convId2 = Number(cv2.lastInsertRowid);
  const ct2 = raw.prepare(`INSERT INTO contracts (conversation_id,drafter_user_id,contract_md,status,schedule,method,student_user_id,teacher_user_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(convId2, t2, 'md2', 'signed', '周三 20:00', 'online', s1, t2);
  const ct2Id = Number(ct2.lastInsertRowid);
  // 模拟 v11 存量生产形状：无 signing_contracts 表 + schema_meta=11
  raw.exec('DROP TABLE signing_contracts');
  raw.exec("UPDATE schema_meta SET v=11 WHERE k='schema'");
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='signing_contracts'`).get().n, 0, '前置：无 signing_contracts');
  await initDb(db, ENV); // 版本落后 → 全量迁移建表 + 迁数据
  const rows = raw.prepare('SELECT id, stage, signing_status, contract_status, legacy_contract_id, student_user_id, teacher_user_id, schedule, method FROM signing_contracts ORDER BY id').all();
  assert.equal(rows.length, 3, '3 行：pending 签约 + signed 签约(合并合同) + NULL-demand 独立合同');
  assert.equal(rows[0].id, 1, 'signing 行保留原 id（气泡 body signing id 引用不变）');
  assert.equal(rows[0].stage, 'signing');
  assert.equal(rows[0].signing_status, 'pending');
  assert.equal(rows[0].student_user_id, s1);
  assert.equal(rows[0].teacher_user_id, t1);
  assert.equal(rows[0].schedule, '周一 18:00', 'pending 行保留签约提案 schedule');
  assert.equal(rows[0].method, 'online', 'pending 行保留签约提案 method');
  assert.equal(rows[1].id, 2, 'signed 签约保留原 id');
  assert.equal(rows[1].stage, 'contract', '合并合同后 stage 推进 contract');
  assert.equal(rows[1].contract_status, 'signing', '合同状态透传');
  assert.equal(rows[1].legacy_contract_id, ct1Id, 'legacy_contract_id 记录旧合同 id');
  assert.equal(rows[1].schedule, '周一 19:00', '合并行 schedule 透传合同值（非签约提案值，F-1）');
  assert.equal(rows[1].method, 'online', '合并行 method 透传合同值（F-1）');
  assert.equal(rows[2].stage, 'contract');
  assert.equal(rows[2].signing_status, 'signed', '独立合同 signing_status 兜底 signed');
  assert.equal(rows[2].contract_status, 'signed');
  assert.equal(rows[2].legacy_contract_id, ct2Id);
  assert.equal(rows[2].schedule, '周三 20:00', '独立行 schedule 透传合同值（F-1）');
  assert.equal(rows[2].method, 'online', '独立行 method 透传合同值（F-1）');
  // BUG-2 幂等：再次落后复跑迁移 → 行数不变（NULL-demand 合同不重复插独立行）
  raw.exec("UPDATE schema_meta SET v=11 WHERE k='schema'");
  await initDb(db, ENV);
  const n2 = raw.prepare('SELECT COUNT(*) AS c FROM signing_contracts').get().c;
  assert.equal(n2, 3, '复跑迁移幂等：NULL-demand 合同不重复插行（BUG-2）');
  const ver = raw.prepare("SELECT v FROM schema_meta WHERE k='schema'").get();
  assert.equal(ver.v, SCHEMA_VERSION, '重跑后版本更新到最新');
});
