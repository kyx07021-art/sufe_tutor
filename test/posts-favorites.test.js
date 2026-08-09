/**
 * R23（v0.25.87）：资料共享区收藏功能
 *
 * 服务端：
 *   - POST /api/posts/:id/favorite 切换收藏（登录；帖子不存在 404）；
 *   - GET /api/posts/favorites/mine 仅本人收藏、按收藏时间倒序、作者名 JOIN；
 *   - 列表接口凭令牌产出 favorited 布尔；注销清理 post_favorites；
 * 前端：
 *   - 卡片/详情渲染收藏 pill（checkbox checked 随 p.favorited，CSS :has 单源）；
 *   - toggle 调收藏接口、文案随状态切换；
 *   - 我的收藏视图取消收藏就地移除卡；视图切换走 favorites/mine 接口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';
import { handleToggleFavorite, handleMyFavorites, handleListPosts } from '../server/routes-posts.js';
import { dbPurgeUserOwnedData } from '../server/db.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('tea1','h','s','teacher'),('tea2','h','s','teacher')`);
  const mk = async (name) => {
    const u = raw.prepare('SELECT id FROM users WHERE username=?').get(name);
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), u.id, `sess-${name}`, '2099-01-01 00:00:00');
    return { id: u.id, token };
  };
  const t1 = await mk('tea1'), t2 = await mk('tea2');
  raw.prepare("INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', '讲义一', 'A')").run(t1.id);
  raw.prepare("INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', '讲义二', 'B')").run(t2.id);
  raw.prepare("INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', '讲义三', 'C')").run(t1.id);
  const ids = raw.prepare('SELECT id FROM posts ORDER BY id').all().map(r => r.id);
  return { t1, t2, postIds: ids };
}

test('R23 收藏切换：登录可收藏/取消；帖子不存在 404；未登录 401', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, t2, postIds } = await seed(db, raw);
  const r1 = await handleToggleFavorite(db, postIds[0], {}, reqOf(t1.token));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).favorited, true, '首次收藏');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM post_favorites').get().c, 1);
  const r2 = await handleToggleFavorite(db, postIds[0], {}, reqOf(t1.token));
  assert.equal((await r2.json()).favorited, false, '再点取消收藏');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM post_favorites').get().c, 0, 'UNIQUE 防重，取消即删');
  assert.equal((await handleToggleFavorite(db, 9999, {}, reqOf(t1.token))).status, 404, '帖子不存在');
  assert.equal((await handleToggleFavorite(db, postIds[0], {}, reqOf('bad-token'))).status, 401, '未登录被拒');
  // 他人收藏互不影响（各自 UNIQUE(post_id,user_id) 行）
  await handleToggleFavorite(db, postIds[1], {}, reqOf(t1.token));
  await handleToggleFavorite(db, postIds[1], {}, reqOf(t2.token));
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM post_favorites').get().c, 2, '同一帖两人各存一行');
});

test('R23 我的收藏：仅本人、按收藏时间倒序、作者名 JOIN、favorited 恒真', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, t2, postIds } = await seed(db, raw);
  // t1 收藏 三、一（顺序 一→三），t2 收藏 二
  await handleToggleFavorite(db, postIds[0], {}, reqOf(t1.token)); // 讲义一
  await handleToggleFavorite(db, postIds[2], {}, reqOf(t1.token)); // 讲义三
  await handleToggleFavorite(db, postIds[1], {}, reqOf(t2.token)); // 讲义二
  const mine = await handleMyFavorites(db, reqOf(t1.token));
  const list = (await mine.json()).posts;
  assert.equal(list.length, 2, '仅本人收藏');
  assert.equal(list[0].title, '讲义三', '按收藏时间倒序（后收藏在前）');
  assert.equal(list[1].title, '讲义一');
  assert.equal(list[0].username, 'tea1', '作者名 JOIN');
  assert.equal(list[0].favorited, true, '收藏视图 favorited 恒真');
  const other = await handleMyFavorites(db, reqOf(t2.token));
  assert.equal((await other.json()).posts.length, 1, 't2 只见自己的');
});

test('R23 列表接口凭令牌产出 favorited；注销清理收藏', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, postIds } = await seed(db, raw);
  await handleToggleFavorite(db, postIds[0], {}, reqOf(t1.token));
  const withViewer = await handleListPosts(db, new URL('http://x/api/posts'), reqOf(t1.token));
  const posts = (await withViewer.json()).posts;
  const fav = posts.find(p => p.id === postIds[0]);
  assert.equal(fav.favorited, true, '列表凭令牌回 favorited');
  assert.equal(posts.find(p => p.id === postIds[1]).favorited, false, '未收藏恒 false');
  // 注销：post_favorites 连带清理（posts 本身删除 → CASCADE）
  await dbPurgeUserOwnedData(db, t1.id, 'teacher');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM post_favorites WHERE user_id=?').get(t1.id).c, 0, '注销清理本人收藏');
});

// ==================== 前端 ====================
function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="posts-content"></div><div id="posts-list"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage, sessionStorage: w.sessionStorage,
      console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}
function loadCommon(ctx) {
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-posts.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
}

test('R23 收藏渲染：书签 checkbox checked 随 p.favorited，卡片守卫含 .post-fav，CSS :has 单源', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [];
  `, ctx);
  const html = vm.runInContext(`renderPostCard({ id: 9, user_id: 39, username: '学生A', title: '讲义', body_md: '内容', created_at: '2026-08-07 04:27:09', liked: false, like_count: 1, favorited: true }, 0)`, ctx);
  assert.ok(html.includes('post-fav glass'), '渲染收藏 pill');
  assert.ok(/<input type="checkbox" checked /.test(html), 'favorited=true → input checked');
  assert.ok(html.includes('已收藏'), '已收藏文案');
  const html2 = vm.runInContext(`renderPostCard({ id: 10, user_id: 39, username: '学生A', title: '讲义2', body_md: 'x', created_at: '2026-08-07 04:27:10', liked: false, like_count: 0, favorited: false }, 0)`, ctx);
  assert.ok(!/<input type="checkbox" checked/.test(html2), '未收藏无 checked');
  assert.ok(html2.includes('收藏'), '未收藏文案');
  const src = readFileSync('./app-posts.js', 'utf8');
  assert.ok(src.includes(".closest('.post-like, .post-fav, .post-del')"), '卡片点击守卫含 .post-fav');
  assert.ok(readFileSync('./glass.css', 'utf8').includes('.post-fav:has(input:checked)'), 'glass.css 收藏态走 :has');
});

test('R23 收藏成功：调 /api/posts/:id/favorite，checked 以服务端收敛、文案随动', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async (url) => { lastFavCall = url; return { favorited: true }; };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsView = 'all'; postsList = [{ id: 9, favorited: false }];
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-fav glass" data-id="9"><input type="checkbox" aria-label="收藏" onchange="togglePostFavorite(9, this)"><span class="fav-label">收藏</span></label>`;
  const box = dom.window.document.querySelector('.post-fav input');
  box.checked = true; // 模拟原生翻转
  await vm.runInContext('togglePostFavorite(9, document.querySelector(".post-fav input"))', ctx);
  assert.equal(vm.runInContext('lastFavCall', ctx), '/api/posts/9/favorite', '调收藏接口');
  assert.equal(box.checked, true, '服务端 favorited=true → checked 保持');
  assert.equal(dom.window.document.querySelector('.fav-label').textContent, '已收藏', '文案随状态');
});

test('R23 我的收藏视图：取消收藏就地移除卡；视图切换走 favorites/mine 接口', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async (url) => { lastFavCall = url; return { favorited: false }; };
    dhGet = async (url) => { lastDhCall = url; return { posts: [] }; };
    loadInto = async (elId, fetcher) => { await fetcher(); }; // 轻量 ctx 无 app-shell：仅执行 fetcher 记录接口
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsView = 'fav'; postsList = [{ id: 9, favorited: true }];
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<div class="post-card glass"><label class="post-fav glass" data-id="9"><input type="checkbox" checked aria-label="收藏" onchange="togglePostFavorite(9, this)"><span class="fav-label">已收藏</span></label></div>`;
  const box = dom.window.document.querySelector('.post-fav input');
  box.checked = false; // 模拟原生翻转（取消收藏）
  await vm.runInContext('togglePostFavorite(9, document.querySelector(".post-fav input"))', ctx);
  assert.equal(vm.runInContext('lastFavCall', ctx), '/api/posts/9/favorite', '调收藏接口');
  assert.equal(dom.window.document.querySelectorAll('#posts-list .post-card').length, 0, '我的收藏视图取消收藏就地移除卡');
  // 视图切换（M7：切卡改 toggle 按钮）：togglePostsFav → 清搜索框 + loadPosts 走 favorites/mine
  dom.window.document.getElementById('posts-content').innerHTML =
    `<div class="posts-toolbar glass">
      <button type="button" class="btn btn-sm posts-fav-btn" id="posts-fav-btn" onclick="togglePostsFav()">我的收藏</button>
      <input type="search" id="posts-search" value="旧值">
    </div><div id="posts-list"></div>`;
  await vm.runInContext(`postsView = 'all'; togglePostsFav(); loadPosts()`, ctx); // 重置到 all 再 toggle 进 fav
  assert.equal(vm.runInContext('lastDhCall', ctx), '/api/posts/favorites/mine', '收藏视图走独立接口');
  assert.equal(dom.window.document.getElementById('posts-search').value, '', '切视图清空搜索框');
  assert.equal(dom.window.document.getElementById('posts-fav-btn').textContent, globalThis.APP_CONSTANTS.UI.POSTS_FAV_ACTIVE, '进入收藏态按钮显示「√ 已进入我的收藏」');
  await vm.runInContext(`togglePostsFav(); loadPosts()`, ctx);
  assert.equal(dom.window.document.getElementById('posts-fav-btn').textContent, globalThis.APP_CONSTANTS.UI.POSTS_VIEW_FAV, '再点回全部态按钮文案恢复');
});
