/**
 * #161（v0.25.69）：资料共享帖子可点击浮窗查看全文
 *   - 卡片可点击：卡 onclick 统一接管，点赞/删除内部控件 closest 守卫不透传；
 *   - 标题转 button（键盘焦点 + Enter/Space 原生 click 冒泡到卡），不再是纯展示 h3；
 *   - openPostDetail：本地渲染全文（列表 payload 已含 body_md，零网络），标题 escHtml、
 *     mdRender 转义安全、正文 .md-preview 排版、点赞 pill 与删除复用列表卡组件；
 *   - togglePostLike 同步全部 .post-like[data-id]（列表卡 + 详情浮窗）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="posts-list"></div><div id="modal-container"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
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

test('帖子卡渲染：可点击（onclick+标题 button），点赞/删除控件保留', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [];
  `, ctx);
  const html = vm.runInContext(`renderPostCard({ id: 9, user_id: 38, username: '学生A', title: '讲义', body_md: '内容'.repeat(60), created_at: '2026-08-07 04:27:09', liked: false, like_count: 0 }, 0)`, ctx);
  assert.ok(/<div class="post-card glass"[^>]*onclick="postCardClick\(event, 9\)"/.test(html), '卡片 onclick 接管点击');
  assert.ok(/<button type="button" class="post-title"/.test(html), '标题转 button（键盘焦点）');
  assert.ok(html.includes('post-like glass') && html.includes('post-del'), '点赞/删除控件仍在');
  assert.ok(html.includes('…'), '长文显示省略号');
});

test('postCardClick：点赞/删除内部控件点击不透传，卡片本体点击开浮窗', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  let opened = null;
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    openPostDetail = (id) => { opened = id; };
  `, ctx);
  dom.window.document.getElementById('posts-list').innerHTML = `
    <div class="post-card glass" onclick="postCardClick(event, 9)">
      <button type="button" class="post-title">讲义</button>
      <label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">0</span></label>
      <button type="button" class="post-del">删除</button>
    </div>`;
  // vm 内直调 postCardClick，传真实 DOM target（jsdom 内联 onclick 在 window 上下文执行，跨 vm 沙箱不接）
  vm.runInContext(`
    opened = null;
    const _like = document.querySelector('.post-like');
    const _del = document.querySelector('.post-del');
    const _title = document.querySelector('.post-title');
    openedLog = [];
    postCardClick({ target: _like }, 9); openedLog.push(opened);
    postCardClick({ target: _del }, 9); openedLog.push(opened);
    postCardClick({ target: _title }, 9); openedLog.push(opened);
  `, ctx);
  assert.deepEqual([...vm.runInContext('openedLog', ctx)], [null, null, 9], '点赞/删除控件点击不透传，卡片本体点击开浮窗'); // 展开转宿主数组（vm 数组原型不同，strict deepEqual 比原型会误报）
  assert.equal(vm.runInContext('opened', ctx), 9, '最终打开帖子 9');
});

test('openPostDetail：浮窗含转义标题、md 全文、点赞 pill、作者删除；非本人无删除', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [ { id: 9, user_id: 39, username: '学生A', title: '<script>alert(1)</script> 讲义', body_md: '**重点** 内容\\n- 要点', created_at: '2026-08-07 04:27:09', liked: true, like_count: 3 } ];
  `, ctx);
  vm.runInContext('openPostDetail(9)', ctx);
  const modalHtml = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(modalHtml.includes('modal--wide'), '长文拓宽');
  assert.ok(modalHtml.includes('md-preview--full'), '正文放开高度封顶');
  assert.ok(modalHtml.includes('&lt;script&gt;'), '标题 escHtml 转义（脚本不执行）');
  assert.ok(!modalHtml.includes('<script>alert'), '无原始脚本标签');
  assert.ok(modalHtml.includes('<strong>重点</strong>'), 'mdRender 渲染粗体');
  assert.ok(modalHtml.includes('post-like glass') && modalHtml.includes('checked'), '浮窗复用点赞 pill（liked 态）');
  assert.ok(!modalHtml.includes('post-del'), '非本人帖子不显示删除');
  // 本人帖子 → footer 删除按钮
  vm.runInContext(`postsList[0].user_id = 38; openPostDetail(9)`, ctx);
  const mineHtml = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(mineHtml.includes('postConfirmDelete(9)'), '本人帖子浮窗 footer 含删除按钮');
});

test('togglePostLike 同步全部 like pill（列表卡 + 浮窗）', async () => {
  const { ctx, dom } = makeCtx();
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {}; initReveals = () => {}; showToast = () => {};
    ensureAuth = () => true;
    api = async () => ({ liked: true, likeCount: 5 });
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    postsList = [ { id: 9, user_id: 39, username: '学生A', title: 't', body_md: 'x', created_at: '2026-08-07 04:27:09', liked: false, like_count: 0 } ];
  `, ctx);
  // 列表卡 + 浮窗各一个 like pill
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" onchange="togglePostLike(9, this)"><span class="like-count">0</span></label>`;
  vm.runInContext('openPostDetail(9)', ctx);
  const listBox = dom.window.document.querySelector('#posts-list .post-like input');
  const modalBox = dom.window.document.querySelector('#modal-container .post-like input');
  assert.ok(modalBox, '浮窗含 like pill');
  modalBox.checked = true; // 原生翻转
  await vm.runInContext('togglePostLike(9, document.querySelector("#modal-container .post-like input"))', ctx);
  assert.equal(listBox.checked, true, '列表卡 pill checked 同步');
  assert.equal(modalBox.checked, true, '浮窗 pill checked 同步');
  assert.equal(dom.window.document.querySelector('#posts-list .like-count').textContent, '5', '列表计数同步');
  assert.equal(dom.window.document.querySelector('#modal-container .like-count').textContent, '5', '浮窗计数同步');
});

test('详情浮窗 CSS：md-preview--full、卡 hover 洗、标题按钮还原', async () => {
  const css = readFileSync('./style-posts.css', 'utf8');
  assert.ok(css.includes('.md-preview--full { max-height: none; }'), '详情正文放开高度封顶');
  assert.ok(css.includes('.post-card {') && css.includes('cursor: pointer'), '卡片指针光标');
  assert.ok(css.includes('.post-title {') && /\.post-title \{[\s\S]*border: none;[\s\S]*background: none;/.test(css), '标题按钮还原为文本外观');
  assert.ok(css.includes('.post-detail-foot'), 'footer 排布样式存在');
});
