/**
 * posts feature actions: list load, like/fav, editor, delete, broadcast, feedback.
 */
import { CONFIG } from '../../../shared/config.js';
import { TEXT } from './text.js';
import { state } from '../../core/state.js';
import { api, ensureAuth } from '../../core/api.js';
import { dhGet, dhReady, dhPeek, dhOnDomainRefresh, invalidate } from '../../core/datahub.js';
import { loadInto } from '../../core/router.js';
import { escHtml, mdRender, fmtDateTime, loaderHtml } from '../../core/dom.js';
import { usernameHtml, deactivatedTag, feedbackKindName, feedbackKindCls, feedbackSubjectName } from '../../core/display.js';
import { openModal, closeModal, showToast, btnLoading, btnDone, confirm, mdEditorHtml, initCustomSelects } from '../../core/ui.js';
import { likePillHtml, favPillHtml, renderPostCard, postsToolbarHtml } from './render.js';

export let postsList = [];
export function setPostsListForTest(list) { postsList = list; }
let postsUrl = '/api/posts?sort=new';
let postsSearchTimer = null;
let postsView = 'all';
const postLikeSeq = {};
const postFavSeq = {};

// Single source: core api's ensureAuth (wired by the auth feature at boot).
// The private per-feature setter died with the ESM migration — tests that used
// to stub it now wire core setEnsureAuth directly.
export function postsAuth() { return ensureAuth(); }

dhOnDomainRefresh('posts', () => {
  const c = dhPeek(postsUrl);
  if (c && c.posts) postsList = c.posts;
});

export function enterResourceShare() {
  clearTimeout(postsSearchTimer);
  const el = document.getElementById('posts-content');
  if (!el) return;
  el.innerHTML = postsToolbarHtml(postsView);
  initCustomSelects(el);
  loadPosts();
}

export function togglePostsFav() {
  postsView = postsView === 'all' ? 'fav' : 'all';
  const btn = document.getElementById('posts-fav-btn');
  if (btn) {
    btn.textContent = postsView === 'fav' ? TEXT.POSTS_FAV_ACTIVE : TEXT.POSTS_VIEW_FAV;
    btn.classList.toggle('posts-fav-btn--on', postsView === 'fav');
    btn.setAttribute('aria-pressed', postsView === 'fav');
  }
  const search = document.getElementById('posts-search');
  if (search) search.value = '';
  loadPosts();
}

export function postsSearchDebounced() {
  clearTimeout(postsSearchTimer);
  postsSearchTimer = setTimeout(() => loadPosts(), CONFIG.POSTS_SEARCH_DEBOUNCE_MS);
}

export function loadPosts() {
  const qEl = document.getElementById('posts-search');
  const sEl = document.getElementById('posts-sort');
  const q = (qEl ? qEl.value : '').trim();
  const sort = sEl ? sEl.value : 'new';
  const url = postsView === 'fav'
    ? '/api/posts/favorites/mine'
    : `/api/posts?sort=${sort}` + (q ? `&q=${encodeURIComponent(q)}` : '');
  postsUrl = url;
  return loadInto('posts-list', async () => {
    const data = await dhGet(url, { domain: 'posts' });
    postsList = data.posts || [];
    return data;
  }, rows => rows.map(renderPostCard).join(''),
  { seqKey: 'posts', empty: postsView === 'fav' ? TEXT.POSTS_FAV_EMPTY : TEXT.POSTS_EMPTY, pick: d => d.posts, reveal: true, peek: () => dhReady(url) });
}

function applyPostLikeState(id, liked, likeCount) {
  const p = postsList.find(x => x.id === id);
  if (p) { p.liked = liked; p.like_count = likeCount; }
  document.querySelectorAll(`.post-like[data-id="${id}"]`).forEach(label => {
    const box = label.querySelector('input[type="checkbox"]');
    if (box) box.checked = liked;
    const cnt = label.querySelector('.like-count');
    if (cnt) cnt.textContent = likeCount;
  });
}

export async function togglePostLike(id, input) {
  if (!input) return;
  const wasChecked = !input.checked;
  const target = input.checked;
  const p0 = postsList.find(x => x.id === id);
  const cnt0 = document.querySelector(`.post-like[data-id="${id}"] .like-count`);
  const origLiked = p0 ? p0.liked : wasChecked;
  const origCount = p0 ? (p0.like_count ?? 0) : (cnt0 ? (Number(cnt0.textContent) || 0) : 0);
  const revert = () => {
    if (input && input.checked !== wasChecked) input.checked = wasChecked;
    document.querySelectorAll(`.post-like[data-id="${id}"]`).forEach(label => {
      const box = label.querySelector('input[type="checkbox"]');
      if (box) box.checked = wasChecked;
      const cnt = label.querySelector('.like-count');
      if (cnt) cnt.textContent = origCount;
    });
    if (p0) { p0.liked = origLiked; p0.like_count = origCount; }
  };
  if (!ensureAuth()) { revert(); return; }
  const seq = (postLikeSeq[id] = (postLikeSeq[id] || 0) + 1);
  applyPostLikeState(id, target, origCount + (target ? 1 : -1));
  showToast(target ? TEXT.POST_LIKED_TOAST : TEXT.POST_UNLIKED_TOAST);
  try {
    const data = await api(`/api/posts/${id}/like`, { method: 'POST', body: {} });
    if (postLikeSeq[id] !== seq) return;
    applyPostLikeState(id, data.liked, data.likeCount);
  } catch (err) {
    if (postLikeSeq[id] !== seq) return;
    revert();
    showToast(err.message);
  }
}

function applyPostFavState(id, favorited) {
  const p = postsList.find(x => x.id === id);
  if (p) p.favorited = favorited;
  document.querySelectorAll(`.post-fav[data-id="${id}"]`).forEach(label => {
    const box = label.querySelector('input[type="checkbox"]');
    if (box) box.checked = favorited;
    const txt = label.querySelector('.fav-label');
    if (txt) txt.textContent = favorited ? TEXT.BTN_FAVORITED : TEXT.BTN_FAVORITE;
  });
}

export async function togglePostFavorite(id, input) {
  if (!input) return;
  const wasChecked = !input.checked;
  const target = input.checked;
  const p0 = postsList.find(x => x.id === id);
  const origFav = p0 ? p0.favorited : wasChecked;
  const revert = () => {
    if (input && input.checked !== wasChecked) input.checked = wasChecked;
    document.querySelectorAll(`.post-fav[data-id="${id}"]`).forEach(label => {
      const box = label.querySelector('input[type="checkbox"]');
      if (box) box.checked = wasChecked;
      const txt = label.querySelector('.fav-label');
      if (txt) txt.textContent = origFav ? TEXT.BTN_FAVORITED : TEXT.BTN_FAVORITE;
    });
    if (p0) p0.favorited = origFav;
  };
  if (!ensureAuth()) { revert(); return; }
  const seq = (postFavSeq[id] = (postFavSeq[id] || 0) + 1);
  applyPostFavState(id, target);
  showToast(target ? TEXT.POST_FAVORITED_TOAST : TEXT.POST_UNFAVORITED_TOAST);
  try {
    const data = await api(`/api/posts/${id}/favorite`, { method: 'POST', body: {} });
    if (postFavSeq[id] !== seq) return;
    applyPostFavState(id, data.favorited);
    if (!data.favorited && postsView === 'fav') {
      const card = document.querySelector(`#posts-list .post-fav[data-id="${id}"]`)?.closest('.post-card');
      if (card) card.remove();
    }
  } catch (err) {
    if (postFavSeq[id] !== seq) return;
    revert();
    showToast(err.message);
  }
}


