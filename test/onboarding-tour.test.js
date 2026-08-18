/**
 * D-3 onboarding feature regression (v2 ESM port of the v1 vm sandbox test):
 * multi-step tour engine + five tour scripts integrity/depth + first-visit modal +
 * B1/B2/B3 boot/entry/dead-control wiring.
 *
 * Covers:
 *   - runTour stepping: click the hole -> next step (real click pass-through to the target)
 *   - closeModal steps point at the modal body (.modal) and auto-close on advance
 *   - unmounted targets (.hidden ancestor) poll via rAF; missing targets auto-skip on timeout
 *   - global skip button stays visible the whole tour and ends it on click
 *   - startOnboardingTour picks the script by login state + role
 *   - revisit entry migrated to the about page only (sidebar button removed)
 *   - per-module interaction depth >= 3 in every script (hard requirement)
 *   - script integrity: shapes valid, page ids registered, last step self
 *   - full walk-throughs of all four user scripts (demo chat/contract injection asserted)
 *   - first-visit modal: summarized policy + role-dependent primary button
 *   - pass:false interception (intent CTA / notif block do not pass through)
 *   - scroll architecture, animation stabilization, R27 dynamic hole binding
 *   - CSS rules direct file read (overlay mount + hole/bubble delay)
 *   - browseAsGuest / afterAuthSuccess tour wiring
 *   - B1: showOnboardingIfNeeded first-visit semantics + app.js boot call site
 *   - B2: about page revisit buttons real-clicked (usage guide modal + tour overlay)
 *   - B3: browse-demands sort/filter controls re-render locally, no new network
 *
 * Setup pattern (same discipline as notif-block-ui.test.js): feature onLoad
 * "installed" flags are module-level singletons -- a mid-test assertion failure
 * skips the uninstall and the next onLoad becomes a no-op. Every test that uses a
 * feature onLoad must register a t.after cleanup that runs even on failure.
 * Tour tests additionally skipTour() in teardown so the overlay listeners, demo
 * injections and the rAF follow loop do not leak across tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

import { state } from '../src/client/core/state.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { closeAllModals } from '../src/client/core/ui-modal.js';
import { openModal } from '../src/client/core/ui.js';
import { mountShell } from '../src/client/core/shell.js';
import { renderSidebar, selectPage, showView, pagesForRole, stopBadgePoll } from '../src/client/core/router.js';
import { CONFIG } from '../src/shared/config.js';
import { TEXT } from '../src/client/constants/text.js';

import { runTour, skipTour, startOnboardingTour, onboardContext } from '../src/client/features/onboard/engine.js';
import { TOUR_SCRIPTS } from '../src/client/features/onboard/tours.js';
import { showOnboardingIfNeeded, openOnboarding, browseAsGuest } from '../src/client/features/onboard/actions.js';
import onboardFeature from '../src/client/features/onboard/index.js';
import { afterAuthSuccess } from '../src/client/features/auth/flow.js';
import authFeature from '../src/client/features/auth/index.js';
import regionFeature from '../src/client/features/region/index.js';
import postsFeature from '../src/client/features/posts/index.js';
import complaintsFeature from '../src/client/features/complaints/index.js';
import contractFeature from '../src/client/features/contract/index.js';
import chatFeature from '../src/client/features/chat/index.js';
import teacherFeature from '../src/client/features/teacher/index.js';
import studentFeature from '../src/client/features/student/index.js';
import settingsFeature from '../src/client/features/settings/index.js';
import adminFeature from '../src/client/features/admin/index.js';
import notifFeature from '../src/client/features/notif/index.js';
import { chat } from '../src/client/features/chat/chat-state.js';
import { stopChatPolling, chatTeardown } from '../src/client/features/chat/actions-list.js';
import { loadBrowseDemands } from '../src/client/features/student/actions.js';

class MOStub { observe() {} disconnect() {} takeRecords() { return []; } }

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// ---- fixture data (same rows the v1 vm test used; every list renders a real card) ----
const teacher = {
  user_id: 3, username: '张老师', avatar: '',
  province: 'shanghai', school: '示例大学', grade: 'freshman', gender: 'female',
  subjects: ['math'], gaokao_scores: [], price_min: 100, price_max: 200,
  teaching_method: 'online', time_slots: [], rating: 4.5, verified: 0,
  intro: '认真负责，耐心细致',
};
const demand = {
  id: 1, display_id: 1, user_id: 2, username: '学生小李', avatar: '',
  province: 'shanghai', student_grade: 'grade10', student_gender: '',
  target_type: 'academic', target_subjects: ['math'], teaching_method: 'offline',
  budget_min: 100, budget_max: 150, expected_time: [], current_scores: [],
  address: '', additional_info: '', status: 'open', my_intent_status: '',
  created_at: '2026-08-01T00:00:00Z', intent_count: 0, pending_intents: 0,
  submitter_type: 'student',
};
const conv = {
  id: 1, student_user_id: 9, student_name: '学生小李', teacher_user_id: 3, teacher_name: '张老师',
  last_body: '你好，请问周末有空吗', last_kind: 'text', last_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z', unread_count: 0, status: 'active',
};
const msg = { id: 1, sender_user_id: 9, kind: 'text', body: '你好', created_at: '2026-08-01T00:00:00Z' };
const contract = {
  id: 1, student_user_id: 9, student_name: '学生小李', teacher_user_id: 3, teacher_name: '张老师',
  drafter_user_id: 3, status: 'signing', method: 'online', hourly_rate: 120,
  demand_display_id: 1, contract_md: '', prev_business: '', updated_at: '2026-08-01T00:00:00Z',
};
const notif = { id: 1, text: '有新的试课意向，请及时处理', is_read: 0, created_at: '2026-08-01T00:00:00Z' };
const post = { id: 1, title: '高中数学笔记', body_md: '分享一份函数专题笔记', username: '张老师', user_id: 3, like_count: 2, liked: false, created_at: '2026-08-01T00:00:00Z' };

/** Fresh jsdom + globals + mounted shell + fetch stub (endpoint-keyed fixtures).
 *  demandRows is overridable for the B3 sort/filter test. */
function baseSetup({ demandRows = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = MOStub;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.matchMedia = dom.window.matchMedia ? dom.window.matchMedia.bind(dom.window)
    : () => ({ matches: false, addEventListener: () => {} });
  globalThis.CustomEvent = dom.window.CustomEvent; // about.js dispatches a bare CustomEvent; jsdom dispatch needs its own realm instance
  // rAF backed by unref'd timers so the R27 follow loop never holds the event loop
  globalThis.requestAnimationFrame = cb => { const t = setTimeout(cb, 16); if (t && typeof t.unref === 'function') t.unref(); };
  globalThis.cancelAnimationFrame = () => {};
  setEnsureAuth(() => true);
  _dhResetForTests();
  closeAllModals();
  state.user = null; state.guestRole = null; state.page = null;
  state.myDemands = []; state.browseDemands = []; state.allTeachers = []; state.myContracts = [];
  chat.convId = null; chat.list = []; chat.staged = []; chat.lastMsgId = 0; chat.pollTimer = null; chat.pendingOpen = null;
  mountShell(); // #view-landing + #view-client + per-page sections + #modal-container + #toast-container
  const fetched = [];
  const demands = demandRows || [demand];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    fetched.push({ u, method });
    if (u === '/api/teachers') return { ok: true, status: 200, json: async () => ({ teachers: [teacher] }) };
    if (u === '/api/users/3') return { ok: true, status: 200, json: async () => ({ user: { id: 3, username: '张老师', role: 'teacher', avatar: '' } }) };
    if (/^\/api\/reviews\?teacherUserId=/.test(u)) return { ok: true, status: 200, json: async () => ({ reviews: [] }) };
    if (/^\/api\/teacher\/awards\?userId=/.test(u)) return { ok: true, status: 200, json: async () => ({ awards: [] }) };
    if (u.includes('/api/student/demands')) return { ok: true, status: 200, json: async () => ({ demands }) };
    if (u === '/api/demand-pushes') return { ok: true, status: 200, json: async () => ({ pushes: [] }) };
    if (u === '/api/demands/1/intents') return { ok: true, status: 200, json: async () => ({ teachers: [] }) };
    if (u === '/api/conversations') return { ok: true, status: 200, json: async () => ({ conversations: [conv] }) };
    if (u === '/api/conversations/1/messages') return { ok: true, status: 200, json: async () => ({ messages: [msg] }) };
    if (u === '/api/contracts/my') return { ok: true, status: 200, json: async () => ({ contracts: [contract] }) };
    if (u === '/api/notifications') return { ok: true, status: 200, json: async () => ({ notifications: [notif] }) };
    if (u === '/api/posts?sort=new') return { ok: true, status: 200, json: async () => ({ posts: [post] }) };
    if (u === '/api/data-version') return { ok: true, status: 200, json: async () => ({ versions: {} }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { dom, fetched };
}

function teardown() {
  try { skipTour(); } catch { /* window already gone */ } // remove any active overlay + demo injections + listeners
  stopVersionProbe();
  stopBadgePoll();
  stopChatPolling();
  chatTeardown();
  if (typeof document !== 'undefined') closeAllModals();
  setEnsureAuth(null);
  delete globalThis.fetch;
  delete globalThis.MutationObserver;
  delete globalThis.getComputedStyle;
  delete globalThis.matchMedia;
  delete globalThis.CustomEvent;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  delete globalThis.document; delete globalThis.window;
  state.user = null; state.guestRole = null; state.page = null; state.view = 'landing';
  state.myDemands = []; state.browseDemands = []; state.allTeachers = []; state.myContracts = [];
  chat.convId = null; chat.list = []; chat.staged = []; chat.lastMsgId = 0; chat.pollTimer = null; chat.pendingOpen = null;
}

/** Run all feature onLoad (fills router registerPage + data-action delegation); return uninstall fns. */
function installAll() {
  return [authFeature, regionFeature, postsFeature, complaintsFeature, contractFeature,
    chatFeature, teacherFeature, studentFeature, settingsFeature, adminFeature,
    notifFeature, onboardFeature]
    .map(f => (f && typeof f.onLoad === 'function' ? f.onLoad() : () => {}));
}

/** t.after cleanup that runs even on assertion failure -- prevents the installed-flag deadlock cascade. */
function registerCleanup(t, uninstall) {
  t.after(() => { try { uninstall.forEach(f => f()); } finally { teardown(); } });
}

/** Enter the client shell with a given identity/role and settle the initial page. */
async function setupClient(t, { user = null, guestRole = null, page = null } = {}) {
  const { dom, fetched } = baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  globalThis.localStorage.setItem('sufe_returning', '1'); // shield the first-visit modal
  state.user = user;
  state.guestRole = guestRole;
  renderSidebar();
  showView('client');
  if (page) await selectPage(page);
  await tick(40);
  return { dom, fetched };
}

function waitFor(fn, timeoutMs = 9000) {
  const start = Date.now();
  return new Promise(resolve => {
    const poll = () => {
      if (fn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 15);
    };
    poll();
  });
}

/** Count interactive steps per module (the 'end' module is not counted). */
function moduleCounts(steps) {
  const counts = {};
  for (let raw of steps) {
    while (typeof raw === 'function') raw = raw();
    if (!raw || !raw.module || raw.module === 'end') continue;
    counts[raw.module] = (counts[raw.module] || 0) + 1;
  }
  return counts;
}

const expand = raw => { let st = raw; while (typeof st === 'function') st = st(); return st; };

/** Walk a script end-to-end: wait for the bubble text + placed hole, click to advance.
 *  Page-target steps get a jsdom timing compensation (manual selectPage if the
 *  pass-through click did not switch the page synchronously). Demo chat/contract
 *  injection is asserted for the two logged-in scripts. */
async function walkScript(t, dom, scriptName) {
  const doc = dom.window.document;
  const rawSteps = TOUR_SCRIPTS[scriptName]();
  runTour(scriptName);
  const stepOf = i => { let s = rawSteps[i]; while (typeof s === 'function') s = s(); return s; };
  const hasDemo = scriptName === 'teacherUser' || scriptName === 'studentUser';
  let i = 0;
  const t0 = Date.now();
  while (i < rawSteps.length && Date.now() - t0 < 30000) {
    const cur = stepOf(i);
    if (cur.skip) { i++; continue; } // engine auto-advances skipped steps (no hole)
    if (cur.retry) {
      await waitFor(() => { const c = stepOf(i); return !c.retry && !c.skip; }, 6000);
      continue;
    }
    if (hasDemo && cur.target && cur.target.sel === '#my-chats-list .conv-item') {
      // Demo conversation: tourStepMyChats calls _tourDemoChatEnsure while _tourActive is
      // still false (script factory runs before runTour sets the flag), so the injection
      // actually happens when tourStepConvItem evaluates during the live tour -- assert it
      // at the conv-item step where the demo row is the load-bearing target.
      const demoOk = await waitFor(() => doc.querySelector('#my-chats-list .tour-demo-conv'), 9000);
      assert.ok(demoOk, `${scriptName} step ${i + 1}: demo conversation injected`);
    }
    if (hasDemo && cur.target && cur.target.sel === '#my-contracts-list .list-card') {
      const demoOk = await waitFor(() => doc.querySelector('#my-contracts-list .tour-demo-contract'), 9000);
      assert.ok(demoOk, `${scriptName} step ${i + 1}: demo contract injected`);
    }
    const ok = await waitFor(() => {
      const b = doc.querySelector('.tour-bubble-text');
      const c = stepOf(i);
      return b && c && !c.skip && !c.retry && b.textContent === c.text && doc.querySelector('.tour-hole--show');
    }, 9000);
    assert.ok(ok, `${scriptName} step ${i + 1}/${rawSteps.length} hole placed (${cur.module}: ${(cur.text || '').slice(0, 18)}...)`);
    doc.querySelector('.tour-hole').click();
    await tick(20);
    // jsdom timing compensation: a page-target step's pass-through click may not switch
    // the page synchronously (async render race) -- select manually + settle.
    const wantedPage = cur.target && cur.target.page;
    if (wantedPage && state.page !== wantedPage) {
      await selectPage(wantedPage);
      await tick(40);
    }
    if (hasDemo && cur.target && cur.target.sel === '#my-chats-list .conv-item') {
      const frOk = await waitFor(() => doc.querySelector('#chat-frame .chat-messages'), 4000);
      assert.ok(frOk, `${scriptName}: chat frame rendered after conv item click`);
    }
    i++;
  }
  assert.equal(i, rawSteps.length, `${scriptName} walked all ${rawSteps.length} steps`);
  await waitFor(() => !doc.querySelector('.tour-overlay'), 3000);
  assert.equal(doc.querySelector('.tour-overlay'), null, `${scriptName} overlay removed after last step`);
}

// ---- engine stepping ----

test('runTour step progression: click hole -> next step (real click pass-through to sidebar tab)', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  runTour([
    { target: { page: 'browse-teachers' }, text: 'First step' },
    { target: { page: 'about' }, text: 'Second step' },
  ]);
  assert.ok(doc.querySelector('.tour-overlay'), 'overlay mounted');
  assert.ok(doc.querySelector('.tour-hole--show'), 'hole placed');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'First step', 'initial bubble');
  assert.ok(doc.querySelector('.tour-global-skip'), 'global skip button present whole tour');
  assert.equal(doc.querySelector('.tour-global-skip').textContent, TEXT.TOUR_SKIP_GLOBAL, 'skip text from constants');
  assert.equal(doc.querySelector('.tour-skip-btn'), null, 'no in-bubble skip button (removed with v1)');

  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'Second step', 'advance on hole click');
  assert.ok(doc.querySelector('.tour-hole--show'), 'second step hole placed');
  assert.equal(state.page, 'browse-teachers', 'pass-through click really switched the page');
});

test('closeModal step: hole resolves to the modal body and click auto-closes', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  openModal({ title: 'Test modal', body: 'content' });
  assert.ok(doc.querySelector('#modal-container .modal-overlay .modal'), 'modal open');
  runTour([
    { target: { closeModal: true }, text: 'Close modal' },
    { target: { page: 'about' }, text: 'After' },
  ]);
  const placed = await waitFor(() => doc.querySelector('.tour-hole--show'), 3000);
  assert.ok(placed, 'closeModal target resolved (hole on modal body)');
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, 'modal auto-closed on advance');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'After', 'advanced to next step');
});

test('unmounted target: waits inside .hidden ancestor; timeout auto-skips missing target', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  // case 1: target inside a .hidden ancestor -> rAF poll, place once revealed
  const wrap = document.createElement('div');
  wrap.className = 'hidden';
  const t1 = document.createElement('div');
  t1.id = 'wait-target';
  wrap.appendChild(t1);
  document.body.appendChild(wrap);
  runTour([
    { target: { sel: '#wait-target' }, text: 'Wait for target' },
    { target: { page: 'about' }, text: 'After' },
  ]);
  assert.equal(doc.querySelector('.tour-hole--show'), null, 'hidden ancestor: hole not placed');
  wrap.classList.remove('hidden');
  await tick(80);
  assert.ok(doc.querySelector('.tour-hole--show'), 'revealed target: hole placed');
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'After', 'advanced after reveal');

  // case 2: missing target -> timeout auto-skip to the next step
  const prevTimeout = CONFIG.TOUR_TARGET_TIMEOUT_MS;
  CONFIG.TOUR_TARGET_TIMEOUT_MS = 80;
  t.after(() => { CONFIG.TOUR_TARGET_TIMEOUT_MS = prevTimeout; });
  runTour([
    { target: { sel: '#definitely-not-here' }, text: 'Missing target' },
    { target: { page: 'about' }, text: 'After timeout' },
  ]);
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'Missing target');
  await tick(240); // rAF poll + 80ms timeout
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, 'After timeout', 'timeout auto-skip');
});

test('global skip button: visible whole tour, click ends it', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  runTour([
    { target: { page: 'browse-teachers' }, text: 'First step' },
    { target: { page: 'about' }, text: 'Second step' },
  ]);
  assert.ok(doc.querySelector('.tour-overlay'), 'tour running');
  doc.querySelector('.tour-global-skip').click();
  await tick(10);
  assert.equal(doc.querySelector('.tour-overlay'), null, 'global skip ends the tour');
  assert.equal(doc.querySelector('.tour-bubble-pos'), null, 'bubble torn down with the overlay');
});

test('startOnboardingTour picks the script by login state + role', async (t) => {
  const { dom } = await setupClient(t);
  const doc = dom.window.document;
  globalThis.localStorage.setItem('sufe_returning', '1');

  // student logged in -> studentUser (first step = my demands)
  state.user = { role: 'student', id: 9, username: 's', avatar: '' };
  state.guestRole = null;
  renderSidebar(); showView('client');
  await selectPage('my-demands');
  await tick(40);
  startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, TEXT.TOUR_STEP_MY_DEMANDS, 'student -> studentUser');
  let ctx = onboardContext();
  assert.equal(ctx.loggedIn, true, 'student context logged in');
  assert.equal(ctx.role, 'student', 'student context role');
  skipTour();

  // teacher guest -> teacherGuest (first step = browse demands)
  state.user = null;
  state.guestRole = 'teacher';
  renderSidebar(); showView('client');
  await selectPage('browse-demands');
  await tick(40);
  startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, TEXT.TOUR_STEP_BROWSE_DEMANDS, 'teacher guest -> teacherGuest');
  ctx = onboardContext();
  assert.equal(ctx.loggedIn, false, 'guest context not logged in');
  assert.equal(ctx.role, 'teacher', 'guest context role');
  skipTour();

  // admin -> admin script (moderation console)
  state.user = { role: 'admin', id: 9, username: 'a', avatar: '' };
  state.guestRole = null;
  renderSidebar(); showView('client');
  await selectPage('admin-stats');
  await tick(40);
  startOnboardingTour();
  assert.ok(doc.querySelector('.tour-overlay'), 'admin tour mounted');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, TEXT.TOUR_STEP_ADMIN_STATS, 'admin -> admin script');
  skipTour();
});

test('revisit entry migrated: no sidebar button, only the about page keeps it', async (t) => {
  const { dom } = await setupClient(t, { user: { role: 'student', id: 9, username: 's', avatar: '' } });
  const doc = dom.window.document;
  assert.equal(doc.querySelector('.sidebar-revisit-btn'), null, 'no revisit button in the sidebar user bar');
  assert.equal(doc.querySelector('.tour-revisit-btn'), null, 'no leftover revisit button class anywhere');
  await selectPage('about');
  await tick(40);
  const revisitBtns = [...doc.querySelectorAll('#about-content button')]
    .filter(b => b.textContent.includes(TEXT.ONBOARD_REVISIT_BTN));
  assert.equal(revisitBtns.length, 1, `about page has exactly one revisit entry (got ${revisitBtns.length})`);
});

test('every module has >= 3 interactive steps per script (hard depth requirement)', () => {
  const expected = {
    teacherGuest: ['browse-demands', 'browse-teachers', 'resource-share', 'about'],
    studentGuest: ['browse-teachers', 'about'],
    teacherUser: ['browse-demands', 'browse-teachers', 'resource-share', 'my-chats', 'my-contracts', 'notifications', 'account-settings', 'about'],
    studentUser: ['my-demands', 'browse-teachers', 'my-chats', 'my-contracts', 'notifications', 'account-settings', 'about'],
  };
  for (const [name, modules] of Object.entries(expected)) {
    const steps = TOUR_SCRIPTS[name]();
    const counts = moduleCounts(steps);
    for (const m of modules) {
      assert.ok(counts[m] >= 3, `${name} module ${m} has ${counts[m] || 0} steps (need >= 3)`);
    }
    for (const m of Object.keys(counts)) {
      assert.ok(modules.includes(m), `${name} must not contain module ${m}`);
    }
  }
});

test('script integrity: non-empty, valid target shape, page ids registered, last step self', (t) => {
  baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  const pageIds = new Set();
  const combos = [
    { user: { role: 'student', id: 1, username: 's' }, guestRole: null },
    { user: { role: 'teacher', id: 1, username: 't' }, guestRole: null },
    { user: { role: 'admin', id: 1, username: 'a' }, guestRole: null },
    { user: null, guestRole: 'student' },
    { user: null, guestRole: 'teacher' },
  ];
  for (const c of combos) { state.user = c.user; state.guestRole = c.guestRole; pagesForRole().forEach(p => pageIds.add(p.id)); }
  const scripts = {
    teacherGuest: TOUR_SCRIPTS.teacherGuest(),
    studentGuest: TOUR_SCRIPTS.studentGuest(),
    teacherUser: TOUR_SCRIPTS.teacherUser(),
    studentUser: TOUR_SCRIPTS.studentUser(),
    admin: TOUR_SCRIPTS.admin(),
  };
  for (const [name, steps] of Object.entries(scripts)) {
    assert.ok(steps.length > 0, `${name} non-empty`);
    steps.forEach((raw, i) => {
      const s = expand(raw);
      assert.ok(s.text && s.text.length > 0, `${name} step ${i + 1} has text`);
      assert.ok(s.module, `${name} step ${i + 1} has module`);
      const tgt = s.target || {};
      const shape = Object.keys(tgt).length === 1 && (tgt.page || tgt.sel || tgt.closeModal === true || tgt.self === true);
      assert.ok(shape, `${name} step ${i + 1} target shape valid`);
      if (tgt.page) assert.ok(pageIds.has(tgt.page), `${name} step ${i + 1} page registered: ${tgt.page}`);
      if (tgt.sel) assert.ok(typeof tgt.sel === 'string' && /^[.#]/.test(tgt.sel), `${name} step ${i + 1} sel valid: ${tgt.sel}`);
    });
  }
  assert.equal(expand(scripts.teacherGuest[scripts.teacherGuest.length - 1]).target.self, true, 'teacherGuest last step self');
  assert.equal(expand(scripts.studentGuest[scripts.studentGuest.length - 1]).target.self, true, 'studentGuest last step self');
  assert.equal(expand(scripts.teacherUser[scripts.teacherUser.length - 1]).target.self, true, 'teacherUser last step self');
  assert.equal(expand(scripts.studentUser[scripts.studentUser.length - 1]).target.self, true, 'studentUser last step self');
  assert.equal(scripts.admin.length, 3, 'admin script is exactly 3 steps');
});

// ---- full walk-throughs ----
test('teacherGuest full walk-through: demand hall -> teacher peers -> resource share -> about -> login step', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'teacher' });
  await walkScript(t, dom, 'teacherGuest');
});

test('studentGuest full walk-through: teacher plaza -> about -> login step', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  await walkScript(t, dom, 'studentGuest');
});

test('teacherUser full walk-through: every module deep + demo chat/contract + final user bar', async (t) => {
  const { dom } = await setupClient(t, { user: { role: 'teacher', id: 3, username: 't', avatar: '' } });
  await walkScript(t, dom, 'teacherUser');
});

test('studentUser full walk-through: my demands -> teacher plaza (push) -> rest + demo chat/contract + user bar', async (t) => {
  const { dom } = await setupClient(t, { user: { role: 'student', id: 9, username: 's', avatar: '' } });
  await walkScript(t, dom, 'studentUser');
});

// ---- first-visit modal + interception ----

test('first-visit modal: summarized policy + role-dependent primary button', (t) => {
  baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  const doc = globalThis.document;
  assert.ok(TEXT.ONBOARD_POLICY.length <= 4, `simplified policy <= 4 items (got ${TEXT.ONBOARD_POLICY.length})`);
  openOnboarding(); // guest: no user/guestRole set
  const bodyText = doc.querySelector('#modal-container .modal-body').textContent;
  assert.ok(bodyText.includes('学生：发布需求'), 'student basic flow mentioned');
  assert.ok(bodyText.includes('教师：浏览需求'), 'teacher basic flow mentioned');
  assert.ok(bodyText.includes('我的会话'), 'in-app chat/signing mentioned');
  assert.ok(doc.querySelector('#modal-container [data-action="onboard.browseGuest"]'), 'guest primary = browse the client');
  closeAllModals();
  state.user = { role: 'student', id: 9, username: 's' };
  openOnboarding(); // logged in
  assert.ok(doc.querySelector('#modal-container [data-action="onboard.close"]'), 'logged-in primary = dismiss');
  closeAllModals();
});

test('pass:false interception: intent CTA does not pass through the real request', async (t) => {
  const { dom, fetched } = await setupClient(t, { user: { role: 'teacher', id: 3, username: 't', avatar: '' }, page: 'browse-demands' });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('#browse-demands-list .btn-intent-cta'), 3000);
  runTour([
    { module: 'x', target: { sel: '#browse-demands-list .btn-intent-cta' }, text: 'Intent', pass: false },
    { module: 'x', target: { page: 'about' }, text: 'After' },
  ]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  doc.querySelector('.tour-hole').click();
  await tick(20);
  const intentPosts = fetched.filter(f => f.u === '/api/demands/1/intents' && f.method === 'POST');
  assert.equal(intentPosts.length, 0, 'pass:false does not fire the intent request');
  // contrast: pass-through steps still click for real (page switch)
  doc.querySelector('.tour-hole').click(); // about tab
  await tick(20);
  assert.equal(state.page, 'about', 'pass-through step really switches the page');
});

test('pass:false interception: notif block switch is not toggled', async (t) => {
  const { dom } = await setupClient(t, { user: { role: 'teacher', id: 3, username: 't', avatar: '' }, page: 'notifications' });
  const doc = dom.window.document;
  globalThis.localStorage.removeItem(CONFIG.NOTIF_BLOCK_KEY);
  await waitFor(() => doc.querySelector('#btn-notif-block'), 3000);
  runTour([
    { module: 'notifications', target: { sel: '#btn-notif-block' }, text: 'Block', pass: false },
    { module: 'notifications', target: { page: 'about' }, text: 'After' },
  ]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(globalThis.localStorage.getItem(CONFIG.NOTIF_BLOCK_KEY), null, 'preference switch not toggled by pass:false');
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(state.page, 'about', 'pass-through step still switches');
});

test('teacher username step: hole targets the whole card, not the name text', async (t) => {
  const steps = TOUR_SCRIPTS.teacherGuest();
  const step = steps.find(s => s.text === TEXT.TOUR_STEP_TEACHER_USERNAME);
  assert.ok(step, 'teacher username step exists');
  assert.equal(step.target.sel, '#browse-teachers-list .list-card--teacher', 'hole covers the whole card');
  const { dom } = await setupClient(t, { guestRole: 'student', page: 'browse-teachers' });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('#browse-teachers-list .list-card--teacher'), 3000);
  const card = doc.querySelector('#browse-teachers-list .list-card--teacher');
  assert.ok(card && !card.closest('.hidden'), 'whole card is the resolved target');
});

test('chat + feature bar: four pop items focused one by one (pass:false, no passthrough)', () => {
  const steps = TOUR_SCRIPTS.teacherUser();
  const idx = steps.findIndex(s => s.text === TEXT.TOUR_STEP_CHAT_PLUS);
  assert.ok(idx >= 0, 'chat plus step exists');
  const items = steps.slice(idx + 1, idx + 5);
  assert.equal(items.length, 4, 'four items follow the plus step');
  const texts = [TEXT.TOUR_STEP_CHAT_PLUS_IMAGE, TEXT.TOUR_STEP_CHAT_PLUS_FILE, TEXT.TOUR_STEP_CHAT_PLUS_SIGNING, TEXT.TOUR_STEP_CHAT_PLUS_DRAFT];
  items.forEach((s, i) => {
    assert.equal(s.text, texts[i], `item ${i + 1} text`);
    assert.equal(s.pass, false, 'feature bar items never pass through');
    assert.equal(s.target.sel, `.chat-plus-pop .chat-pop-item:nth-child(${i + 1})`, 'selector points at item N');
  });
});

test('scroll architecture: far target scrolls in, in-band no scroll, edge-visible scrolls to band (jsdom stub)', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  dom.window.__scrolled = 0;
  dom.window.Element.prototype.scrollIntoView = function () { dom.window.__scrolled++; };
  const mk = (id, top, height) => {
    const el = document.createElement('div');
    el.id = id;
    el.getBoundingClientRect = () => ({ top, left: 10, bottom: top + height, right: 200, width: 190, height });
    document.body.appendChild(el);
  };
  mk('scroll-far', 3000, 100); // off-viewport -> must scroll
  runTour([{ module: 'x', target: { sel: '#scroll-far' }, text: 'Far' }]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  assert.equal(dom.window.__scrolled, 1, 'far target scrolled into the band');
  skipTour();
  mk('scroll-near', 300, 90); // center in 30%-70% band + fully visible -> no scroll
  runTour([{ module: 'x', target: { sel: '#scroll-near' }, text: 'Near' }]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  assert.equal(dom.window.__scrolled, 1, 'in-band visible target does not scroll');
  skipTour();
  mk('scroll-edge', 10, 90); // fully visible but center sticks to the viewport top -> scroll to band
  runTour([{ module: 'x', target: { sel: '#scroll-edge' }, text: 'Edge' }]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  assert.equal(dom.window.__scrolled, 2, 'edge-visible target also scrolls into the band');
  skipTour();
});

test('animation stabilization: running ancestor animation delays hole placement', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  dom.window.__animQueries = 0;
  const el = document.createElement('div');
  el.id = 'anim-target';
  el.getAnimations = function () { dom.window.__animQueries++; return dom.window.__animQueries === 1 ? [{ playState: 'running' }] : []; };
  el.getBoundingClientRect = () => ({ top: 20, left: 20, bottom: 80, right: 200, width: 180, height: 60 });
  document.body.appendChild(el);
  runTour([{ module: 'x', target: { sel: '#anim-target' }, text: 'Animating' }]);
  assert.equal(doc.querySelector('.tour-hole--show'), null, 'hole hidden while animation is running');
  await tick(80); // rAF re-check: animation over -> place
  assert.ok(doc.querySelector('.tour-hole--show'), 'hole placed after animation ends');
});

test('R27 dynamic hole binding: target drift repositions the hole, removal hides it', async (t) => {
  const { dom } = await setupClient(t, { guestRole: 'student' });
  const doc = dom.window.document;
  let pos = 20;
  const drift = document.createElement('div');
  drift.id = 'drift-target';
  drift.getBoundingClientRect = () => ({ top: pos, left: pos, bottom: pos + 60, right: pos + 180, width: 180, height: 60 });
  document.body.appendChild(drift);
  runTour([
    { module: 'x', target: { sel: '#drift-target' }, text: 'Drift' },
    { module: 'x', target: { sel: '#drift-2' }, text: 'Next' },
  ]);
  await tick(60);
  const hole = doc.querySelector('.tour-hole');
  assert.ok(hole.classList.contains('tour-hole--show'), 'initial placement');
  assert.ok(hole.style.transform.includes('20px'), `hole at initial position (got ${hole.style.transform})`);
  pos = 120; // target floats in
  await tick(60);
  assert.ok(hole.style.transform.includes('120px'), `hole follows the drift (got ${hole.style.transform})`);
  document.getElementById('drift-target').remove();
  await tick(60);
  assert.equal(doc.querySelector('.tour-hole--show'), null, 'missing target hides the hole');
  // advance to the next step: follow stops, hole re-targets drift-2
  const t2 = document.createElement('div');
  t2.id = 'drift-2';
  t2.getBoundingClientRect = () => ({ top: 300, left: 300, bottom: 360, right: 480, width: 180, height: 60 });
  document.body.appendChild(t2);
  const t1b = document.createElement('div');
  t1b.id = 'drift-target';
  t1b.getBoundingClientRect = () => ({ top: 20, left: 20, bottom: 80, right: 200, width: 180, height: 60 });
  document.body.appendChild(t1b); // rebuild for the last-step pass-through click path
  hole.click();
  await tick(40);
  assert.ok(doc.querySelector('.tour-hole--show'), 'next step hole placed');
  const m2 = doc.querySelector('.tour-hole').style.transform;
  assert.ok(m2.includes('300px'), `next step hole on the new target (got ${m2})`);
});

test('tour CSS rules in place (style.css direct read, no DOM build)', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('.tour-overlay {'), 'overlay stays mounted');
  assert.ok(css.includes('.tour-overlay--dim { background: rgba(17, 17, 20, .28); }'), 'weak dim placeholder while the hole is hidden');
  assert.ok(css.includes('.tour-hole {') && css.includes('transition: opacity .26s ease-out .16s'), 'hole delayed fade-in');
  assert.ok(css.includes('animation-delay: .18s') && css.includes('animation-fill-mode: backwards'), 'bubble delayed entry');
  assert.ok(css.includes('.tour-hole { transition-delay: 0s; }'), 'reduced-motion zeroes the hole delay');
});

// ---- auth wiring ----

test('browseAsGuest: enters guest client then auto-runs the matching tour (studentGuest first step)', async (t) => {
  const { dom } = baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  globalThis.localStorage.removeItem('sufe_returning');
  await browseAsGuest('student');
  await tick(250);
  const doc = dom.window.document;
  const st = {
    tour: !!doc.querySelector('.tour-overlay'),
    view: state.view,
    guestRole: state.guestRole,
    firstText: (doc.querySelector('.tour-bubble-text') || {}).textContent || '',
  };
  assert.equal(st.guestRole, 'student', 'guest role entered');
  assert.equal(st.view, 'client', 'client view rendered');
  assert.equal(st.tour, true, 'tour layer mounted (not immediately torn down by _tourInClientView)');
  assert.ok(st.firstText.includes('教师广场'), `first step = studentGuest teacher plaza (got ${st.firstText.slice(0, 20)})`);
});

test('afterAuthSuccess(true): new registration auto-runs the tour (studentUser first step)', async (t) => {
  const { dom } = baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  state.user = { id: 9, role: 'student', username: 's', avatar: '' };
  state.authToken = 'tok';
  await afterAuthSuccess(true);
  await tick(300);
  const doc = dom.window.document;
  const st = {
    tour: !!doc.querySelector('.tour-overlay'),
    view: state.view,
    firstText: (doc.querySelector('.tour-bubble-text') || {}).textContent || '',
  };
  assert.equal(st.view, 'client', 'client view');
  assert.equal(st.tour, true, 'new registration auto-runs the tour');
  assert.ok(st.firstText.includes('我的需求'), `first step = studentUser my demands (got ${st.firstText.slice(0, 20)})`);
});

test('afterAuthSuccess() (login): does not auto-run the tour', async (t) => {
  const { dom } = baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  state.user = { id: 9, role: 'student', username: 's', avatar: '' };
  state.authToken = 'tok';
  await afterAuthSuccess();
  await tick(300);
  const doc = dom.window.document;
  assert.equal(state.view, 'client', 'client view');
  assert.equal(doc.querySelector('.tour-overlay'), null, 'plain login does not run the tour');
});

// ---- B1/B2/B3 (BLOCKING regression fixes) ----

test('B1 boot wiring: showOnboardingIfNeeded first-visit semantics + app.js call site', (t) => {
  baseSetup();
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  const doc = globalThis.document;
  globalThis.localStorage.removeItem('sufe_returning');
  showOnboardingIfNeeded();
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), 'first visit: onboarding modal opens');
  assert.equal(globalThis.localStorage.getItem('sufe_returning'), '1', 'first visit marker written');
  closeAllModals();
  showOnboardingIfNeeded(); // returning now -> no-op
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, 'returning visit: no modal');
  const src = readFileSync('src/client/app.js', 'utf8');
  assert.ok(src.includes('showOnboardingIfNeeded()'), 'app.js boot calls showOnboardingIfNeeded');
});

test('B2 about page revisit entries: real clicks open usage guide modal + start the tour overlay', async (t) => {
  const { dom } = await setupClient(t, { user: { role: 'student', id: 9, username: 's', avatar: '' }, page: 'about' });
  const doc = dom.window.document;
  await waitFor(() => doc.querySelector('#about-content [data-action="about-usage-guide"]'), 3000);
  // real click: usage guide modal
  doc.querySelector('#about-content [data-action="about-usage-guide"]').click();
  await tick(20);
  const modal = doc.querySelector('#modal-container .modal-overlay');
  assert.ok(modal, 'usage guide modal opens on click');
  assert.equal(doc.querySelector('#modal-container .modal-header h2').textContent, TEXT.USAGE_GUIDE_TITLE, 'modal title');
  assert.ok(TEXT.USAGE_GUIDE_SECTIONS.length > 0, 'usage guide has sections');
  assert.ok(doc.querySelectorAll('#modal-container .usage-guide-section').length === TEXT.USAGE_GUIDE_SECTIONS.length, 'all sections rendered');
  closeAllModals();
  // real click: revisit tour -> overlay mounts with the studentUser first step
  doc.querySelector('#about-content [data-action="about-revisit-tour"]').click();
  await tick(30);
  assert.ok(doc.querySelector('.tour-overlay'), 'revisit tour mounts the overlay');
  const firstText = (doc.querySelector('.tour-bubble-text') || {}).textContent || '';
  assert.ok(firstText.includes('我的需求'), `revisit tour starts studentUser (got ${firstText.slice(0, 20)})`);
  skipTour();
});

test('B3 browse-demands sort/filter controls: change re-renders locally, no new network', async (t) => {
  const demandA = { ...demand, id: 1, created_at: '2026-08-01T00:00:00Z' };
  const demandB = { ...demand, id: 2, created_at: '2026-08-05T00:00:00Z', target_subjects: ['english'] };
  const { dom, fetched } = baseSetup({ demandRows: [demandA, demandB] });
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  const doc = dom.window.document;
  state.user = { role: 'teacher', id: 3, username: 't', avatar: '' };
  state.guestRole = null;
  renderSidebar();
  showView('client');
  state.page = 'browse-demands';
  await loadBrowseDemands();
  await tick(40);
  const demandFetchCount = () => fetched.filter(f => f.u.includes('/api/student/demands')).length;
  const before = demandFetchCount();
  assert.ok(before >= 1, 'browse list loaded from the network');
  const list = doc.getElementById('browse-demands-list');
  assert.ok(list.querySelectorAll('.list-card--demand').length === 2, 'two demand cards rendered');
  const htmlBefore = list.innerHTML;

  // sort control: re-render in place, no loader / no network
  const sort = doc.getElementById('demand-sort');
  sort.value = 'newest';
  sort.dispatchEvent(new dom.window.Event('change', { bubbles: true })); // data-change delegation lives on document
  await tick(20);
  assert.notEqual(list.innerHTML, htmlBefore, 'list re-rendered in place on sort change');
  assert.equal(demandFetchCount(), before, 'no new demands request on sort change');
  assert.ok(list.querySelectorAll('.list-card--demand').length === 2, 'sort keeps both cards');

  // subject filter: local filter, no network
  const subj = doc.getElementById('demand-filter-subject');
  subj.value = 'math';
  subj.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(20);
  assert.equal(demandFetchCount(), before, 'no new demands request on subject filter change');
  assert.equal(list.querySelectorAll('.list-card--demand').length, 1, 'subject filter keeps only math demands');
  assert.ok(!list.textContent.includes('english'), 'non-math demand filtered out');
});
