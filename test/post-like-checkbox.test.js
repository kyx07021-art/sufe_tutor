/**
 * #160（v0.25.68）：点赞按钮接复选框逻辑
 * 点赞 pill 由「button + .liked 类 + aria-pressed 手管」改为「label + 隐藏原生 checkbox」：
 *   - 渲染：input[type=checkbox] checked 随 p.liked，CSS :has(input:checked) 单源驱动 liked 视觉；
 *   - togglePostLike(id, input)：change 在原生翻转后触发，取反得点前态；
 *       成功以服务端 data.liked 收敛 checked + 计数；失败/访客回滚到点前态；
 *   - seq 守卫：过期响应不覆盖（乱序到达丢弃）、过期错误不回滚。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="posts-list"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
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

test('点赞渲染：隐藏原生 checkbox checked 随 p.liked，CSS 走 :has(input:checked) 单源', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async () => ({ liked: true, likeCount: 1 });
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [];
  `, ctx);
  const html = vm.runInContext(`renderPostCard({ id: 9, user_id: 39, username: '学生A', title: '讲义', body_md: '内容', created_at: '2026-08-07 04:27:09', liked: true, like_count: 3 }, 0)`, ctx);
  assert.ok(html.includes('post-like glass'), '渲染为 label.post-like');
  assert.ok(/<input type="checkbox" checked /.test(html), 'liked=true → input checked');
  assert.ok(!html.includes('aria-pressed='), '删 aria-pressed 属性（原生 checkbox 自带状态语义）');
  assert.ok(html.includes('like-count'), '计数渲染');
  const html2 = vm.runInContext(`renderPostCard({ id: 10, user_id: 39, username: '学生A', title: '讲义2', body_md: 'x', created_at: '2026-08-07 04:27:10', liked: false, like_count: 0 }, 0)`, ctx);
  assert.ok(/<input type="checkbox" aria-label/.test(html2), 'liked=false → 无 checked');
  // CSS :has 单源（.checkbox-item 同款依赖）：liked 视觉不再走 .liked 类
  const glassCss = readFileSync('./glass.css', 'utf8');
  const postsCss = readFileSync('./style-posts.css', 'utf8');
  assert.ok(glassCss.includes('.post-like:has(input:checked)'), 'glass.css liked 态走 :has');
  assert.ok(postsCss.includes('.post-like:has(input:checked) .like-icon'), 'style-posts.css 心形填充走 :has');
  assert.ok(!postsCss.includes('.post-like.liked'), '旧 .liked 类选择器连根删');
});

test('点赞成功：checked 以服务端 data.liked 收敛，计数随动', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async (url) => { lastCall = url; return { liked: true, likeCount: 4 }; };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true; // 模拟原生翻转（change 在翻转后触发）
  await vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx);
  assert.equal(vm.runInContext('lastCall', ctx), '/api/posts/9/like', '调点赞接口');
  assert.equal(box.checked, true, '服务端 liked=true → checked 保持 true');
  assert.equal(dom.window.document.querySelector('.like-count').textContent, '4', '计数更新');
});

test('点赞失败：回滚到点前态', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async () => { throw new Error('网络错误'); };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  // 点前态 false → 原生翻转 true → 失败应回滚 false
  box.checked = true;
  await vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx);
  assert.equal(box.checked, false, '失败回滚到点前态（未赞）');
  // 反向：点前态 true → 翻转 false → 失败应回滚 true
  box.checked = false;
  await vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx);
  assert.equal(box.checked, true, '失败回滚到点前态（已赞）');
});

test('点赞访客：ensureAuth 拦截并回滚原生翻转', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => false; // 访客
    api = async () => ({ liked: true, likeCount: 4 });
    state.user = null;
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true; // 访客点击：原生已翻转
  await vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx);
  assert.equal(box.checked, false, '访客点赞被拦截且回滚');
});

test('点赞 seq 守卫：过期响应不覆盖、过期错误不回滚', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const src = readFileSync('./app-posts.js', 'utf8');
  assert.ok(/postLikeSeq\[id\] !== seq\) return;[\s\S]*revert\(\)/.test(src), 'catch 分支先判 seq 再回滚');
  assert.ok(/postLikeSeq\[id\] !== seq\) return;[\s\S]*applyPostLikeState\(/.test(src), 'U10 成功分支同样 seq 丢弃（收敛前先判 seq）');
});

test('U10 点赞乐观反馈：toast/计数立即（不等服务端）；成功后收敛', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {};
    showToast = (m) => { (window.__toasts || (window.__toasts = [])).push(m); };
    ensureAuth = () => true;
    window.__resolveApi = null;
    api = () => new Promise(res => { window.__resolveApi = () => res({ liked: true, likeCount: 9 }); });
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [ { id: 9, liked: false, like_count: 8 } ];
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">8</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true; // 原生翻转
  vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx); // 不 await：同步段先行
  const UI = vm.runInContext('APP_CONSTANTS.UI', ctx);
  assert.ok(vm.runInContext('window.__toasts', ctx).includes(UI.POST_LIKED_TOAST), 'toast 在服务端返回前立即弹出');
  assert.equal(dom.window.document.querySelector('.like-count').textContent, '9', '计数乐观 +1（8→9，服务端未回）');
  assert.equal(box.checked, true, 'checkbox 保持目标态');
  // 服务端 resolve → 收敛一致
  await vm.runInContext('window.__resolveApi()', ctx);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(dom.window.document.querySelector('.like-count').textContent, '9', '服务端 likeCount=9 收敛一致');
  assert.equal(vm.runInContext('postsList[0].like_count', ctx), 9, '数据源同步');
});

test('U10 点赞乐观失败：回滚计数到点前态', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async () => { throw new Error('网络错误'); };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [ { id: 9, liked: true, like_count: 5 } ];
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" checked aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">5</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = false; // 取消赞：原生翻转
  await vm.runInContext('togglePostLike(9, document.querySelector(".post-like input"))', ctx);
  assert.equal(box.checked, true, '失败回滚 checkbox 到点前态（已赞）');
  assert.equal(dom.window.document.querySelector('.like-count').textContent, '5', '计数回滚');
  assert.equal(vm.runInContext('postsList[0].liked', ctx), true, '数据源回滚');
});
