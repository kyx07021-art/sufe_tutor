/**
 * ZD-4（2026-08-26 休眠签约）：评价门禁放宽守护测试。
 * 用户原话：「解除所有禁止在会话中发布联系方式的提醒，让用户自由沟通」。
 * 语义 = 评价门禁从「签约后（dbIsContracted）」放宽到「建立会话后（dbIsMatched）」——
 * 签约全链路休眠后 dbIsContracted 恒 false 会导致评价死锁；放宽为会话后评价（自由沟通语义延伸）。
 *
 * G2 变异守护：还原 `dbIsMatched` 为 `dbIsContracted`（reviews/api.js:30）
 * → 本文件「已建立会话学生可评价」断言必红（会话学生无签约记录 → 403）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { handleCreateReview } from '../src/server/domains/reviews/api.js';
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

async function seed() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('studentA','h','s','student'),('studentB','h','s','student'),('teacher1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const sa = idOf('studentA'), sb = idOf('studentB'), t = idOf('teacher1');
  // 会话：仅 studentA ↔ teacher1（studentB 未建立会话）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(sa, t, null);
  const mkToken = async name => {
    const token = `${name}-tok`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { db, t, sa, sb, saToken: await mkToken('studentA'), sbToken: await mkToken('studentB') };
}

const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });
const reviewBody = teacherUserId => ({ teacherUserId, rating: 5, comment: '讲课非常清晰，认真负责。' });

test('ZD-4 未建立会话的学生 → 403 REVIEW_CONTRACT_ONLY（不可评价）', async () => {
  const { db, t, sbToken } = await seed();
  const r = await handleCreateReview(db, reviewBody(t), reqOf(sbToken));
  assert.equal(r.status, 403, `非会话学生应 403（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.code, 'REVIEW_REVIEW_CONTRACT_ONLY', `403 稳定码应为 REVIEW_REVIEW_CONTRACT_ONLY（实测 ${body.code}）`);
});

test('ZD-4 已建立会话的学生 → 评价成功（自由沟通语义延伸）', async () => {
  const { db, t, saToken } = await seed();
  const r = await handleCreateReview(db, reviewBody(t), reqOf(saToken));
  const bodyText = await r.text();
  assert.equal(r.status, 200, `会话学生应 200（实测 status=${r.status}，body=${bodyText}）`);
  const body = JSON.parse(bodyText);
  assert.ok(body.id > 0, `应返回评价 id`);
});
