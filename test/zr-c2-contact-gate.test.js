/**
 * ZR-C2（2026-08-27，用户②）：教师联系方式「只用于身份核验」——matched 分支收回守护测试。
 * 用户原话：「把联系方式从教师详情页上彻底删掉，现在只用于身份核验」。
 * 语义 = wechat/email/credential_image 仅 admin 全字段可见（核验用途，ZR-A1）；
 * 已建立会话的学生也只能取公开字段（覆盖 ZD-2「建立会话后开放」语义，文件前身
 * zd2-teacher-contact-gate.test.js 的放宽断言按新语义翻转）。
 *
 * G2 变异守护：还原 matched 返回 `{ ...publicPart, credential_image, wechat, email, signed, matched: true }`
 * → 本文件「会话学生零联系方式字段」断言必红；还原 admin 放行分支 → admin 用例 403 必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { handleGetProfile } from '../src/server/domains/teacher/api.js';
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
    ('teacher1','h','s','teacher'),('student1','h','s','student'),('student2','h','s','student')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const t = idOf('teacher1'), s1 = idOf('student1'), s2 = idOf('student2');
  // ZR-A1: admin_sufe 由 initDb seedAdmins（ADMIN_USERNAMES）播种，这里补会话 token 供 admin 请求
  const a = idOf('admin_sufe');
  // 教师档案：联系方式加密落库（真实形状，走 encryptField）；real_name ZR-B1 起明文公开列，明文直存
  raw.prepare('INSERT INTO teacher_profiles (user_id, grade, verified, wechat, email, real_name, subjects, credential_image) VALUES (?,?,?,?,?,?,?,?)')
    .run(t, 'freshman', 1, await encryptField('wx_teacher'), await encryptField('teacher@example.com'), '王老师', '["math"]', await encryptField('data:image/png;base64,CRED'));
  // 会话：仅 student1 ↔ teacher1（student2 未建立会话）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(s1, t, null);
  const mkToken = async name => {
    const token = `${name}-tok`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { db, t, s1, s2, a, tToken: await mkToken('teacher1'), s1Token: await mkToken('student1'), s2Token: await mkToken('student2'), aToken: await mkToken('admin_sufe') };
}

const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });
const urlOf = uid => new URL(`http://x/api/teacher/profile?userId=${uid}`);

test('ZR-C2 未建立会话的学生 → 403，任何字段不可见', async () => {
  const { db, t, s2Token } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(s2Token));
  assert.equal(r.status, 403, `非会话学生应 403（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.code, 'COMMON_NO_PERMISSION', `403 错误码应为 NO_PERMISSION（实测 ${body.code}）`);
});

test('ZR-C2 已建立会话的学生 → 200 公开字段，联系方式/凭证零下发', async () => {
  const { db, t, s1Token } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(s1Token));
  assert.equal(r.status, 200, `会话学生应 200（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.matched, true);
  assert.equal(body.profile.real_name, '王老师', 'real_name 公开字段不回归（ZR-B1/B2）');
  // ZR-C2 核心：联系方式/凭证只用于身份核验，会话学生也不下发
  assert.ok(!('wechat' in body.profile), 'wechat 字段不得下发（变异：还原 matched 返回 wechat → 红）');
  assert.ok(!('email' in body.profile), 'email 字段不得下发');
  assert.ok(!('credential_image' in body.profile), 'credential_image 凭证不得下发');
});

test('ZR-C2 教师本人 → 200 全字段（含联系方式，本人档案管理不受影响）', async () => {
  const { db, t, tToken } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(tToken));
  assert.equal(r.status, 200);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.wechat, 'wx_teacher');
});

// ZR-A1（2026-08-27）：管理员查看任意教师档案 = 管理/身份核验用途（用户②「只用于身份核验」），
// 全字段放行、不校验会话匹配——联系方式在核验侧保留可见。
test('ZR-A1+C2 admin 查看任意教师档案 → 200 全字段（核验用途，无需会话）', async () => {
  const { db, t, aToken } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(aToken));
  assert.equal(r.status, 200, `admin 应 200（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.wechat, 'wx_teacher', 'admin 应见 wechat（身份核验用途）');
  assert.equal(body.profile.email, 'teacher@example.com', 'admin 应见 email');
  assert.equal(body.profile.credential_image, 'data:image/png;base64,CRED', 'admin 应见 credential_image');
  assert.equal(body.profile.real_name, '王老师', 'admin 应见 real_name');
  assert.equal(body.profile.matched, false, 'admin 分支不经 dbIsMatched（mapper 默认 false，不附加 true 语义）');
});
