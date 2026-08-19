import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { registerPage, unregisterPage, pagesForRole, defaultPageFor, showView, updateNavbar, renderSidebar, selectPage, loadInto, setBadge } from '../src/client/core/router.js';
import { segTabsHtml } from '../src/client/core/ui.js';
import { matchRowsHtml } from '../src/client/core/match.js';

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="view-landing"></div><div id="view-client" class="hidden"></div>
  <div id="navbar-actions"></div><div id="sidebar-user"></div><div id="sidebar-nav"></div><div id="sidebar-invite"></div>
  <div id="client-main"><div class="client-page" data-page="about"><div id="about-page-title"></div><div id="about-content"></div></div></div>
  <div id="loader"></div><div id="sidebar-my-demo-dot" class="sidebar-dot"></div>
</body></html>`, { url: 'http://localhost/' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.MutationObserver = class { observe() {} };
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;

test('registerPage/pagesForRole/defaultPageFor', () => {
  registerPage({ id: 'my-demo', roles: ['teacher'], label: 'DEMO', enter() {}, auth: true });
  state.user = { role: 'teacher' };
  assert.equal(pagesForRole().some(p => p.id === 'my-demo'), true);
  state.user = null; state.guestRole = 'student';
  assert.equal(pagesForRole().some(p => p.id === 'my-demo'), false);
  assert.equal(defaultPageFor(), 'browse-teachers');
  unregisterPage('my-demo');
});

test('defaultPageFor logged-in follows old role first page, never builtin about', () => {
  state.user = { role: 'student' };
  assert.equal(defaultPageFor(), 'my-demands');
  state.user = { role: 'teacher' };
  assert.equal(defaultPageFor(), 'browse-demands');
  state.user = { role: 'admin' };
  assert.equal(defaultPageFor(), 'admin-stats');
});

test('showView/updateNavbar/renderSidebar/selectPage about builtin', async () => {
  state.user = null; state.guestRole = 'student'; state.page = null;
  renderSidebar();
  assert.equal(document.getElementById('sidebar-user').innerHTML.includes('vundefined'), false);
  assert.ok(document.getElementById('sidebar-user').innerHTML.includes('v2.0.0'));
  showView('client');
  assert.equal(state.view, 'client');
  updateNavbar();
  assert.ok(document.getElementById('navbar-actions').innerHTML.includes('登录'));
  renderSidebar();
  assert.ok(document.getElementById('sidebar-nav').innerHTML.includes('关于平台'));
  selectPage('about');
  assert.ok(document.getElementById('about-content').innerHTML.includes('我们是谁'));
});

test('loadInto renders/empty/error and seq guard', async () => {
  let ok = await loadInto('loader', async () => [{ id: 1 }], rows => `<p>${rows.length}</p>`);
  assert.equal(ok, true);
  assert.equal(document.getElementById('loader').textContent, '1');
  ok = await loadInto('loader', async () => [], () => 'x', { empty: 'EMPTY' });
  assert.equal(document.getElementById('loader').textContent, 'EMPTY');
  ok = await loadInto('loader', async () => { throw new Error('boom'); }, () => 'x');
  assert.ok(document.getElementById('loader').textContent.includes('boom'));
});

test('setBadge toggles dot', () => {
  const dot = document.getElementById('sidebar-my-demo-dot');
  setBadge('my-demo', 3);
  assert.equal(dot.classList.contains('hidden'), false);
  setBadge('my-demo', 0);
  assert.equal(dot.classList.contains('hidden'), true);
});

test('loadInto auto-applies seg-tab bindings and match-bar widths', async () => {
  const el = document.getElementById('loader');
  await loadInto('loader', async () => [1], () => segTabsHtml([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], 'a') + matchRowsHtml([{ label: 'x', score: 30, max: 45 }]));
  assert.equal(el.querySelector('.seg-tabs').dataset.tabBound, '1');
  const bar = el.querySelector('.match-bar i');
  assert.equal(bar.style.getPropertyValue('--bar-w'), '67%');
});
