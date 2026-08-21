/**
 * AI-7：统一关系清单接口 GET /api/my-relations——按双方元组聚合（会话状态/最后消息 +
 * 最新 signing_contracts 状态 + 对端信息），供连线图/关系管理。仅读零写入。
 *
 * 数据层直测 dbGetMyRelations + handler 形状（handleGetMyRelations 只做 requireUser + 映射，
 * 无业务门禁）。变异守护：删 LEFT JOIN signing_contracts 聚合 → SQL 占位符失配查询崩（4 红，
 * 未登录 401 仍绿）→ 还原 5/5 绿（聚合 JOIN 承重实证）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleGetMyRelations } from '../src/server/domains/chat/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';

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

// 种子：s1/t1/t2 + 会话（c1: s1-t1、c2: s1-t2）+ t1 发的消息 + token（G3：全部 lastInsertRowid，禁硬编码 uid——initDb seedAdmins 占 id=1）
async function seed(db, raw) {
  await initDb(db, ENV);
  const ins = sql => Number(raw.prepare(sql).run().lastInsertRowid);
  const s1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student')");
  const t1 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')");
  const t2 = ins("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')");
  const c1 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t1},'active')`);
  const c2 = ins(`INSERT INTO conversations (student_user_id, teacher_user_id, status) VALUES (${s1},${t2},'closed')`);
  raw.prepare("INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)").run(c1, t1, 'text', '你好同学');
  const mk = async (name, uid) => {
    const token = `${name}-token`, sessionId = `sess-${name}`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at,session_id) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), uid, 'x', '2099-01-01 00:00:00', sessionId);
    return { token, uid };
  };
  return { s1, t1, t2, c1, c2, s1a: await mk('s1', s1), t1a: await mk('t1', t1), t2a: await mk('t2', t2) };
}

const mkSigning = (raw, s, t, c, stage, signingStatus, contractStatus) =>
  Number(raw.prepare(`INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status)
    VALUES (?,?,?,?,?,?)`).run(s, t, c, stage, signingStatus, contractStatus).lastInsertRowid);

test('聚合：对端信息 + 最后消息 + active 状态', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1a, t1, c1 } = await seed(db, raw);
  const r = await handleGetMyRelations(db, reqOf(s1a.token));
  assert.equal(r.status, 200);
  const rel = (await r.json()).relations.find(x => x.conversationId === c1);
  assert.equal(rel.status, 'active');
  assert.deepEqual(rel.other, { id: t1, role: 'teacher', name: 't1', avatar: '' }, '对端 = 教师侧');
  assert.deepEqual(rel.last, { kind: 'text', body: '你好同学', at: rel.last.at, senderId: t1 }, '最后消息 = t1 发的 text');
  assert.ok(rel.last.at, 'last_at 存在');
  assert.equal(rel.signing, null, '无签约行 → null');
});

test('最新 signing_contracts 状态按双方元组 MAX(id) 聚合', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, c1, s1a } = await seed(db, raw);
  // 旧合作已签署合同（contract signed）+ 新合作 pending 签约 → 取新行（MAX id）
  mkSigning(raw, s1, t1, c1, 'contract', 'signed', 'signed');
  const latest = mkSigning(raw, s1, t1, c1, 'signing', 'pending', '');
  const r = await handleGetMyRelations(db, reqOf(s1a.token));
  const rel = (await r.json()).relations.find(x => x.conversationId === c1);
  assert.deepEqual(rel.signing, { id: latest, stage: 'signing', signingStatus: 'pending', contractStatus: '', revoked: 0 },
    'signing 取最新行（元组 MAX id），revoked 数值化');
});

test('多会话按最后消息时间排序 + closed 会话照常列出', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1a, c1, c2 } = await seed(db, raw);
  const r = await handleGetMyRelations(db, reqOf(s1a.token));
  const rels = (await r.json()).relations;
  assert.equal(rels.length, 2, '两关系全列出（含 closed）');
  assert.deepEqual(rels.map(x => x.conversationId), [c1, c2], '有消息的 c1 在前（按 last_at 降序），c2 无消息按 created_at');
  assert.equal(rels.find(x => x.conversationId === c2).status, 'closed', 'closed 会话状态如实');
});

test('无消息会话 → last null；teacher 视角 → other=student', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, c2, t2a } = await seed(db, raw);
  const r = await handleGetMyRelations(db, reqOf(t2a.token));
  const rel = (await r.json()).relations.find(x => x.conversationId === c2);
  assert.equal(rel.last, null, 'c2 无消息 → last null');
  assert.deepEqual(rel.other, { id: s1, role: 'student', name: 's1', avatar: '' }, 'teacher 视角对端 = 学生');
});

test('未登录 → 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const r = await handleGetMyRelations(db, reqOf('bad-token'));
  assert.equal(r.status, 401);
});
