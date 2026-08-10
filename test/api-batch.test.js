/**
 * B2/F2（v0.27.0 网络层重构）—— POST /api/batch 批量只读端点回归
 *
 * 覆盖：
 *   - 基本批量：{gets:[...]} → results 逐 path 返回 {status, data}（公开 + 需鉴权混合）
 *   - 单子请求失败不阻断其余（私有端点无令牌 401，公开端点照常 200）
 *   - 匿名公开列表子请求命中边缘缓存（零 D1）
 *   - 参数校验：空/超上限/非 /api/ 路径 → 400
 *   - 鉴权批量：带令牌子请求正常取数（authUser 经请求记忆化共享 1 次 D1）
 *   - 批量请求体拒绝写方法（gets 只读语义——服务端不接收 method 字段，天然只读）
 *
 * D1 形状：db.prepare(sql).bind(...).all()/.first()/.run() + db.batch([...])（同 worker-public-cache.test.js shim）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import worker from '../_worker.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function makeShim(raw, calls) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { calls.push('all:' + st._sql.slice(0, 30)); return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { calls.push('first:' + st._sql.slice(0, 30)); return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { calls.push('run:' + st._sql.slice(0, 30)); const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
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

const mockAssets = () => ({ async fetch() { return new Response('Not Found', { status: 404 }); } });

let cacheStore;
function installCache() {
  cacheStore = new Map();
  globalThis.caches = {
    default: {
      async match(req) { const t = cacheStore.get(String(req.url)); return t != null ? new Response(t, { status: 200, headers: { 'content-type': 'application/json' } }) : null; },
      async put(req, res) { cacheStore.set(String(req.url), await res.clone().text()); },
    },
  };
}
const ctx = { waitUntil: async fn => { const r = typeof fn === 'function' ? fn() : fn; if (r && typeof r.then === 'function') await r; } };

async function setup(t) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const calls = [];
  const shim = makeShim(raw, calls);
  const env = { ASSETS: mockAssets(), DB: shim, LOG_DB: shim, LEDGER_DB: shim, ADMIN_USERNAMES: ENV.ADMIN_USERNAMES, ADMIN_DEFAULT_PASSWORD: ENV.ADMIN_DEFAULT_PASSWORD };
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  await initDb(shim, env);
  // 预置：一个教师（公开列表可见）
  await shim.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('qa_t', 'x', 'salt', 'teacher')`).run();
  const tid = raw.prepare('SELECT id FROM users WHERE username=?').get('qa_t').id;
  await shim.prepare(`INSERT INTO teacher_profiles (user_id, subjects, price) VALUES (?, '数学', 150)`).run(tid);
  // 预置：一个学生 + 有效会话令牌（鉴权批量用）
  await shim.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('qa_s', 'x', 'salt', 'student')`).run();
  const sid = raw.prepare('SELECT id FROM users WHERE username=?').get('qa_s').id;
  const token = 'batch-test-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const exp = new Date(Date.now() + 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  await shim.prepare(`INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`).run(sid, tokenHash, exp);
  return { raw, env, calls, sid };
}

test('基本批量：公开 + 私有混合子请求逐 path 返回 status/data', async (t) => {
  const { env } = await setup(t);
  const res = await worker.fetch(new Request('https://test.local/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gets: ['/api/teachers', '/api/notifications'] }),
  }), env, ctx);
  assert.equal(res.status, 200);
  const { results } = JSON.parse(await res.text());
  assert.equal(results.length, 2);
  const byPath = Object.fromEntries(results.map(r => [r.path, r]));
  assert.equal(byPath['/api/teachers'].status, 200, '公开教师列表 200');
  assert.ok(Array.isArray(byPath['/api/teachers'].data.teachers), '教师数据数组');
  assert.equal(byPath['/api/notifications'].status, 401, '无令牌私有端点 401（单子请求失败不阻断其余）');
});

test('鉴权批量：带令牌子请求正常取数', async (t) => {
  const { env, sid } = await setup(t);
  // 给学生发一条通知，供鉴权子请求取到
  await env.DB.prepare(`INSERT INTO notifications (user_id, text) VALUES (?, '测试通知')`).run(sid);
  const res = await worker.fetch(new Request('https://test.local/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Auth-Token': 'batch-test-token' },
    body: JSON.stringify({ gets: ['/api/notifications', '/api/student/demands?scope=mine'] }),
  }), env, ctx);
  assert.equal(res.status, 200);
  const { results } = JSON.parse(await res.text());
  const byPath = Object.fromEntries(results.map(r => [r.path, r]));
  assert.equal(byPath['/api/notifications'].status, 200, '带令牌通知 200');
  assert.ok(Array.isArray(byPath['/api/notifications'].data.notifications), '通知数组');
  assert.equal(byPath['/api/notifications'].data.notifications[0].text, '测试通知');
  assert.equal(byPath['/api/student/demands?scope=mine'].status, 200, '带令牌我的需求 200');
});

test('匿名公开列表子请求命中边缘缓存（零 D1 直返）', async (t) => {
  installCache();
  const { env, calls } = await setup(t);
  // 先预热公开列表边缘缓存
  await worker.fetch(new Request('https://test.local/api/teachers'), env, ctx);
  assert.ok(cacheStore.has('https://test.local/api/teachers'), '公开列表已写边缘缓存');
  const callsBefore = calls.length;
  const res = await worker.fetch(new Request('https://test.local/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gets: ['/api/teachers'] }), // 仅已预热键，验证子请求命中缓存零 D1
  }), env, ctx);
  assert.equal(res.status, 200);
  const { results } = JSON.parse(await res.text());
  const teachers = results.find(r => r.path === '/api/teachers');
  assert.equal(teachers.status, 200, '教师子请求 200（边缘缓存命中）');
  assert.ok(Array.isArray(teachers.data.teachers), '缓存数据');
  assert.equal(calls.length, callsBefore, '公开列表子请求命中缓存零 D1');
});

test('参数校验：空/非 /api/ 路径/超上限 → 400', async (t) => {
  const { env } = await setup(t);
  const post = (body) => worker.fetch(new Request('https://test.local/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx);
  assert.equal((await post({ gets: [] })).status, 400, '空 gets 拒绝');
  assert.equal((await post({ gets: 'x' })).status, 400, '非数组拒绝');
  assert.equal((await post({ gets: ['https://evil.com/x'] })).status, 400, '外域路径拒绝');
  assert.equal((await post({ gets: ['/api/teachers', '//evil'] })).status, 400, '协议相对路径拒绝');
  const tooMany = { gets: Array.from({ length: 17 }, (_, i) => `/api/posts?i=${i}`) };
  assert.equal((await post(tooMany)).status, 400, '超批量上限拒绝');
});

test('批量请求体不接写方法：子请求恒 GET 语义（服务端只读）', async (t) => {
  const { env } = await setup(t);
  const res = await worker.fetch(new Request('https://test.local/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gets: ['/api/notifications/3/read'] }),
  }), env, ctx);
  const { results } = JSON.parse(await res.text());
  // 子路径按 GET 路由（单条已读是 POST 路由 → GET 404），证明批量子请求只走 GET 路由面
  assert.equal(results[0].status, 404, '写方法路径经 GET 面不存在 → 404（防批量伪装写）');
});
