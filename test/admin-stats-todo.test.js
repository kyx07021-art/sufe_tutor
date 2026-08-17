/**
 * v1.0.1 回归（生产 500 事故根因）：handleAdminStats 统计端点含 R3 待办计数（awardsPending/
 * feedbacksOpen/complaintsOpen）——dbGetCountWhere 曾漏 import（ReferenceError → 500，生产统计页
 * 「加载失败: 服务器内部错误（旧文案）」），本测试钉死全链路：清库后状态 + 待办计数非零 + 全字段形状。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleAdminStats, handleAdminDashboard } from '../server/routes-admin.js';
import { handleLogin } from '../server/routes-auth.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { requestOtp } from '../src/server/core/otp.js';
import { handleRegister } from '../server/routes-auth.js';
import { lastOtpCode } from './_otp-stub.js';
import { recordRequestMetric, flushMetrics } from '../server/telemetry.js'; // stub fetch 防真实发信（真实代码路径 + 捕获验证码）

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
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

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  return { raw, db };
}

test('统计端点：清库后状态 200 + 待办计数字段在位（import 断线回归）', async () => {
  const { raw, db } = await setup();
  const login = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const token = (await login.json()).authToken;
  const r = await handleAdminStats(db, new URL('http://x/api/admin/stats'), { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(r.status, 200, '清库后统计端点 200（曾 ReferenceError → 500）');
  const d = await r.json();
  assert.equal(typeof d.stats.users.total, 'number', 'users.total 数字');
  assert.equal(typeof d.stats.todo.awardsPending, 'number', '待办奖项计数在位');
  assert.equal(typeof d.stats.todo.feedbacksOpen, 'number', '待办反馈计数在位');
  assert.equal(typeof d.stats.todo.complaintsOpen, 'number', '待办投诉计数在位');
  assert.ok(Array.isArray(d.stats.recentUsers), '最近用户数组');
});

test('统计端点：有数据时待办计数非零', async () => {
  const { raw, db } = await setup();
  // 造一条待审奖项 + 一条开放反馈 + 一条开放投诉（教师注册+奖项直插/反馈直插）
  const target = '+8613911110001';
  const otp = await requestOtp(db, { channel: 'sms', target }, { headers: new Headers() });
  assert.ok(otp.ok);
  // v1.2.0 T4：教师注册须邀请码——测试预置一枚
  const adminId = (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first() || {}).id || 1;
  const invite = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?,?)').run(invite, adminId);
  const reg = await handleRegister(db, { username: 't_stats', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true, phone: target, otpChannel: 'sms', code: lastOtpCode(target), inviteCode: invite }, { headers: new Headers() });
  assert.equal(reg.status, 200);
  const tId = raw.prepare("SELECT id FROM users WHERE username='t_stats'").get().id;
  raw.prepare("INSERT INTO teacher_awards (teacher_user_id, title, status) VALUES (?, '奖项A', 'pending')").run(tId);
  raw.prepare("INSERT INTO feedbacks (user_id, kind, title, content, status) VALUES (?, 'suggestion', 't', 'c', 'open')").run(tId);
  raw.prepare("INSERT INTO complaints (user_id, reason, detail, status, target_type, target_id) VALUES (?, 'r', 'd', 'open', 'teacher', 999)").run(tId);

  const login = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const token = (await login.json()).authToken;
  const r = await handleAdminStats(db, new URL('http://x/api/admin/stats'), { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.stats.todo.awardsPending, 1, '待审奖项 = 1');
  assert.equal(d.stats.todo.feedbacksOpen, 1, '开放反馈 = 1');
  assert.equal(d.stats.todo.complaintsOpen, 1, '开放投诉 = 1');
});

test('v1.5.0 dashboard 端点：聚合指标 + 待办含核验队列 + 非管理员拒绝', async () => {
  const { raw, db } = await setup();
  recordRequestMetric({ path: '/api/teachers', status: 200, durationMs: 100 });
  recordRequestMetric({ path: '/api/auth/login', status: 429, rateLimited: true });
  await flushMetrics(db, true);
  const login = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const token = (await login.json()).authToken;
  const r = await handleAdminDashboard(db, new URL('http://x/api/admin/dashboard'), { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.dashboard.metrics.total.requests >= 2, '请求计数来自聚合表');
  assert.ok(d.dashboard.metrics.total.limited >= 1, '限流命中计数');
  assert.equal(typeof d.dashboard.todo.verificationsPending, 'number', '核验待办计数在位');
  assert.ok(Array.isArray(d.dashboard.metrics.topPaths), '高频路径数组');
  const anon = await handleAdminDashboard(db, new URL('http://x/api/admin/dashboard'), { headers: new Headers() });
  assert.equal(anon.status, 401, '无令牌拒绝');
});
