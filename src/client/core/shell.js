/**
 * v2 shell frame: landing + client shell (sidebar + per-page sections).
 * No inline handlers (archtest): interactive elements use data-action delegation
 * (auth.* / student.* / teacher.* / notif.*) or shell-level direct listeners
 * (sidebar toggle/close, brand goHome). Idempotent: mountShell() early-returns once
 * #view-client exists. auth owns #view-login/#view-register (mountView replaces them).
 */
import { TEXT } from '../constants/text.js';
import { escHtml } from './dom.js';
import { CARET_SVG } from './ui.js';
import { goHome } from './router.js';
import { ROLES } from '../../shared/enums.js'; // Z-16-F5b: role literals via shared enums

function page(id, title, { actions = '', body = '', flush = false } = {}) {
  return `<section class="client-page hidden${flush ? ' client-page--flush' : ''}" data-page="${id}">
    <div class="page-header"><h2>${escHtml(title)}</h2>${actions}</div>
    ${body}
  </section>`;
}

const filterToggleBtn = (action, id) => `<button type="button" class="btn btn-soft glass glass--pressable filter-toggle" id="${id}" data-action="${action}">${escHtml(TEXT.FILTER_TOGGLE)} <span class="drop-caret">${CARET_SVG}</span></button>`;

export function mountShell() {
  const app = document.getElementById('app');
  if (!app || app.querySelector('#view-client')) return;
  const btnNewDemand = `<button type="button" class="btn btn-sm glass glass--pressable" id="btn-new-demand" data-action="student.openModal">+ ${escHtml(TEXT.BTN_NEW_DEMAND)}</button>`;
  const notifBlockBtn = `<button type="button" class="btn btn-sm glass glass--pressable notif-block-btn" id="btn-notif-block" data-action="notif.toggleBlock">${escHtml(TEXT.NOTIF_BLOCK_OFF)}</button>`;
  const entry = (idx, title, desc, role) => `<button type="button" class="entry glass" data-action="auth.enterGuest" data-role="${role}">
    <span class="entry-glow" aria-hidden="true"></span>
    <span class="entry-index">${idx}</span>
    <span class="entry-body">
      <span class="entry-title">${escHtml(title)}</span>
      <span class="entry-desc">${escHtml(desc)}</span>
    </span>
    <span class="entry-arrow" aria-hidden="true">→</span>
  </button>`;
  app.innerHTML = `
    <main class="landing" id="view-landing">
      <section class="landing-stage">
        <div class="stage-nav">
          <div class="navbar-brand" id="navbar-brand" title="${escHtml(TEXT.APP_NAME)}">
            <div class="navbar-logo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
            <div>
              <div class="navbar-title">${escHtml(TEXT.APP_NAME)}</div>
              <div class="navbar-subtitle">${escHtml(TEXT.LANDING_SUBTITLE)}</div>
            </div>
          </div>
          <div class="stage-nav-actions">
            <button type="button" class="btn glass glass--pressable" data-action="auth.viewLogin">${escHtml(TEXT.NAV_LOGIN)}</button>
            <button type="button" class="btn glass glass--pressable" data-action="auth.viewRegister">${escHtml(TEXT.NAV_REGISTER)}</button>
          </div>
        </div>
        <div class="hand-mask" aria-hidden="true"><span class="hand-part hand-part--a"></span><span class="hand-part hand-part--b"></span></div>
        <div class="stage-deco-grid" aria-hidden="true"></div>
        <div class="container stage-grid">
          <div class="stage-left">
            <div class="stage-text">
              <p class="eyebrow"><span class="eyebrow-rule"></span>${escHtml(TEXT.LANDING_EYEBROW)}</p>
              <h1 class="hero-title">${escHtml(TEXT.LANDING_TAGLINE)}</h1>
              <p class="stage-copy">${escHtml(TEXT.LANDING_COPY)}</p>
            </div>
            <div class="flow-field" aria-hidden="true"></div>
          </div>
          <div class="stage-right">
            <p class="stage-kicker">${escHtml(TEXT.LANDING_KICKER)}</p>
            <div class="entry-list">
              ${entry('01', TEXT.ENTRY_STUDENT_TITLE, TEXT.ENTRY_STUDENT_DESC, ROLES.STUDENT)}
              ${entry('02', TEXT.ENTRY_TEACHER_TITLE, TEXT.ENTRY_TEACHER_DESC, ROLES.TEACHER)}
            </div>
            <p class="stage-note">${escHtml(TEXT.LANDING_NOTE)}</p>
          </div>
        </div>
        <footer class="landing-footer"><div class="container">${escHtml(TEXT.LANDING_FOOTER)}</div></footer>
      </section>
    </main>
    <div class="client-shell hidden" id="view-client">
      <aside class="client-sidebar" id="client-sidebar">
        <button type="button" class="sidebar-expand-toggle glass" data-action="shell.toggleSidebar" aria-label="${escHtml(TEXT.SIDEBAR_TOGGLE_ARIA)}">
          <svg class="expand-caret" width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true"><path d="M2 1l4 4 4-4" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <div class="sidebar-deco-grid" aria-hidden="true"></div>
        <div class="sidebar-scroll">
          <nav class="sidebar-nav" id="sidebar-nav" aria-label="${escHtml(TEXT.SIDEBAR_NAV_ARIA)}"></nav>
          <button type="button" class="sidebar-close" data-action="shell.closeSidebar">✕ ${escHtml(TEXT.SIDEBAR_CLOSE)}</button>
        </div>
        <div class="sidebar-invite hidden" id="sidebar-invite"></div>
        <div class="sidebar-user glass" id="sidebar-user"></div>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <main class="client-main" id="client-main">
        ${page('my-demands', TEXT.PAGE_MY_DEMANDS, { actions: btnNewDemand, body: `<div class="browse-list" id="my-demands-list"></div>` })}
        ${page('browse-demands', TEXT.PAGE_BROWSE_DEMANDS, { actions: filterToggleBtn('student.toggleFilters', 'demand-filter-toggle-btn'), body: `
          <div class="filter-panel glass glass--solid hidden" id="demand-filter-panel">
            <select class="filter-select" id="demand-sort" data-change="demand.applyControls"></select>
            <label id="demand-filter-subject-label"></label><select class="filter-select" id="demand-filter-subject" data-change="demand.applyControls"></select>
            <label id="demand-filter-grade-label"></label><select class="filter-select" id="demand-filter-grade" data-change="demand.applyControls"></select>
            <label id="demand-filter-method-label"></label><select class="filter-select" id="demand-filter-method" data-change="demand.applyControls"></select>
            <label id="demand-filter-province-label"></label><select class="filter-select" id="demand-filter-province" data-change="demand.applyControls"></select>
          </div>
          <div class="browse-list" id="browse-demands-list"></div>` })}
        ${page('browse-teachers', TEXT.PAGE_BROWSE_TEACHERS, { actions: filterToggleBtn('teacher.toggleFilters', 'filter-toggle-btn'), body: `
          <div class="filter-panel glass glass--solid hidden" id="teacher-filters"> <!-- Q-4a-M1b: teacher sort/filter controls (filled by teacher feature fillTeacherFilters; was empty dead container) -->
            <label id="teacher-sort-label"></label><select class="filter-select" id="teacher-sort" data-change="teacher.sort"></select>
            <label id="teacher-method-label"></label><select class="filter-select" id="filter-method" data-change="teacher.applyFilters"></select>
            <label id="teacher-day-label"></label><select class="filter-select" id="filter-day" data-change="teacher.applyFilters"></select>
            <label id="teacher-verified-label"></label><select class="filter-select" id="filter-verified" data-change="teacher.applyFilters"></select>
          </div>
          <div class="browse-list" id="browse-teachers-list"></div>` })}
        ${page('my-chats', TEXT.PAGE_MY_CHATS, { flush: true, body: `
          <div class="chats-shell">
            <aside class="chats-list-pane">
              <div class="chats-list-head">
                <div class="chats-list-title-group">
                  <div class="chats-list-title">${escHtml(TEXT.CHAT_TITLE)}</div>
                </div>
              </div>
              <div class="conv-list" id="my-chats-list"></div>
            </aside>
            <section class="chat-pane">
              <div class="chat-frame" id="chat-frame"></div>
            </section>
          </div>` })}
        ${page('my-contracts', TEXT.PAGE_MY_CONTRACTS, { body: `<div class="browse-list" id="my-contracts-list"></div>` })}
        ${page('teacher-profile', TEXT.PAGE_TEACHER_PROFILE, { body: `<div id="teacher-profile-content"></div>` })}
        ${page('resource-share', TEXT.PAGE_RESOURCE_SHARE, { body: `<div id="posts-content"></div>` })}
        ${page('notifications', TEXT.PAGE_NOTIFICATIONS, { actions: notifBlockBtn, body: `<div class="browse-list" id="notifications-content"></div>` })}
        ${page('account-settings', TEXT.PAGE_ACCOUNT_SETTINGS, { body: `<div id="account-settings-content"></div>` })}
        ${page('admin-stats', TEXT.PAGE_ADMIN_STATS, { body: `<div id="admin-stats-box"></div><div id="admin-stats-content"></div>` })}
        ${page('admin-traffic', TEXT.PAGE_ADMIN_TRAFFIC, { body: `<div id="admin-traffic-box"></div>` })}
        ${page('admin-students', TEXT.PAGE_ADMIN_STUDENTS, { body: `<div class="admin-search-wrap"><input type="search" class="form-input admin-search" id="admin-students-search" placeholder="${escHtml(TEXT.ADMIN_USER_SEARCH_PLACEHOLDER)}" data-input-action="admin.searchStudents"></div><div class="browse-list" id="admin-students-list"></div>` })}
        ${page('admin-teachers', TEXT.PAGE_ADMIN_TEACHERS, { body: `<div class="admin-search-wrap"><input type="search" class="form-input admin-search" id="admin-teachers-search" placeholder="${escHtml(TEXT.ADMIN_USER_SEARCH_PLACEHOLDER)}" data-input-action="admin.searchTeachers"></div><div class="browse-list" id="admin-teachers-list"></div>` })}
        ${page('admin-demands', TEXT.PAGE_ADMIN_DEMANDS, { body: `<div class="browse-list" id="admin-demands-list"></div>` })}
        ${page('admin-reviews', TEXT.PAGE_ADMIN_REVIEWS, { body: `
          <div class="filter-panel glass glass--solid" id="admin-reviews-filter">
            <select class="filter-select" id="admin-reviews-status" data-change="admin.filterReviews">
              <option value="">${escHtml(TEXT.LABEL_FILTER_ALL)}</option>
              <option value="pending">${escHtml(TEXT.STATUS_PENDING)}</option>
              <option value="approved">${escHtml(TEXT.STATUS_APPROVED)}</option>
              <option value="rejected">${escHtml(TEXT.STATUS_REJECTED)}</option>
            </select>
          </div>
          <div class="browse-list" id="admin-reviews-list"></div>` })}
        ${page('admin-awards', TEXT.PAGE_ADMIN_AWARDS, { body: `<div class="browse-list" id="admin-awards-list"></div>` })}
        ${page('admin-verifications', TEXT.PAGE_ADMIN_VERIFICATIONS, { body: `<div class="browse-list" id="admin-verifications-list"></div>` })}
        ${page('admin-posts', TEXT.PAGE_ADMIN_POSTS, { body: `<div class="browse-list" id="admin-posts-list"></div>` })}
        ${page('admin-contracts', TEXT.PAGE_ADMIN_CONTRACTS, { body: `<div class="browse-list" id="admin-contracts-list"></div>` })}
        ${page('admin-feedback', TEXT.PAGE_ADMIN_FEEDBACK, { body: `<div class="browse-list" id="admin-feedback-list"></div>` })}
        ${page('admin-content', TEXT.PAGE_ADMIN_CONTENT, { body: `<div class="browse-list" id="admin-content-list"></div>` })}
        ${page('admin-complaint', TEXT.PAGE_ADMIN_COMPLAINT, { body: `<div id="admin-complaint-list"></div>` })}
        ${page('about', TEXT.PAGE_ABOUT, { body: `<div id="about-content"></div>` })}
      </main>
    </div>
    <div id="modal-container"></div>
    <div id="toast-container"></div>
  `;
  // Shell-level direct listeners (no inline onclick)
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', () => { document.body.classList.remove('sidebar-open'); });
  document.querySelectorAll('#view-client [data-action="shell.toggleSidebar"]').forEach(b =>
    b.addEventListener('click', () => document.body.classList.toggle('sidebar-open')));
  document.querySelectorAll('#view-client [data-action="shell.closeSidebar"]').forEach(b =>
    b.addEventListener('click', () => document.body.classList.remove('sidebar-open')));
  const brand = document.getElementById('navbar-brand');
  if (brand) brand.addEventListener('click', goHome);
  // Regression fix (2026-08-20): v1 split the hero tagline into per-char spans for the 3-col
  // grid + staggered rise animation (base.css .hero-title span / var(--i)). v2 rendered it as a
  // single text node -> the 9 chars collapsed into one grid cell (broken layout). Re-split here with
  // JS; --i is set via CSSOM setProperty (exempt from style-src-attr per h5a-g6), so no inline
  // style attribute is produced and strict CSP holds.
  const hero = app.querySelector('.hero-title');
  if (hero) {
    const text = hero.textContent;
    hero.setAttribute('aria-label', text);
    hero.replaceChildren(...[...text].map((c, i) => {
      const s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.textContent = c;
      s.style.setProperty('--i', String(i));
      return s;
    }));
  }
  return app;
}
