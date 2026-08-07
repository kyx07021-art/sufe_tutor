/**
 * 发起签约需求态守卫回归（v0.24.2 审计）
 *
 * 教训：accept 的赢家 UPDATE 原本不守卫需求状态——同需求多会话并存（v0.24.0 明确允许）下，
 * 一条需求可被「二次签约」：两条签约请求先后确认都置 signed（第二次需求置 contracted 的 UPDATE
 * 不命中被跳过，但请求仍 signed），dbIsContracted 对两对师生都放行，需求被锁死在 contracted。
 * 修复：accept 的 UPDATE 带 `EXISTS(需求 status='open')` 守卫；需求已成交/撤销/删除则 410 拒绝，
 * 请求保持 pending；reject 不依赖需求状态仍放行。
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch（与 initdb-migration.test.js 同款 shim）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleRespondSigning } from '../server/signing.js';
import { tokenDigest } from '../server/crypto.js';

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

/** 播种：s1 学生 + t1/t2 教师 + 一条需求 + 两个会话各挂一条 pending 签约请求 + s1 会话 */
async function seed(db, raw, demandStatus = 'open') {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher'),('t2','h','s','teacher')`);
  raw.exec(`INSERT INTO student_demands (user_id,student_grade,student_gender,target_subjects,current_scores,submitter_type,parent_contact,student_contact)
    VALUES (1,'senior1','female','["math"]','[]','self','13800000000','13800000000')`);
  raw.exec(`INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (1,2,1),(1,3,1)`);
  raw.exec(`INSERT INTO signing_requests (conversation_id,demand_id,initiator_user_id,message_id,price,schedule,method,status)
    VALUES (1,1,2,NULL,150,'每周六','offline','pending'),(2,1,3,NULL,150,'每周六','offline','pending')`);
  if (demandStatus !== 'open') raw.exec(`UPDATE student_demands SET status='${demandStatus}' WHERE id=1`);
  const token = 'stu-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), 1, 'x', '2099-01-01 00:00:00');
  return token;
}
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

test('需求态守卫：需求已签约成交后，另一会话的签约请求不可再 signed（防一条需求双签）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const token = await seed(db, raw);
  // 学生确认会话1的请求：需求 open → 成功，需求置 contracted
  const r1 = await handleRespondSigning(db, 1, { accept: true }, reqOf(token));
  assert.equal(r1.status, 200, '需求 open 时确认应成功');
  assert.equal(raw.prepare('SELECT status FROM student_demands WHERE id=1').get().status, 'contracted');
  // 学生再确认会话2的请求：需求已非 open → 410，请求保持 pending（不得双签）
  const r2 = await handleRespondSigning(db, 2, { accept: true }, reqOf(token));
  assert.equal(r2.status, 410, '需求已成交：二次确认必须被拒');
  assert.equal(raw.prepare('SELECT status FROM signing_requests WHERE id=2').get().status, 'pending', '第二次签约请求不得置 signed');
});

test('需求态守卫：需求已撤销 → accept 410 且请求保持 pending', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const token = await seed(db, raw, 'revoked');
  const r = await handleRespondSigning(db, 1, { accept: true }, reqOf(token));
  assert.equal(r.status, 410);
  assert.equal(raw.prepare('SELECT status FROM signing_requests WHERE id=1').get().status, 'pending');
});

test('拒绝签约不依赖需求状态：需求已成交时拒绝仍放行', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const token = await seed(db, raw, 'contracted');
  const r = await handleRespondSigning(db, 1, { accept: false }, reqOf(token));
  assert.equal(r.status, 200, '拒绝不契约需求，无需需求守卫');
  assert.equal(raw.prepare('SELECT status FROM signing_requests WHERE id=1').get().status, 'rejected');
});
