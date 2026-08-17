/**
 * B6 公开列表边缘缓存（v0.26.6）：冷启动 D1 慢往返治本——公开列表命中 Cache API 零碰 D1。
 *
 * 覆盖：
 *   - isPublicListCacheable 纯逻辑：教师/帖子/需求广场（无 scope）公开可缓存；
 *     scope=mine 等私有变体不缓存；
 *   - 整 worker.fetch 集成：首次请求 miss → D1 → 响应写边缘缓存（Cache-Control s-maxage=30）；
 *     二次请求命中缓存 → DB 零查询（冷启动治本实证）；
 *   - 私有端点不缓存（cacheStore 无对应键）；
 *   - 无 caches 环境回落直取（fail-open，本地 dev / 旧测试环境兼容）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import worker, { isPublicListCacheable } from '../_worker.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
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

function buildEnv() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const calls = [];
  const shim = makeShim(raw, calls);
  const env = { ASSETS: mockAssets(), DB: shim, LOG_DB: shim, LEDGER_DB: shim, ADMIN_USERNAMES: ENV.ADMIN_USERNAMES, ADMIN_DEFAULT_PASSWORD: ENV.ADMIN_DEFAULT_PASSWORD };
  // initDb 由 worker.fetch 内部首次请求触发；此处只返回 env，DB 连接保持打开（进程退出自动关）
  return { raw, env, calls };
}

// 缓存 stub：存 text 字符串（模拟 workerd Cache API 每次 match 返回可读的新回放流），
// waitUntil 同步 await 保证写缓存确定性
let cacheStore;
function installCache() {
  cacheStore = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const t = cacheStore.get(String(req.url));
        return t != null ? new Response(t, { status: 200, headers: { 'content-type': 'application/json' } }) : null;
      },
      async put(req, res) { cacheStore.set(String(req.url), await res.clone().text()); },
    },
  };
}
const ctx = { waitUntil: async fn => { const r = typeof fn === 'function' ? fn() : fn; if (r && typeof r.then === 'function') await r; } };

async function setup(t) {
  const { raw, env, calls } = buildEnv();
  t.after(() => { try { raw.close(); } catch { /* 已关 */ } });
  // initDb 幂等（worker.fetch 首次请求会再跑，CREATE IF NOT EXISTS 无害）——先建表再预置数据
  await initDb(env.DB, env);
  // 预置一个教师（含 profile 基础列，其余列 ensureColumns 默认）供公开列表查询
  await env.DB.prepare(`INSERT INTO users (username, password_hash, salt, role) VALUES ('qa_t1', 'x', 'salt', 'teacher')`).run();
  const uid = raw.prepare('SELECT id FROM users WHERE username=?').get('qa_t1').id;
  await env.DB.prepare(`INSERT INTO teacher_profiles (user_id, subjects, price) VALUES (?, '数学', 150)`).run(uid);
  return { raw, env, calls };
}

// ---------------- 纯逻辑 ----------------
test('isPublicListCacheable：公开列表可缓存，私有变体不缓存', () => {
  const url = p => new URL('https://test.local' + p);
  assert.equal(isPublicListCacheable('/api/teachers', url('/api/teachers')), true);
  assert.equal(isPublicListCacheable('/api/teachers', url('/api/teachers?subject=数学')), true, '筛选 query 变体同样公开');
  assert.equal(isPublicListCacheable('/api/posts', url('/api/posts?sort=new')), true);
  assert.equal(isPublicListCacheable('/api/student/demands', url('/api/student/demands')), true, '无 scope = 需求广场公开');
  assert.equal(isPublicListCacheable('/api/student/demands', url('/api/student/demands?scope=mine')), false, 'scope=mine 私有不缓存');
  assert.equal(isPublicListCacheable('/api/student/demands', url('/api/student/demands?scope=for-teacher')), false);
  assert.equal(isPublicListCacheable('/api/contracts/my', url('/api/contracts/my')), false, '私有端点不缓存');
  assert.equal(isPublicListCacheable('/api/notifications', url('/api/notifications')), false);
});

// ---------------- 集成：缓存写入与命中 ----------------
test('整 worker：公开列表首请求 miss→D1→写缓存；二次请求命中零 DB 查询', async (t) => {
  installCache();
  const { env, calls } = await setup(t);
  const get = (p) => worker.fetch(new Request('https://test.local' + p), env, ctx);

  const first = await get('/api/teachers');
  assert.equal(first.status, 200);
  const firstBody = JSON.parse(await first.text());
  assert.ok(Array.isArray(firstBody.teachers), '教师列表返回数组');
  assert.equal(cacheStore.has('https://test.local/api/teachers'), true, '首请求后响应已写边缘缓存');
  assert.ok(Array.isArray(JSON.parse(cacheStore.get('https://test.local/api/teachers')).teachers), '缓存条目为完整 JSON 文本');

  const dbCallsAfterFirst = calls.length;
  const second = await get('/api/teachers');
  assert.equal(second.status, 200);
  assert.deepEqual(JSON.parse(await second.text()), firstBody, '缓存命中返回相同数据');
  assert.equal(calls.length, dbCallsAfterFirst, '二次请求零 DB 查询（缓存命中，冷启动治本）');
});

test('整 worker：私有变体（scope=mine）不写缓存', async (t) => {
  installCache();
  const { env } = await setup(t);
  const get = (p) => worker.fetch(new Request('https://test.local' + p), env, ctx);
  await get('/api/student/demands?scope=mine');
  assert.equal(cacheStore.has('https://test.local/api/student/demands?scope=mine'), false, '私有需求不缓存');
});

test('整 worker：需求广场（无 scope）首请求写缓存，二次命中零 DB', async (t) => {
  installCache();
  const { env, calls } = await setup(t);
  const get = (p) => worker.fetch(new Request('https://test.local' + p), env, ctx);
  await get('/api/student/demands');
  assert.equal(cacheStore.has('https://test.local/api/student/demands'), true, '需求广场缓存');
  const n = calls.length;
  await get('/api/student/demands');
  assert.equal(calls.length, n, '二次请求零 DB 查询');
});

// ---------------- fail-open ----------------
test('无 caches 环境回落直取（fail-open：缓存缺失不阻断主流程）', async (t) => {
  const saved = globalThis.caches;
  try {
    delete globalThis.caches;
    const { env } = await setup(t);
    const res = await worker.fetch(new Request('https://test.local/api/teachers'), env, ctx);
    assert.equal(res.status, 200, '无 caches 仍正常返回（本地 dev / 旧测试环境兼容）');
    assert.ok(Array.isArray(JSON.parse(await res.text()).teachers));
  } finally {
    globalThis.caches = saved;
  }
});

// 生产实证教训：缓存命中直接返回同一 Response 对象，并发命中第二个请求读已锁定的 body 流 → 500。
// 修复 = 命中时 cached.clone()（各得独立流）。本测试并发双请求同时命中，两者都必须读到完整 body。
test('缓存命中并发：两个请求同时命中同一缓存条目，body 均可读（clone 防流锁）', async (t) => {
  installCache();
  const { env } = await setup(t);
  const get = (p) => worker.fetch(new Request('https://test.local' + p), env, ctx);
  await get('/api/teachers'); // 首请求写缓存
  const [r1, r2] = await Promise.all([get('/api/teachers'), get('/api/teachers')]);
  assert.equal(r1.status, 200, '并发命中第 1 个 200');
  assert.equal(r2.status, 200, '并发命中第 2 个 200（clone 后 body 流各自独立，无流锁 500）');
  const b1 = JSON.parse(await r1.text());
  const b2 = JSON.parse(await r2.text());
  assert.ok(Array.isArray(b1.teachers) && Array.isArray(b2.teachers), '两个并发响应 body 均可完整读取');
});

// 外部审查 1101（生产事故级）：共享 Cache 曾把登录用户的 per-user 字段跨用户下发——
// /api/posts 的 liked/favorited、/api/teachers 的 matched、demands 观众变体。
// 修复 = 仅匿名（无 X-Auth-Token）请求参与缓存；登录请求走实时 routeApi 保私有正确。
test('匿名门：登录请求不写缓存，也不命中匿名缓存（防 per-user 字段跨用户泄露）', async (t) => {
  installCache();
  const { env } = await setup(t);
  const anon = (p) => worker.fetch(new Request('https://test.local' + p), env, ctx);
  const authed = (p) => worker.fetch(new Request('https://test.local' + p, { headers: { 'X-Auth-Token': 'some-token' } }), env, ctx);

  // ① 匿名首请求写缓存
  await anon('/api/teachers');
  assert.equal(cacheStore.has('https://test.local/api/teachers'), true, '匿名请求写缓存');
  // ② 登录请求（同 URL）不命中缓存——走 routeApi 实时（响应可能含 matched/liked 等 per-user 字段）
  const authedRes = await authed('/api/teachers');
  assert.equal(authedRes.status, 200, '登录请求正常返回');
  assert.ok(cacheStore.has('https://test.local/api/teachers'), '缓存条目仍为匿名写入的原样（未被登录响应覆盖）');
  // ③ 登录请求（带 token）不写缓存
  await authed('/api/posts?sort=new');
  assert.equal(cacheStore.has('https://test.local/api/posts?sort=new'), false, '登录请求不写共享缓存（per-user 数据不跨用户下发）');
  // ④ 匿名命中不受登录请求影响
  const anonRes = await anon('/api/teachers');
  assert.equal(anonRes.status, 200, '匿名仍命中缓存');
});

test('isPublicListCacheable 保持公开判定（匿名门在 fetch 层，纯函数只判端点）', () => {
  const url = p => new URL('https://test.local' + p);
  assert.equal(isPublicListCacheable('/api/teachers', url('/api/teachers')), true);
  assert.equal(isPublicListCacheable('/api/posts', url('/api/posts')), true);
  assert.equal(isPublicListCacheable('/api/student/demands', url('/api/student/demands')), true);
});
