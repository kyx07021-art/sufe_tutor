/**
 * V-1-5 路由契约：声明式路由表完整性 + routeApi 代表路径内存冒烟。
 * 不访问网络；D1 用 node:sqlite shim。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { routes } from '../src/server/app.js';
import { initDb } from '../src/server/core/db.js';
import { hashPassword } from '../src/server/core/crypto.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { routeApi } from '../_worker.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'admin-pass-123' };
const origFetch = globalThis.fetch;

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

const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON');
const db = d1Shim(raw);
let tokens = {};

async function seedUser(username, password, role) {
  const { hash, salt } = await hashPassword(password);
  raw.prepare('INSERT INTO users (username,password_hash,salt,role) VALUES (?,?,?,?)').run(username, hash, salt, role);
}

before(async () => {
  await initDb(db, ENV);
  await seedUser('stu_smoke', 'pass123456', 'student');
  await seedUser('tea_smoke', 'pass123456', 'teacher');
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) });
});

after(() => {
  bindTextAuditEnv(null);
  globalThis.fetch = origFetch;
});

async function call(method, path, body = null, token = null) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (token) headers.set('X-Auth-Token', token);
  return routeApi(db, path, method, body, new URL(`http://x${path}`), { headers }, ENV);
}

test('路由表：113 条、method+path 唯一、关键路径字面量齐全', () => {
  assert.equal(routes.length, 113, '迁移后路由数 113');
  const keys = new Set(routes.map(r => `${r.method} ${r.path}`));
  assert.equal(keys.size, routes.length, 'method+path 唯一');
  const required = [
    ['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['GET', '/api/teachers'],
    ['GET', '/api/teacher/profile'], ['POST', '/api/student/demands'], ['POST', '/api/demands/:id/intents'],
    ['GET', '/api/conversations'], ['GET', '/api/conversations/:id/messages'], ['POST', '/api/contracts'],
    ['GET', '/api/reviews'], ['POST', '/api/feedbacks'], ['POST', '/api/complaints'],
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/content'], ['GET', '/api/data-version'],
    ['POST', '/api/captcha/verify'],
  ];
  for (const [method, path] of required) {
    assert.ok(keys.has(`${method} ${path}`), `关键路径缺失 ${method} ${path}`);
  }
});

test('routeApi 代表路径内存冒烟：认证/读列表/写反馈/管理端/健康', async () => {
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');

  const studentLogin = await call('POST', '/api/auth/login', { identifier: 'stu_smoke', password: 'pass123456' });
  assert.equal(studentLogin.status, 200);
  tokens.student = (await studentLogin.json()).authToken;

  const teacherLogin = await call('POST', '/api/auth/login', { identifier: 'tea_smoke', password: 'pass123456' });
  assert.equal(teacherLogin.status, 200);
  tokens.teacher = (await teacherLogin.json()).authToken;

  const adminLogin = await call('POST', '/api/auth/login', { identifier: 'admin_sufe', password: 'admin-pass-123' });
  assert.equal(adminLogin.status, 200);
  tokens.admin = (await adminLogin.json()).authToken;

  const teachers = await call('GET', '/api/teachers');
  assert.equal(teachers.status, 200);
  assert.ok(Array.isArray((await teachers.json()).teachers));

  const demandBody = { demand: { province: 'shanghai', student_grade: 'senior1', student_gender: 'female', target_subjects: ['math'], current_scores: [], teaching_method: 'online', address: '', submitter_type: 'self', parent_contact: '', student_contact: '', additional_info: '希望周末上课' } };
  const demand = await call('POST', '/api/student/demands', demandBody, tokens.student);
  assert.equal(demand.status, 200, '发需求');
  const demandId = (await demand.json()).demand?.id || 1;

  const intents = await call('POST', `/api/demands/${demandId}/intents`, { message: 'test' }, tokens.teacher);
  assert.ok([200, 403].includes(intents.status), '意向路径可达（未核验教师按门禁 403）');

  const convs = await call('GET', '/api/conversations', null, tokens.student);
  assert.equal(convs.status, 200);
  const contracts = await call('GET', '/api/contracts/my', null, tokens.student);
  assert.equal(contracts.status, 200);
  const reviews = await call('GET', '/api/reviews', null, tokens.student);
  assert.equal(reviews.status, 200);
  const posts = await call('GET', '/api/posts', null, tokens.student);
  assert.equal(posts.status, 200);
  const feedback = await call('POST', '/api/feedbacks', { kind: 'suggestion', title: 't', content: 'c' }, tokens.student);
  assert.equal(feedback.status, 201, '反馈写入');
  const myFeedback = await call('GET', '/api/feedbacks/mine', null, tokens.student);
  assert.equal(myFeedback.status, 200);
  const myComplaints = await call('GET', '/api/complaints/mine', null, tokens.student);
  assert.equal(myComplaints.status, 200);
  const notifications = await call('GET', '/api/notifications', null, tokens.student);
  assert.equal(notifications.status, 200);
  const dataVersion = await call('GET', '/api/data-version');
  assert.equal(dataVersion.status, 200);
  const stats = await call('GET', '/api/admin/stats', null, tokens.admin);
  assert.equal(stats.status, 200);
  const dashboard = await call('GET', '/api/admin/dashboard', null, tokens.admin);
  assert.equal(dashboard.status, 200);
  const content = await call('GET', '/api/admin/content', null, tokens.admin);
  assert.equal(content.status, 200);
  const captcha = await call('POST', '/api/captcha/verify', { captchaId: 'x', offset: 0.5, track: Array.from({ length: 40 }, (_, i) => ({ t: i, x: i * 5, y: 0 })) });
  assert.equal(captcha.status, 403, '机器轨迹被拒');
});
