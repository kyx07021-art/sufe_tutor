/**
 * R23（v0.25.87）：资料共享区收藏功能
 *
 * 服务端：
 *   - POST /api/posts/:id/favorite 切换收藏（登录；帖子不存在 404）；
 *   - GET /api/posts/favorites/mine 仅本人收藏、按收藏时间倒序、作者名 JOIN；
 *   - 列表接口凭令牌产出 favorited 布尔；注销清理 post_favorites；
 * 前端（B4：直接 import posts feature ESM）：
 *   - 卡片/详情渲染收藏 pill（checkbox checked 随 p.favorited，CSS :has 单源）；
 *   - toggle 调收藏接口、文案随状态切换；
 *   - 我的收藏视图取消收藏就地移除卡；视图切换走 favorites/mine 接口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetPostFavoriteToggleRead, dbGetPostLikeToggleRead, dbTogglePostLike, dbCreatePostFavorite } from '../src/server/domains/posts/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleToggleFavorite, handleMyFavorites, handleListPosts, handleToggleLike } from '../src/server/domains/posts/api.js';
import { dbPurgeUserOwnedData } from '../src/server/domains/auth/repo.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { state } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { stopBadgePoll } from '../src/client/core/router.js';
import { CONFIG } from '../src/shared/config.js';
import { renderPostCard } from '../src/client/features/posts/render.js';
import { postsList, setPostsListForTest, togglePostFavorite, togglePostsFav } from '../src/client/features/posts/actions-list.js';
import { TEXT } from '../src/client/constants/text.js';

CONFIG.TOAST_MS = 10;
CONFIG.TOAST_FADE_MS = 1;

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

// ==================== 前端（B4：直接 import posts feature ESM） ====================
// v2 形态：postsList/postsView 是 actions-list 模块级（postsView 无 setter，用 togglePostsFav 切换）；
// ensureAuth 是 core/api 单源（setEnsureAuth 接线）；loadPosts 经 core/router loadInto 真渲染。

const SHELL_HTML = `<!doctype html><html><body>
  <div id="posts-content"></div>
  <div id="posts-list"></div>
  <div id="toast-container"></div>
</body></html>`;

function setup() {
  const dom = new JSDOM(SHELL_HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  state.authToken = null;
  setEnsureAuth(() => true);
  _dhResetForTests(); // 清 dhCache/版本基线，隔离各用例
  return dom;
}
function teardown() {
  stopBadgePoll();
  stopVersionProbe();
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
}
async function settle(ms = 30) { await new Promise(r => setTimeout(r, ms)); }

test('R23 收藏渲染：书签 checkbox checked 随 p.favorited，卡片守卫含 .post-fav，CSS :has 单源', () => {
  setup();
  setPostsListForTest([]);
  const html = renderPostCard({ id: 9, user_id: 39, username: '学生A', title: '讲义', body_md: '内容', created_at: '2026-08-07 04:27:09', liked: false, like_count: 1, favorited: true }, 0);
  assert.ok(html.includes('post-fav glass'), '渲染收藏 pill');
  assert.ok(/<input type="checkbox" checked /.test(html), 'favorited=true → input checked');
  assert.ok(html.includes(TEXT.BTN_FAVORITED), '已收藏文案');
  const html2 = renderPostCard({ id: 10, user_id: 39, username: '学生A', title: '讲义2', body_md: 'x', created_at: '2026-08-07 04:27:10', liked: false, like_count: 0, favorited: false }, 0);
  assert.ok(!/<input type="checkbox" checked/.test(html2), '未收藏无 checked');
  assert.ok(html2.includes(TEXT.BTN_FAVORITE), '未收藏文案');
  const src = readFileSync('./src/client/features/posts/index.js', 'utf8');
  assert.ok(src.includes(".closest('.post-like, .post-fav, .post-del')"), '卡片点击守卫含 .post-fav');
  assert.ok(readFileSync('./glass.css', 'utf8').includes('.post-fav:has(input:checked)'), 'glass.css 收藏态走 :has');
  teardown();
});

test('R23 收藏成功：调 /api/posts/:id/favorite，checked 以服务端收敛、文案随动', async () => {
  setup();
  setPostsListForTest([{ id: 9, favorited: false }]);
  let lastFavCall = '';
  globalThis.fetch = async (url) => { lastFavCall = String(url); return { ok: true, status: 200, json: async () => ({ favorited: true }) }; };
  document.getElementById('posts-list').innerHTML =
    `<label class="post-fav glass" data-id="9"><input type="checkbox" aria-label="收藏" data-posts-fav="9"><span class="fav-label">收藏</span></label>`;
  const box = document.querySelector('.post-fav input');
  box.checked = true; // 模拟原生翻转
  await togglePostFavorite(9, box);
  assert.equal(lastFavCall, '/api/posts/9/favorite', '调收藏接口');
  assert.equal(box.checked, true, '服务端 favorited=true → checked 保持');
  assert.equal(document.querySelector('.fav-label').textContent, TEXT.BTN_FAVORITED, '文案随状态');
  teardown();
});

test('R23 我的收藏视图：取消收藏就地移除卡；视图切换走 favorites/mine 接口', async () => {
  setup();
  setPostsListForTest([{ id: 9, favorited: true }]);
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes('/api/posts/favorites/mine') || u.includes('/api/posts?sort=')) return { ok: true, status: 200, json: async () => ({ posts: [] }) };
    return { ok: true, status: 200, json: async () => ({ favorited: false }) };
  };
  // 收藏视图 toolbar + 列表容器（v2 postsView 模块级无 setter，用 togglePostsFav 从 all 切入 fav）
  document.getElementById('posts-content').innerHTML =
    `<div class="posts-toolbar glass">
      <button type="button" class="btn btn-sm posts-fav-btn" id="posts-fav-btn">我的收藏</button>
      <input type="search" id="posts-search" value="旧值">
    </div>`;
  togglePostsFav(); // all → fav：清搜索框 + 按钮切文案 + loadPosts 走 favorites/mine
  await settle();
  assert.equal(document.getElementById('posts-search').value, '', '切视图清空搜索框');
  assert.equal(document.getElementById('posts-fav-btn').textContent, TEXT.POSTS_FAV_ACTIVE, '进入收藏态按钮显示「已进入我的收藏」');
  assert.ok(calls.some(u => u === '/api/posts/favorites/mine'), '收藏视图走独立接口');
  // 取消收藏就地移除卡
  document.getElementById('posts-list').innerHTML =
    `<div class="post-card glass"><label class="post-fav glass" data-id="9"><input type="checkbox" checked aria-label="已收藏" data-posts-fav="9"><span class="fav-label">已收藏</span></label></div>`;
  const box = document.querySelector('.post-fav input');
  box.checked = false; // 模拟原生翻转（取消收藏）
  await togglePostFavorite(9, box);
  assert.ok(calls.some(u => u === '/api/posts/9/favorite'), '调收藏接口');
  assert.equal(document.querySelectorAll('#posts-list .post-card').length, 0, '我的收藏视图取消收藏就地移除卡');
  // 再点回全部态
  togglePostsFav();
  await settle();
  assert.equal(document.getElementById('posts-fav-btn').textContent, TEXT.POSTS_VIEW_FAV, '再点回全部态按钮文案恢复');
  teardown();
});

// ==================== U10 网络层架构债（收藏/点赞延迟） ====================

test('U10 批量读写 helper：读批帖+本人记录一步取回；点赞写批同步计数', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1, postIds } = await seed(db, raw);
  // 读批：帖 + 本人收藏/点赞记录
  let s = await dbGetPostFavoriteToggleRead(db, postIds[0], t1.id);
  assert.equal(s.post.id, postIds[0], '读批返回帖');
  assert.equal(s.fav, null, '尚未收藏 → fav null');
  await dbCreatePostFavorite(db, postIds[0], t1.id);
  s = await dbGetPostFavoriteToggleRead(db, postIds[0], t1.id);
  const favRow = raw.prepare('SELECT id FROM post_favorites WHERE post_id=? AND user_id=?').get(postIds[0], t1.id);
  assert.equal(s.fav.id, favRow.id, '已收藏 → 读批带本人记录');
  // 点赞写批：insert + 计数同步 + 回读（一次 batch 出 likeCount）
  const r1 = await dbTogglePostLike(db, postIds[0], t1.id, null);
  assert.equal(r1.likeCount, 1, '首次点赞计数 1');
  const likeId = raw.prepare('SELECT id FROM post_likes WHERE post_id=? AND user_id=?').get(postIds[0], t1.id).id;
  const r2 = await dbTogglePostLike(db, postIds[0], t1.id, likeId);
  assert.equal(r2.likeCount, 0, '取消点赞计数回 0');
  // 路由经批路径行为不变
  const r3 = await handleToggleLike(db, postIds[0], {}, reqOf(t1.token));
  assert.equal(r3.status, 200);
  assert.equal((await r3.json()).likeCount, 1, 'handleToggleLike 走批路径计数正确');
  const r4 = await handleToggleFavorite(db, postIds[0], {}, reqOf(t1.token));
  assert.equal((await r4.json()).favorited, false, 'handleToggleFavorite 走批路径取消收藏');
});

test('U10 收藏乐观反馈：toast/文案立即（不等服务端）；成功后服务端收敛', async () => {
  setup();
  setPostsListForTest([{ id: 9, favorited: false }]);
  let resolveApi = null;
  globalThis.fetch = () => new Promise(res => { resolveApi = () => res({ ok: true, status: 200, json: async () => ({ favorited: true }) }); });
  document.getElementById('posts-list').innerHTML =
    `<label class="post-fav glass" data-id="9"><input type="checkbox" aria-label="收藏" data-posts-fav="9"><span class="fav-label">收藏</span></label>`;
  const box = document.querySelector('.post-fav input');
  const label = document.querySelector('.fav-label');
  box.checked = true; // 原生翻转
  togglePostFavorite(9, box); // 不 await：同步段先行
  const toast = document.querySelector('#toast-container .toast');
  assert.ok(toast && toast.textContent.includes(TEXT.POST_FAVORITED_TOAST), 'toast 在服务端返回前立即弹出');
  assert.equal(label.textContent, TEXT.BTN_FAVORITED, '文案立即翻为「已收藏」（服务端未回）');
  assert.equal(postsList[0].favorited, true, '数据源立即更新');
  // 服务端 resolve → 收敛一致
  resolveApi();
  await settle(20);
  assert.equal(label.textContent, TEXT.BTN_FAVORITED, '服务端 favorited=true 收敛一致');
  teardown();
});

test('U10 收藏乐观失败：回滚文案/toast/数据到点前态', async () => {
  setup();
  setPostsListForTest([{ id: 9, favorited: true }]);
  globalThis.fetch = async () => { throw new Error('网络错误'); };
  document.getElementById('posts-list').innerHTML =
    `<label class="post-fav glass" data-id="9"><input type="checkbox" checked aria-label="已收藏" data-posts-fav="9"><span class="fav-label">已收藏</span></label>`;
  const box = document.querySelector('.post-fav input');
  const label = document.querySelector('.fav-label');
  box.checked = false; // 取消收藏：原生翻转
  await togglePostFavorite(9, box);
  assert.equal(box.checked, true, '失败回滚 checkbox 到点前态（已收藏）');
  assert.equal(label.textContent, TEXT.BTN_FAVORITED, '失败回滚文案到「已收藏」');
  assert.equal(postsList[0].favorited, true, '数据源回滚');
  teardown();
});
