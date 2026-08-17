/**
 * v0.25.95（调试阶段放开）：管理员可移除全部需求（含已签约 contracted）。
 *
 * 背景：原 handleAdminDeleteDemand 拦 CONTRACTED（「已签约需求禁删——合同 demand_id 会悬空」），
 * 数据层 dbDeleteDemand 也以 NOT EXISTS(活跃合同引用) 原子拒删（F-03b 防悬空，曾致线上事故）。
 * 调试阶段放开：管理员改走 dbAdminForceDeleteDemand——同一事务内先清 contracts / signing_requests
 * 的 demand_id 引用（两者均裸 INTEGER 无 FK），再删需求；demand_intents / demand_pushes 经 FK 级联。
 * 常规（非管理员）删除路径仍保留原子门禁。
 *
 * 本测试覆盖：
 *   - 管理员删除 contracted 需求 → 200；需求行删除；
 *   - 引用合同 demand_id 被清 NULL（不悬空，合同本体保留）；
 *   - 引用签约请求 demand_id 被清 NULL（请求保留）；
 *   - 常规 student 删除路径不受影响（contracted 仍拒删，F-03b 门禁保留）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleAdminDeleteDemand } from '../src/server/domains/admin/api.js';
import { handleDeleteDemand } from '../src/server/domains/demand/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
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
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

/** 播种：admin + s1 学生 + t1 教师；d1 = s1 的 contracted 需求；C1=s1-t1；合同+签约请求各一条引用 d1 */
async function seed(db, raw) {
  await initDb(db, ENV);
  // admin_sufe 由 initDb 按 ENV.ADMIN_USERNAMES 种子创建（upsert），此处只插业务用户
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const s1 = idOf('s1'), t1 = idOf('t1');
  raw.prepare(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact,status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(s1, 'senior1', 'female', '["math"]', '[]', 'self', '13800000000', '13800000000', 'contracted');
  const d1 = raw.prepare('SELECT id FROM student_demands ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t1, d1);
  const conv = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  // 引用 d1 的合同（signed）与签约请求（pending）
  raw.prepare(`INSERT INTO contracts (conversation_id, drafter_user_id, method, status, demand_id) VALUES (?,?,'online','signed',?)`).run(conv, t1, d1);
  raw.prepare(`INSERT INTO signing_requests (conversation_id, demand_id, initiator_user_id, status) VALUES (?,?,?,'pending')`).run(conv, d1, t1);
  const mkToken = async (name, role) => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { s1, t1, d1, conv, adminToken: await mkToken('admin_sufe', 'admin'), s1Token: await mkToken('s1', 'student') };
}

test('管理员删除 contracted 需求 → 200；合同/签约请求 demand_id 清 NULL（不悬空），合同本体保留', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, conv, adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteDemand(db, d1, {}, reqOf(adminToken));
  assert.equal(r.status, 200, '管理员可删已签约需求');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 0, '需求行已删');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE conversation_id=?').get(conv).c, 1, '合同本体保留');
  assert.equal(raw.prepare('SELECT demand_id FROM contracts WHERE conversation_id=?').get(conv).demand_id, null, '合同 demand_id 清 NULL 不悬空');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests WHERE conversation_id=?').get(conv).c, 1, '签约请求保留');
  assert.equal(raw.prepare('SELECT demand_id FROM signing_requests WHERE conversation_id=?').get(conv).demand_id, null, '签约请求 demand_id 清 NULL');
});

test('常规学生删除路径不受影响：contracted 需求仍拒删（F-03b 门禁保留）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { d1, s1Token } = await seed(db, raw);
  const r = await handleDeleteDemand(db, d1, {}, reqOf(s1Token));
  assert.equal(r.status, 409, '非管理员删 contracted 仍被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM student_demands WHERE id=?').get(d1).c, 1, '需求未删');
});

test('管理员删除不存在需求 → 404', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { adminToken } = await seed(db, raw);
  const r = await handleAdminDeleteDemand(db, 99999, {}, reqOf(adminToken));
  assert.equal(r.status, 404, '不存在需求 404');
});
