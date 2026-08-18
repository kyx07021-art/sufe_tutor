/**
 * #161 · 资料共享帖子可点击浮窗查看全文（B4：直接 import posts ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderPostCard } from '../src/client/features/posts/render.js';
import { setPostsListForTest, togglePostLike } from '../src/client/features/posts/actions-list.js';
import { postCardClick, openPostDetail } from '../src/client/features/posts/actions-editor.js';
import { state } from '../src/client/core/state.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="posts-list"></div><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}
function teardown() { delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver; }

test('帖子卡渲染：可点击（data-action+标题 button），点赞/删除控件保留', () => {
  const dom = setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  const html = renderPostCard({ id: 9, user_id: 38, username: '学生A', title: '讲义', body_md: '内容'.repeat(60), created_at: '2026-08-07 04:27:09', liked: false, like_count: 0 }, 0);
  assert.ok(html.includes('data-action="posts.openCard"'), '卡片 data-action 接管点击');
  assert.ok(/<button type="button" class="post-title"/.test(html), '标题转 button（键盘焦点）');
  assert.ok(html.includes('post-like glass') && html.includes('post-del'), '点赞/删除控件仍在');
  assert.ok(html.includes('…'), '长文显示省略号');
  teardown();
});

test('postCardClick：点赞/删除内部控件点击不透传，卡片本体点击开浮窗', async () => {
  const dom = setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  setPostsListForTest([{ id: 9, user_id: 39, username: '学生A', title: '讲义', body_md: 'x', created_at: '2026-08-07 04:27:09' }]);
  dom.window.document.getElementById('posts-list').innerHTML = `
    <div class="post-card glass" data-post-id="9" data-action="posts.openCard">
      <button type="button" class="post-title">讲义</button>
      <label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞" data-posts-like="9"><span class="like-count">0</span></label>
      <button type="button" class="post-del">删除</button>
    </div>`;
  const like = dom.window.document.querySelector('.post-like');
  const del = dom.window.document.querySelector('.post-del');
  const title = dom.window.document.querySelector('.post-title');
  postCardClick({ target: like }, 9);
  assert.equal(dom.window.document.querySelector('#modal-container').innerHTML, '', '点赞点击不透传');
  postCardClick({ target: del }, 9);
  assert.equal(dom.window.document.querySelector('#modal-container').innerHTML, '', '删除点击不透传');
  postCardClick({ target: title }, 9);
  assert.ok(dom.window.document.querySelector('#modal-container .modal'), '卡片本体点击开浮窗');
  teardown();
});

test('openPostDetail：浮窗含转义标题、md 全文、点赞 pill、作者删除；非本人无删除', () => {
  const dom = setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  setPostsListForTest([{ id: 9, user_id: 39, username: '学生A', title: '<script>alert(1)</script> 讲义', body_md: '**重点** 内容\n- 要点', created_at: '2026-08-07 04:27:09', liked: true, like_count: 3, favorited: false }]);
  openPostDetail(9);
  const modalHtml = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(modalHtml.includes('modal--wide'), '长文拓宽');
  assert.ok(modalHtml.includes('md-preview--full'), '正文放开高度封顶');
  assert.ok(modalHtml.includes('&lt;script&gt;'), '标题 escHtml 转义（脚本不执行）');
  assert.ok(!modalHtml.includes('<script>alert'), '无原始脚本标签');
  assert.ok(modalHtml.includes('<strong>重点</strong>'), 'mdRender 渲染粗体');
  assert.ok(modalHtml.includes('post-like glass') && modalHtml.includes('checked'), '浮窗复用点赞 pill（liked 态）');
  assert.ok(!modalHtml.includes('post-del'), '非本人帖子不显示删除');
  setPostsListForTest([{ id: 9, user_id: 38, username: '学生A', title: 't', body_md: 'x', created_at: '2026-08-07 04:27:09', liked: false, like_count: 0, favorited: false }]);
  openPostDetail(9);
  assert.ok(dom.window.document.querySelector('#modal-container').innerHTML.includes('data-action="posts.confirmDelete"'), '本人帖子浮窗 footer 含删除按钮');
  teardown();
});

test('togglePostLike 同步全部 like pill（列表卡 + 浮窗）', async () => {
  const dom = setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  setPostsListForTest([{ id: 9, user_id: 39, username: '学生A', title: 't', body_md: 'x', created_at: '2026-08-07 04:27:09', liked: false, like_count: 0, favorited: false }]);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ liked: true, likeCount: 5 }) });
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" data-posts-like="9"><span class="like-count">0</span></label>`;
  openPostDetail(9);
  const listBox = dom.window.document.querySelector('#posts-list .post-like input');
  const modalBox = dom.window.document.querySelector('#modal-container .post-like input');
  assert.ok(modalBox, '浮窗含 like pill');
  modalBox.checked = true;
  await togglePostLike(9, modalBox);
  assert.equal(listBox.checked, true, '列表卡 pill checked 同步');
  assert.equal(modalBox.checked, true, '浮窗 pill checked 同步');
  assert.equal(dom.window.document.querySelector('#posts-list .like-count').textContent, '5', '列表计数同步');
  assert.equal(dom.window.document.querySelector('#modal-container .like-count').textContent, '5', '浮窗计数同步');
  delete globalThis.fetch; teardown();
});

test('详情浮窗 CSS：md-preview--full、卡 hover 洗、标题按钮还原', () => {
  const css = readFileSync('./style-posts.css', 'utf8');
  assert.ok(css.includes('.md-preview--full { max-height: none; }'), '详情正文放开高度封顶');
  assert.ok(css.includes('.post-card {') && css.includes('cursor: pointer'), '卡片指针光标');
  assert.ok(css.includes('.post-title {') && /\.post-title \{[\s\S]*border: none;[\s\S]*background: none;/.test(css), '标题按钮还原为文本外观');
  assert.ok(css.includes('.post-detail-foot'), 'footer 排布样式存在');
});
