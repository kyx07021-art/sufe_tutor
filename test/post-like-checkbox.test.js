/**
 * #160 点赞按钮接复选框逻辑（B4：直接 import posts render/actions）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderPostCard } from '../src/client/features/posts/render.js';
import { togglePostLike } from '../src/client/features/posts/actions-list.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { state } from '../src/client/core/state.js';
import { POSTS_CSS } from './_css.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="posts-list"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  return dom;
}

test('点赞渲染：隐藏原生 checkbox checked 随 p.liked', () => {
  const dom = setup();
  const html = renderPostCard({ id: 9, user_id: 39, username: '学生A', title: '讲义', body_md: '内容', created_at: '2026-08-07 04:27:09', liked: true, like_count: 3 }, 0);
  assert.ok(html.includes('post-like glass'));
  assert.ok(/<input type="checkbox" checked /.test(html));
  assert.ok(!html.includes('aria-pressed='));
  assert.ok(html.includes('like-count'));
  const html2 = renderPostCard({ id: 10, user_id: 39, username: '学生A', title: '讲义2', body_md: 'x', created_at: '2026-08-07 04:27:10', liked: false, like_count: 0 }, 0);
  assert.ok(/<input type="checkbox" aria-label/.test(html2));
  const glassCss = readFileSync('./glass.css', 'utf8');
  const postsCss = POSTS_CSS;
  assert.ok(glassCss.includes('.post-like:has(input:checked)'));
  assert.ok(postsCss.includes('.post-like:has(input:checked) .like-icon'));
  assert.ok(!postsCss.includes('.post-like.liked'));
  delete globalThis.document;
});

test('点赞成功：checked 以服务端 data.liked 收敛，计数随动', async () => {
  const dom = setup();
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ liked: true, likeCount: 4 }) });
  setEnsureAuth(() => true);
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true;
  await togglePostLike(9, box);
  globalThis.fetch = saved;
  assert.equal(box.checked, true);
  assert.equal(dom.window.document.querySelector('.like-count').textContent, '4');
  delete globalThis.document;
});

test('点赞失败：回滚到点前态', async () => {
  const dom = setup();
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('网络错误'); };
  setEnsureAuth(() => true);
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true;
  await togglePostLike(9, box);
  assert.equal(box.checked, false);
  box.checked = false;
  await togglePostLike(9, box);
  assert.equal(box.checked, true);
  globalThis.fetch = saved;
  delete globalThis.document;
});

test('点赞访客：ensureAuth 拦截并回滚原生翻转', async () => {
  const dom = setup();
  setEnsureAuth(() => false);
  state.user = null;
  dom.window.document.getElementById('posts-list').innerHTML =
    `<label class="post-like glass" data-id="9"><input type="checkbox" aria-label="点赞"><span class="like-count">3</span></label>`;
  const box = dom.window.document.querySelector('.post-like input');
  box.checked = true;
  await togglePostLike(9, box);
  assert.equal(box.checked, false);
  delete globalThis.document;
});
