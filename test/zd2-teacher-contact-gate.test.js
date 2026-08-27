/**
 * ZD-2（2026-08-26 休眠签约）：教师档案联系方式门控放宽守护测试。
 * 用户原话：「解除所有禁止在会话中发布联系方式的提醒，让用户自由沟通」。
 * 语义 = 联系方式（wechat/email）从「签约后（dbIsContracted）」放宽到「建立会话后（dbIsMatched）」——
 * 已建立会话的学生直接可见教师联系方式；未建立会话仍 403（陌生人防骚扰边界）。
 *
 * G2 变异守护：还原旧条件 `...(signed ? { wechat, email } : {})`（把 wechat/email 从响应移除）
 * → 本文件「会话学生可见 wechat/email」断言必红。
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
  // 教师档案：联系方式加密落库（真实形状，走 encryptField）
  raw.prepare('INSERT INTO teacher_profiles (user_id, grade, verified, wechat, email, real_name, subjects) VALUES (?,?,?,?,?,?,?)')
    .run(t, 'freshman', 1, await encryptField('wx_teacher'), await encryptField('teacher@example.com'), await encryptField('王老师'), '["math"]');
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

test('ZD-2 未建立会话的学生 → 403，联系方式不可见', async () => {
  const { db, t, s2Token } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(s2Token));
  assert.equal(r.status, 403, `非会话学生应 403（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.code, 'COMMON_NO_PERMISSION', `403 错误码应为 NO_PERMISSION（实测 ${body.code}）`);
});

test('ZD-2 已建立会话的学生 → 200 + wechat/email 可见（自由沟通）', async () => {
  const { db, t, s1Token } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(s1Token));
  assert.equal(r.status, 200, `会话学生应 200（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.wechat, 'wx_teacher', `会话学生应见 wechat（实测 ${body.profile.wechat}）`);
  assert.equal(body.profile.email, 'teacher@example.com', `会话学生应见 email`);
  assert.equal(body.profile.matched, true);
  assert.equal(body.profile.real_name, '王老师', `real_name 原本就对会话学生开放，不回归`);
});

test('ZD-2 教师本人 → 200 全字段', async () => {
  const { db, t, tToken } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(tToken));
  assert.equal(r.status, 200);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.wechat, 'wx_teacher');
});

// ZR-A1（2026-08-27）：管理员查看任意教师档案 = 管理/身份核验用途，全字段放行、不校验会话匹配。
// G2 变异：还原「admin 全字段放行」分支（改回仅本人/匹配学生可读）→ 本测试 admin 请求 403 断言必红。
test('ZR-A1 admin 查看任意教师档案 → 200 全字段（核验用途，无需会话）', async () => {
  const { db, t, aToken } = await seed();
  const r = await handleGetProfile(db, urlOf(t), reqOf(aToken));
  assert.equal(r.status, 200, `admin 应 200（实测 status=${r.status}）`);
  const body = JSON.parse(await r.text());
  assert.equal(body.profile.wechat, 'wx_teacher', 'admin 应见 wechat（身份核验用途）');
  assert.equal(body.profile.email, 'teacher@example.com', 'admin 应见 email');
  assert.equal(body.profile.real_name, '王老师', 'admin 应见 real_name');
  assert.equal(body.profile.matched, false, 'admin 分支不经 dbIsMatched（mapper 默认 false，不附加 true 语义）');
});
