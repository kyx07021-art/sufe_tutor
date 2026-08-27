/**
 * ZR-B3：会话三出口教师名称接平台内名称（档案 real_name 优先，空/无档案回落 username）
 *
 * 覆盖三处 teacher_name 构造（chat/repo.js）：
 *   1. dbGetMyConversations（会话选择区列表）
 *   2. dbGetConversationWithNames（会话本身操作/通知文案的双方名）
 *   3. dbGetMyRelations（关系清单；含 handler 映射 other.name）
 * student_name 一律不接档案名（需求只改教师侧）。
 *
 * 变异守护：把任一查询的 `COALESCE(NULLIF(tp.real_name, ''), ut.username)` 还原为
 * `ut.username` → 下面「平台内名称」断言全红；回落断言保持绿（回落路径不依赖该表达式）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetMyConversations, dbGetConversationWithNames, dbGetMyRelations } from '../src/server/domains/chat/repo.js';
import { handleGetMyRelations } from '../src/server/domains/chat/api.js';
import { tokenDigest, encryptField } from '../src/server/core/crypto.js';

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
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

// 种子（G3：全部 lastInsertRowid，禁硬编码 uid——initDb seedAdmins 占 id=1）：
// s1 学生 + t1/t2/t3 三教师各一会话；档案三态覆盖：
//   t1 有档案且 real_name 非空（平台内名称生效）
//   t2 有档案但 real_name 空串（回落 username）
//   t3 无档案（回落 username）
async function seed(db, raw) {
  await initDb(db, ENV);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('tea_alpha','h','s','teacher')");
  const t2 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('tea_beta','h','s','teacher')");
  const t3 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('tea_gamma','h','s','teacher')");
  const c1 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t1},'active')`);
  const c2 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t2},'active')`);
  const c3 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t3},'active')`);
  raw.prepare('INSERT INTO teacher_profiles (user_id, real_name) VALUES (?,?)').run(t1, '张知途');
  raw.prepare('INSERT INTO teacher_profiles (user_id, real_name) VALUES (?,?)').run(t2, '');
  // t3 不插档案行
  return { s1, t1, t2, t3, c1, c2, c3 };
}

test('会话列表（会话选择区）：档案 real_name 非空 → teacher_name = 平台内名称；student_name 不动', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1 } = await seed(db, raw);
  const rows = await dbGetMyConversations(db, s1);
  const row = rows.find(r => r.id === c1);
  assert.equal(row.teacher_name, '张知途', '教师名 = 档案平台内名称（非 username）');
  assert.equal(row.student_name, 's1', 'student_name 保持 username 不受影响');
});

test('会话列表：档案 real_name 空串 / 无档案 → 回落 username', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c2, c3 } = await seed(db, raw);
  const rows = await dbGetMyConversations(db, s1);
  assert.equal(rows.find(r => r.id === c2).teacher_name, 'tea_beta', 'real_name 空串 → 回落 username');
  assert.equal(rows.find(r => r.id === c3).teacher_name, 'tea_gamma', '无档案行 → 回落 username');
});

test('dbGetConversationWithNames：会话本身的教师名接平台内名称，学生名不动', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { c1, c3 } = await seed(db, raw);
  const named = await dbGetConversationWithNames(db, c1);
  assert.equal(named.teacher_name, '张知途', '会话行教师名 = 平台内名称');
  assert.equal(named.student_name, 's1', '会话行学生名保持 username');
  const noProfile = await dbGetConversationWithNames(db, c3);
  assert.equal(noProfile.teacher_name, 'tea_gamma', '无档案回落 username');
});

test('关系清单数据层：档案 real_name 非空 → teacher_name = 平台内名称；无档案回落', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1, c3 } = await seed(db, raw);
  const rows = await dbGetMyRelations(db, s1);
  assert.equal(rows.find(r => r.id === c1).teacher_name, '张知途', '关系清单教师名 = 平台内名称');
  assert.equal(rows.find(r => r.id === c3).teacher_name, 'tea_gamma', '无档案回落 username');
  assert.equal(rows.find(r => r.id === c1).student_name, 's1', 'student_name 不受影响');
});

test('关系清单 handler：学生视角 other.name = 平台内名称（映射不断线）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seed(db, raw);
  const token = 's1-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
    .run(await tokenDigest(token), s1, 'x', '2099-01-01 00:00:00', 'sess-s1');
  const r = await handleGetMyRelations(db, reqOf(token));
  assert.equal(r.status, 200);
  const rel = (await r.json()).relations.find(x => x.conversationId === c1);
  assert.deepEqual(rel.other, { id: t1, role: 'teacher', name: '张知途', avatar: '' }, 'other.name = 教师平台内名称');
});

// ── ZR-B7（2026-08-27）：存量密文兼容——B6 回填执行前生产 real_name 仍是 enc:v1: 密文，
// 三出口 teacher_name 读路径 decryptField-with-fallback 须把密文解成明文（明文原样放行）。
// 变异守护：还原任一处 decryptField → 断言红。
async function seedWithCipher(raw, db) {
  const { s1, t1, c1 } = await seed(db, raw);
  // 直接把 t1 档案 real_name 改写为密文（模拟 B6 前的存量行）
  const cipher = await encryptField('密文老师');
  raw.prepare('UPDATE teacher_profiles SET real_name=? WHERE user_id=?').run(cipher, t1);
  return { s1, t1, c1, cipher };
}

test('ZR-B7 会话列表：存量密文 teacher_name → 解密显示明文（非 enc: 串）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c1, cipher } = await seedWithCipher(raw, db);
  assert.ok(String(cipher).startsWith('enc:v1:'), '夹具真实密文（enc:v1: 前缀）');
  const rows = await dbGetMyConversations(db, s1);
  const row = rows.find(r => r.id === c1);
  assert.equal(row.teacher_name, '密文老师', '存量密文解密为明文平台内名称（变异：还原 decryptField → 此处见 enc: 串必红）');
});

test('ZR-B7 dbGetConversationWithNames：存量密文 teacher_name → 明文', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { c1 } = await seedWithCipher(raw, db);
  const named = await dbGetConversationWithNames(db, c1);
  assert.equal(named.teacher_name, '密文老师', '会话行密文解密为明文（变异：还原 → 红）');
});

test('ZR-B7 关系清单：存量密文 teacher_name → 明文（含 handler 映射）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1 } = await seedWithCipher(raw, db);
  const rows = await dbGetMyRelations(db, s1);
  assert.equal(rows.find(r => r.id === c1).teacher_name, '密文老师', '关系清单密文解密为明文（变异：还原 → 红）');
  const token = 's1-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
    .run(await tokenDigest(token), s1, 'x', '2099-01-01 00:00:00', 'sess-s1');
  const r = await handleGetMyRelations(db, reqOf(token));
  const rel = (await r.json()).relations.find(x => x.conversationId === c1);
  assert.deepEqual(rel.other, { id: t1, role: 'teacher', name: '密文老师', avatar: '' }, 'handler other.name 解密为明文');
});
