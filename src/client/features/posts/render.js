/**
 * posts feature renderers: toolbar, post card, like/fav pills.
 * No inline handlers or inline style attributes.
 */
import { CONFIG } from '../../../shared/config.js';
import { escHtml, fmtDateTime, loaderHtml } from '../../core/dom.js';
import { state } from '../../core/state.js';
import { usernameHtml, deactivatedTag } from '../../core/display.js';
import { TEXT } from './text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums

export function likePillHtml(p) {
  return `<label class="post-like glass" data-id="${p.id}">
    <input type="checkbox"${p.liked ? ' checked' : ''} aria-label="${TEXT.POST_LIKE_ARIA}" data-posts-like="${p.id}">
    <svg class="like-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>
    <span class="like-count">${p.like_count || 0}</span>
  </label>`;
}

export function favPillHtml(p) {
  return `<label class="post-fav glass" data-id="${p.id}">
    <input type="checkbox"${p.favorited ? ' checked' : ''} aria-label="${TEXT.POST_FAV_ARIA}" data-posts-fav="${p.id}">
    <svg class="fav-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="fav-label">${p.favorited ? TEXT.BTN_FAVORITED : TEXT.BTN_FAVORITE}</span>
  </label>`;
}

export function renderPostCard(p, i) {
  const mine = state.user && p.user_id === state.user.id;
  const raw = String(p.body_md || '');
  const snippet = raw.slice(0, CONFIG.POST_SNIPPET);
  const time = p.created_at ? fmtDateTime(p.created_at) : '';
  return `<div class="post-card glass" data-post-id="${p.id}" data-action="posts.openCard" data-reveal-index="${Math.min(i, 8)}">
    <div class="post-card-head">
      <button type="button" class="post-title" aria-label="${TEXT.POST_VIEW_ARIA}" data-action="posts.openCard">${escHtml(p.title)}</button>
      ${mine ? `<button type="button" class="post-del" data-action="posts.confirmDelete" data-id="${p.id}">${TEXT.POST_BTN_DELETE}</button>` : ''}
    </div>
    <div class="post-meta">
      <span class="post-author">${usernameHtml(p.username || TEXT.POST_ANONYMOUS)}${deactivatedTag(p.username)}</span>
      <span class="post-time">${escHtml(time)}</span>
    </div>
    ${snippet ? `<p class="post-snippet">${escHtml(snippet)}${raw.length > CONFIG.POST_SNIPPET ? '…' : ''}</p>` : ''}
    <div class="post-actions">
      ${likePillHtml(p)}
      ${favPillHtml(p)}
    </div>
  </div>`;
}

export function postsToolbarHtml(postsView) {
  const isTeacher = state.user && state.user.role === ROLES.TEACHER;
  return `<div class="posts-toolbar glass">
      <button type="button" class="btn btn-sm glass glass--pressable posts-fav-btn${postsView === 'fav' ? ' posts-fav-btn--on' : ''}" id="posts-fav-btn"
        data-action="posts.toggleFav" aria-pressed="${postsView === 'fav'}">${postsView === 'fav' ? TEXT.POSTS_FAV_ACTIVE : TEXT.POSTS_VIEW_FAV}</button>
      <input type="search" id="posts-search" class="form-input posts-search"
        placeholder="${TEXT.POSTS_SEARCH_PLACEHOLDER}" data-input="posts.search">
      <select id="posts-sort" class="form-select posts-sort" data-change="posts.sort">
        <option value="new">${TEXT.POSTS_SORT_NEW}</option>
        <option value="hot">${TEXT.POSTS_SORT_HOT}</option>
      </select>
      ${isTeacher ? `<button type="button" class="btn btn-sm glass glass--pressable posts-create-btn" data-action="posts.openEditor">${TEXT.BTN_CREATE_POST}</button>` : ''}
    </div>
    <div id="posts-list"><div class="empty-state">${loaderHtml()}</div></div>`;
}
