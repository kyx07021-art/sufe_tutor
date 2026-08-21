/**
 * AI-6：会话重启 reopen——dbUpsertConversation 命中 closed 行 → 重启原会话
 * （status→active + demand 回填，历史保留）；用户模型「一对师生终身一个会话对象，
 * closed 后再次合作 = 重启原会话，非新建」；双调用点（意向/推送接受）经同一元组命中。
 *
 * 本测试数据层直测 dbUpsertConversation（AI-6 为数据层基元；调用点 handleResolveIntent/
 * handleResolvePush 的完整链路由既有 demand 测试覆盖）。变异守护：删重启 UPDATE →
 * closed 会话再配对不重启（红）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbUpsertConversation } from '../src/server/domains/chat/repo.js';

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
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };

// 种子：s1/t1 + 会话（status 参数控制 closed/active）+ 历史消息（验证历史保留）
async function seed(db, raw, convStatus = 'active') {
  await initDb(db, ENV);
  const s1 = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')").run().lastInsertRowid);
  const t1 = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run().lastInsertRowid);
  const c1 = Number(raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (?,?,?)')
    .run(s1, t1, convStatus).lastInsertRowid);
  // 历史消息 + 已读游标（验证重启后保留）
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)").run(c1, t1, 'text', '历史消息');
  raw.prepare('UPDATE conversations SET student_last_read_id=(SELECT MAX(id) FROM messages WHERE conversation_id=?) WHERE id=?').run(c1, c1);
  return { s1, t1, c1 };
}

test('closed 会话再配对 → 重启 active + demand 回填 + 返回同一会话 id', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw, 'closed');
  const d1 = Number(raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,'senior1','female','["math"]','[]','self','13800000000','13800000000','open')`).run(s1).lastInsertRowid);
  const id = await dbUpsertConversation(db, s1, t1, d1);
  assert.equal(id, c1, '重启返回原会话 id（终身一会话，非新建）');
  const row = raw.prepare('SELECT status, demand_id FROM conversations WHERE id=?').get(c1);
  assert.equal(row.status, 'active', '会话重启 active');
  assert.equal(row.demand_id, d1, 'demand 回填为新合作需求');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, '恒一会话行（不新建）');
});

test('重启保留历史：消息与已读游标不重置', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw, 'closed');
  await dbUpsertConversation(db, s1, t1, null);
  const row = raw.prepare('SELECT status, student_last_read_id FROM conversations WHERE id=?').get(c1);
  assert.equal(row.status, 'active', '重启 active');
  assert.ok(row.student_last_read_id > 0, '已读游标保留（不重置）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id=?').get(c1).c, 1, '历史消息保留');
});

test('active 会话再次配对 → 不重启不重置（幂等无副作用）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw, 'active');
  const d1 = Number(raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,'senior1','female','["math"]','[]','self','13800000000','13800000000','open')`).run(s1).lastInsertRowid);
  await dbUpsertConversation(db, s1, t1, d1); // 首次：active 会话 demand_id 为空时回填（既有行为，非重启）
  const before = raw.prepare('SELECT status, demand_id, student_last_read_id FROM conversations WHERE id=?').get(c1);
  const id = await dbUpsertConversation(db, s1, t1, d1); // 再次：幂等零变化
  assert.equal(id, c1);
  const after = raw.prepare('SELECT status, demand_id, student_last_read_id FROM conversations WHERE id=?').get(c1);
  assert.deepEqual(after, before, 'active 会话重复配对零变化');
});

test('全新元组 → 新建会话（INSERT OR IGNORE 路径不变）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw, 'closed'); // 已有 s1-t1 会话；新建 s2-t1 元组
  const s2 = Number(raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('s2','h','s','student')").run().lastInsertRowid);
  const d1 = Number(raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,'senior1','female','["math"]','[]','self','13800000000','13800000000','open')`).run(s2).lastInsertRowid);
  const id = await dbUpsertConversation(db, s2, t1, d1);
  assert.ok(id > 0, '新建会话返回 id');
  const row = raw.prepare('SELECT status FROM conversations WHERE id=?').get(id);
  assert.equal(row.status, 'active', '新会话 active');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 2, '新元组新建会话（原有会话保留）');
});

// AI-6 O-1（审计观察项补测）：并发双配对——条件 UPDATE WHERE status='closed' 幂等（第二个请求
// 发生时 status 已 active，不命中 closed 分支），恒一会话行 + 单次重启语义由 SQL 守卫承重
test('并发双配对：closed 会话两个 dbUpsertConversation 并行 → 恒一会话行 + 重启 active', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw, 'closed');
  const d1 = Number(raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,'senior1','female','["math"]','[]','self','13800000000','13800000000','open')`).run(s1).lastInsertRowid);
  const [idA, idB] = await Promise.all([
    dbUpsertConversation(db, s1, t1, d1),
    dbUpsertConversation(db, s1, t1, d1),
  ]);
  assert.equal(idA, c1, '并行 A 返回原会话 id');
  assert.equal(idB, c1, '并行 B 返回原会话 id');
  const row = raw.prepare('SELECT status, demand_id FROM conversations WHERE id=?').get(c1);
  assert.equal(row.status, 'active', '重启 active（条件 UPDATE 幂等）');
  assert.equal(row.demand_id, d1, 'demand 回填');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM conversations').get().c, 1, '恒一会话行（不新建）');
});
