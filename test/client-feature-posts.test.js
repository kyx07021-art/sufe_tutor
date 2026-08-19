import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPostCard, likePillHtml, favPillHtml, postsToolbarHtml } from '../src/client/features/posts/render.js';
import { state } from '../src/client/core/state.js';
import { postsList } from '../src/client/features/posts/actions-list.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import * as actions from '../src/client/features/posts/actions.js';
import { TEXT } from '../src/client/features/posts/text.js';

test('posts render: card has no inline handlers/style', () => {
  state.user = { id: 1, role: 'teacher' };
  const html = renderPostCard({ id: 1, user_id: 1, username: 'alice', title: '物理笔记', body_md: 'hello', created_at: '2026-08-17 12:00:00', like_count: 2, liked: false, favorited: true }, 0);
  assert.ok(html.includes('data-action="posts.openCard"'));
  assert.ok(html.includes('post-del'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(!/style=/.test(html));
  state.user = null;
});

test('posts render: like/fav pills use data attributes not inline', () => {
  const like = likePillHtml({ id: 1, liked: true, like_count: 3 });
  assert.ok(like.includes('data-posts-like="1"'));
  assert.ok(like.includes('checked'));
  const fav = favPillHtml({ id: 1, favorited: true });
  assert.ok(fav.includes('data-posts-fav="1"'));
  assert.ok(fav.includes('checked'));
  assert.ok(!/onchange=/.test(like + fav));
});

test('posts render: toolbar has data-action/input/change no inline', () => {
  state.user = { role: 'teacher' };
  const html = postsToolbarHtml('all');
  assert.ok(html.includes('data-action="posts.toggleFav"'));
  assert.ok(html.includes('data-input="posts.search"'));
  assert.ok(html.includes('data-change="posts.sort"'));
  assert.ok(!/onclick=/.test(html));
  state.user = null;
});

test('posts text keys present (v2 text.js 单源；v1 root constants 已删)', () => {
  for (const k of ['POSTS_EMPTY', 'POST_PUBLISHED', 'POST_TITLE_REQUIRED']) {
    assert.ok(TEXT[k], `${k} exists`);
  }
});

test('posts action: unauthenticated like reverts checkbox', () => {
  const dom = new JSDOM('<html><body><label class="post-like" data-id="7"><input type="checkbox" data-posts-like="7"><span class="like-count">1</span></label></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  setEnsureAuth(() => false); // posts gate is core api's ensureAuth (single source)
  const input = dom.window.document.querySelector('input');
  input.checked = true;
  actions.togglePostLike(7, input);
  assert.equal(input.checked, false, 'unauth like reverts');
  delete globalThis.document;
});


test('posts action: openPostDetail renders modal for item in postsList', () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  postsList.length = 0;
  postsList.push({ id: 9, user_id: 1, username: 'alice', title: 'T', body_md: '**hi**', created_at: '2026-08-17 12:00:00', like_count: 0, liked: false, favorited: false });
  state.user = { id: 1 };
  actions.openPostDetail(9);
  assert.ok(dom.window.document.getElementById('modal-container').innerHTML.includes('T'));
  assert.ok(actions.postCardClick);
  delete globalThis.document;
});

test('posts action: openFeedbackModal does not throw and has data-action footer', () => {
  const dom = new JSDOM('<html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  setEnsureAuth(() => true);
  actions.openFeedbackModal('bug');
  assert.ok(dom.window.document.getElementById('modal-container').innerHTML.includes('data-action="posts.submitFeedback"'));
  delete globalThis.document;
});


test('posts delegation: checkbox click inside card is not prevented', async () => {
  const dom = new JSDOM('<html><body><div data-action="posts.openCard" data-post-id="1"><label class="post-like"><input type="checkbox" data-posts-like="1"></label></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  const mod = await import('../src/client/features/posts/index.js');
  const off = mod.default.onLoad();
  const input = dom.window.document.querySelector('input');
  const ev = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(ev.defaultPrevented, false, 'checkbox click should not be prevented');
  off();
  delete globalThis.document;
});
