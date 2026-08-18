/**
 * v2 tour engine (ESM port of v1 app-onboard.js step layer).
 *
 * Design: multi-step interactive layer over the client shell.
 *   - Target shapes: { page } sidebar tab / { sel } any selector / { closeModal }
 *     current modal (onAdvance closes) / { self } sidebar user bar.
 *   - Unmounted targets (page async load): rAF poll until present and not under a
 *     .hidden ancestor (display:none), then skip after CONFIG.TOUR_TARGET_TIMEOUT_MS.
 *   - Hole follows: window resize / scroll (capture + passive) repositions.
 *   - Z-order: .tour-overlay above modal / sidebar backdrop; the dim is drawn by the
 *     hole box-shadow (true aperture, target stays clickable). The bubble is a
 *     backdrop-filter subtree: entry uses a pure-transform animation (no transition —
 *     Chromium 983252 freezes the first frame).
 *   - Class prefix .tour-: never hit by scoped descendant selectors of forms/modals.
 *   - No inline handlers (archtest): the global skip button gets a direct listener
 *     (the overlay click handler stopPropagation would swallow document delegation).
 * Demo chat/contract: tours inject a demo conversation / contract card while the
 * tour is active so fresh accounts can be walked through the components; both are
 * removed by _tourCleanup. The demo conversation does NOT set chat.convId (avoids
 * the page-leave read-mark POST to a bogus id); a private flag tracks it instead.
 * Register a script registry via setTourScripts (tours.js), called from actions.js.
 */
import { TEXT } from './text.js';
import { CONFIG } from '../../../shared/config.js';
import { state, isReturning, registerLogoutReset } from '../../core/state.js';
import { escHtml } from '../../core/dom.js';
import { closeModal } from '../../core/ui.js';
import { chat } from '../chat/chat-state.js';
import { stopChatPolling } from '../chat/actions-list.js';
import { closeChatPlus } from '../chat/actions-misc.js';
import { renderChatFrame, renderChatPlaceholder } from '../chat/render.js';

let _tourActive = false;
let _tourSteps = [];
let _tourIdx = 0;
let _tourEls = null; // { overlay, hole, pos, bubble }
let _tourScripts = {};
let _tourDemoDisabled = false;
let _tourDemoConvOpen = false;

/** Register the script table (tours.js) — avoids an engine<->tours import cycle. */
export function setTourScripts(scripts) { _tourScripts = scripts || {}; }

/** Resolve the tour context: login state + role + first-visit flag. */
export function onboardContext() {
  return {
    loggedIn: !!state.user,
    role: state.user ? state.user.role : (state.guestRole || null),
    firstVisit: !isReturning(),
  };
}

/** Resolve a step target; null when unmounted or inside a .hidden ancestor.
 *  closeModal steps point at the modal body (.modal), not the full-screen overlay —
 *  pointing at the overlay makes the hole cover the viewport and pushes the dim off
 *  screen. Custom selects: the native select is wrapped into .custom-select and
 *  hidden; target the visible .custom-select-trigger instead (click opens the pop). */
function _tourResolve(step) {
  const t = step.target || {};
  let el = null;
  if (t.page) el = document.querySelector(`#sidebar-nav .sidebar-item[data-page="${t.page}"]`);
  else if (t.sel) el = document.querySelector(t.sel);
  else if (t.closeModal) el = document.querySelector('#modal-container .modal-overlay .modal');
  else if (t.self) el = document.querySelector('#sidebar-user .sidebar-user-top');
  if (el && el.classList.contains('hidden') && el.matches('select') && el.closest('.custom-select')) {
    const trig = el.closest('.custom-select').querySelector('.custom-select-trigger');
    if (trig) el = trig;
  }
  return el && !el.closest('.hidden') ? el : null;
}

/** Mount the tour layer: overlay stays mounted (click interception), hole/bubble are
 *  rebuilt per step. The global skip button (fixed, above everything) lives for the
 *  whole tour; aria-hidden hides the app content from AT while active (not inert —
 *  inert would block the programmatic .click() pass-through). */
function _tourMount() {
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', TEXT.TOUR_ARIA_LABEL);
  overlay.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble-pos"></div>';
  document.body.appendChild(overlay);
  _tourEls = {
    overlay,
    hole: overlay.querySelector('.tour-hole'),
    pos: overlay.querySelector('.tour-bubble-pos'),
    bubble: null,
  };
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'tour-global-skip';
  skipBtn.textContent = TEXT.TOUR_SKIP_GLOBAL;
  skipBtn.addEventListener('click', e => { e.stopPropagation(); skipTour(); });
  overlay.appendChild(skipBtn);
  overlay.addEventListener('click', _tourOverlayClick);
  const appRoot = document.getElementById('app');
  if (appRoot) appRoot.setAttribute('aria-hidden', 'true');
}

/** Render the current step bubble (innerHTML rebuild replays the entry animation
 *  every step). No .glass base class: it carries transform transition + hover lift
 *  that freeze on a backdrop-filter subtree; the bubble owns its glass look via the
 *  same CSS-variable recipe as .modal. */
function _tourShowBubble(text) {
  const pos = _tourEls.pos;
  pos.innerHTML = `<div class="tour-bubble">
    <p class="tour-bubble-text">${escHtml(text)}</p>
  </div>`;
  _tourEls.bubble = pos.querySelector('.tour-bubble');
}

/** Position the hole: JS only toggles classes + transform placement (width/height
 *  are geometry following the target). */
function _tourPlace(el) {
  const rect = el.getBoundingClientRect();
  const hole = _tourEls.hole;
  _tourEls.overlay.classList.remove('tour-overlay--dim'); // hole visible: drop the dim placeholder
  hole.classList.add('tour-hole--show');
  hole.style.width = `${rect.width}px`;
  hole.style.height = `${rect.height}px`;
  hole.style.transform = `translate(${rect.left}px, ${rect.top}px)`; // fixed positioning
  _tourPlaceBubble(rect);
}

/** Hide the hole while waiting for a target. */
function _tourHideHole() {
  _tourEls.hole.classList.remove('tour-hole--show');
  _tourEls.overlay.classList.add('tour-overlay--dim'); // weak dim placeholder while hidden
}

/** Nearest scrollable ancestor = the target's scroll viewport (client-main /
 *  sidebar-scroll scroll internally, not the window). The band check must use the
 *  container height, not window.innerHeight (containers are offset / unequal). */
function _tourScrollViewport(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n === document.documentElement || n === document.scrollingElement || n === document.body) break;
    try {
      const st = getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(st.overflowY) && n.clientHeight > 0) return n;
    } catch (err) { /* ignore */ }
  }
  return document.scrollingElement || document.documentElement;
}

/** Scroll the target into the container's 30%-70% vertical band. The skip condition
 *  is "center in band AND fully visible" — edge-visible (touching the container
 *  border) also scrolls to the band so the hole never sits on the container edge.
 *  block:'center' lands it mid-container (best effort when not centered-able);
 *  behavior:'auto' avoids smooth-scroll racing with hole geometry. */
function _tourScrollToEl(el) {
  if (!el || typeof el.scrollIntoView !== 'function') return; // jsdom has none (zero cost)
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return; // unlaid-out, skip
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vp = _tourScrollViewport(el);
  const vr = vp.getBoundingClientRect();
  const vh = vp.clientHeight || window.innerHeight || 768;
  const top = r.top - vr.top;
  const center = top + (r.bottom - r.top) / 2;
  const bandLo = CONFIG.TOUR_SCROLL_BAND_LO || 0.3;
  const bandHi = CONFIG.TOUR_SCROLL_BAND_HI || 0.7;
  const inBand = center >= vh * bandLo && center <= vh * bandHi;
  const visible = r.top >= vr.top && r.left >= 0 && r.bottom <= vr.top + vh && r.right <= vw;
  if (inBand && visible) return;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); } catch (err) { /* non-blocking */ }
}

/** Any running animation/transition on the target or its ancestor chain. */
function _tourAnimating(el) {
  if (!el || typeof el.getAnimations !== 'function') return false;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    try { if (n.getAnimations().some(a => a.playState === 'running')) return true; } catch (err) { /* ignore */ }
  }
  return false;
}

/** R27: dynamic hole binding — keep following the target geometry after placement
 *  (rAF rect compare, reposition on change). Fixes "hole first, element floats in
 *  later" and post-filter card-shift misplacement: a one-shot placement only covers
 *  targets static at placement time. The follow loop snapshots _tourIdx; step
 *  advance (or cleanup) stops it. A disappearing target (page rebuild gap) hides
 *  the hole and restores it on the next frame. Cost = one rect per frame, zero
 *  writes while geometry is stable. */
function _tourStartFollow(step) {
  const followIdx = _tourIdx;
  let lastKey = '';
  const loop = () => {
    if (!_tourActive || _tourIdx !== followIdx) return;
    if (!_tourInClientView()) { _tourCleanup(); return; }
    const el = _tourResolve(step);
    if (!el) { _tourHideHole(); requestAnimationFrame(loop); return; }
    const r = el.getBoundingClientRect();
    const key = Math.round(r.left) + 'x' + Math.round(r.top) + 'x' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (key !== lastKey) { lastKey = key; _tourPlace(el); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Stable placement: scroll into view -> wait for entry animation -> place hole ->
 *  start dynamic follow. Common path (stable target, no animation) places
 *  synchronously — zero extra frames; only an animating ancestor enters the rAF
 *  wait (capped at 2s so an endless animation cannot wedge the hole). */
function _tourPlaceStable(step) {
  const el = _tourResolve(step);
  if (!el) { _tourHideHole(); return; }
  const scrollEl = (step.scrollTo ? document.querySelector(step.scrollTo) : null) || el;
  _tourScrollToEl(scrollEl);
  if (!_tourAnimating(el) && !_tourAnimating(scrollEl)) { _tourPlace(el); _tourStartFollow(step); return; }
  const deadline = Date.now() + 2000;
  const tick = () => {
    if (!_tourActive) return;
    const cur = _tourResolve(step);
    if (!cur) { _tourHideHole(); return; }
    if (Date.now() < deadline && (_tourAnimating(cur) || _tourAnimating(scrollEl))) { requestAnimationFrame(tick); return; }
    _tourPlace(cur);
    _tourStartFollow(step);
  };
  requestAnimationFrame(tick);
}

/** Bubble placement: beside the target (right -> left -> below -> above), never
 *  overlapping the hole. Final fallback pins to the viewport bottom (the hole is
 *  usually above). .tour-bubble-pos z sits above the hole but is pointer-events:
 *  none — even a tiny-viewport overlap keeps clicks passing through to the hole. */
function _tourPlaceBubble(rect) {
  const pos = _tourEls.pos;
  const gap = CONFIG.TOUR_GAP_PX || 16;
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vh = window.innerHeight || document.documentElement.clientHeight || 768;
  pos.style.transform = 'translate(-9999px,-9999px)'; // off-screen to measure real size
  const bw = _tourEls.bubble.offsetWidth || 300;
  const bh = _tourEls.bubble.offsetHeight || 90;
  let x, y;
  if (rect.right + gap + bw <= vw) {            // right first (top-aligned)
    x = rect.right + gap;
    y = Math.max(8, Math.min(rect.top, vh - bh - 8));
  } else if (rect.left - gap - bw >= 0) {       // then left
    x = rect.left - gap - bw;
    y = Math.max(8, Math.min(rect.top, vh - bh - 8));
  } else if (rect.bottom + gap + bh <= vh) {    // then below (left-aligned, clamped)
    x = Math.max(8, Math.min(rect.left, vw - bw - 8));
    y = rect.bottom + gap;
  } else if (rect.top - gap - bh >= 0) {        // then above
    x = Math.max(8, Math.min(rect.left, vw - bw - 8));
    y = rect.top - gap - bh;
  } else {                                      // tiny viewport: pin bottom (hole above)
    x = 8;
    y = vh - bh - 8;
  }
  pos.style.transform = `translate(${x}px, ${y}px)`;
}

/** Whether the tour is still in the client shell view (logout / switch away loses
 *  placement -> immediate cleanup, no lingering overlay). */
function _tourInClientView() {
  return !!state && state.view === 'client';
}

/** Enter the current step: render bubble -> resolve target (place if ready; else
 *  rAF poll, auto-skip on timeout). */
function _tourStartStep() {
  if (!_tourActive) return;
  if (!_tourInClientView()) { _tourCleanup(); return; }
  try {
    // Functional steps evaluate on arrival (DOM readable after page switch: chsi
    // gate / demo injection). The evaluated result is NOT written back to
    // _tourSteps (keep the raw function) — retry re-evaluates, and the poll loop
    // re-evaluates so an async render can flip the branch.
    const stepOf = () => { let s = _tourSteps[_tourIdx]; while (typeof s === 'function') s = s(); return s; };
    const step = stepOf();
    if (step && step.retry) { // dwell retry: async render not settled yet
      _tourShowBubble(step.text || '');
      _tourHideHole();
      const waitIdx = _tourIdx;
      setTimeout(() => { if (_tourActive && _tourIdx === waitIdx) _tourStartStep(); }, CONFIG.TOUR_RETRY_MS || 350);
      return;
    }
    if (step && step.skip) { _tourNext(); return; } // conditional skip (unverified chsi -> skip form steps)
    if (!step) { _tourCleanup(); return; }
    _tourShowBubble(step.text);
    const el = _tourResolve(step);
    if (el) { _tourPlaceStable(step); return; }
    _tourHideHole();
    const waitStep = _tourIdx;
    const start = Date.now();
    const tick = () => {
      if (!_tourActive || _tourIdx !== waitStep) return;
      if (!_tourInClientView()) { _tourCleanup(); return; }
      if (Date.now() - start > CONFIG.TOUR_TARGET_TIMEOUT_MS) { _tourNext(); return; }
      const cur = stepOf(); // re-evaluate: async render may flip the branch
      if (cur && cur.retry) { _tourHideHole(); requestAnimationFrame(tick); return; }
      const found = cur ? _tourResolve(cur) : null;
      if (found) { _tourPlaceStable(cur); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    console.error('onboarding tour step error', err); // never leave a permanent overlay
    _tourCleanup();
  }
}

/** Advance to the next step (last step ends the tour). */
function _tourNext() {
  if (!_tourActive) return;
  if (_tourIdx >= _tourSteps.length - 1) { _tourCleanup(); return; }
  _tourIdx++;
  _tourStartStep();
}

/** Any click on the layer advances — no "must hit the hole" geometry (layout drift
 *  no longer blocks stepping; a missing target (empty hall / all-contracted) still
 *  advances on any click). Every advance runs the step action (onAdvance + real
 *  click pass-through when the target exists), so real interactions keep happening. */
function _tourOverlayClick(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.target.closest && e.target.closest('.tour-global-skip')) return; // skip button self-handles
  let step = _tourSteps[_tourIdx];
  while (typeof step === 'function') step = step(); // evaluate before advance (pass-through needs the real target)
  if (!step) return;
  if (_tourIdx >= _tourSteps.length - 1) {
    // Last step: cleanup first, then run the action (login/user-bar steps navigate away)
    _tourCleanup();
    _tourAdvanceAction(step);
    return;
  }
  _tourAdvanceAction(step);
  _tourIdx++;
  _tourStartStep();
}

/** Run the current step side effects: onAdvance + real click pass-through
 *  (closeModal steps do not pass through — onAdvance already closed). pass:false
 *  blocks the pass-through: navigation/panel toggles pass (they open the next
 *  page), real requests (intent submit / notif block / save) are intercepted. */
function _tourAdvanceAction(step) {
  const t = step.target || {};
  if (t.closeModal) {
    if (typeof step.onAdvance === 'function') step.onAdvance();
    else closeModal();
    return;
  }
  if (typeof step.onAdvance === 'function') step.onAdvance();
  if (step.pass === false) return;
  const el = _tourResolve(step);
  if (el) { try { el.click(); } catch (err) { /* non-clickable target must not block */ } }
}

/** Reposition on window resize / scroll (capture catches inner scroll containers). */
function _tourReposition() {
  if (!_tourActive) return;
  let step = _tourSteps[_tourIdx];
  while (typeof step === 'function') step = step(); // evaluate (else target undefined hides the hole)
  if (!step) return;
  const el = _tourResolve(step);
  if (el) _tourPlace(el); else _tourHideHole();
}

/** Teardown: remove layer DOM + listeners + aria-hidden, reset run state,
 *  stop demo injection polling and remove demo conv/contract. */
function _tourCleanup() {
  _tourActive = false;
  _tourSteps = [];
  _tourIdx = 0;
  if (_tourEls) {
    _tourEls.overlay.remove();
    _tourEls = null;
    const appRoot = document.getElementById('app');
    if (appRoot) appRoot.removeAttribute('aria-hidden');
  }
  window.removeEventListener('resize', _tourReposition);
  window.removeEventListener('scroll', _tourReposition, { capture: true });
  window.removeEventListener('keydown', _tourKeydown);
  _tourDemoDisabled = true;
  _tourDemoChatCleanup();
  _tourDemoContractCleanup();
}

/** Esc equals "skip" (keyboard reachability of the primary escape hatch). */
function _tourKeydown(e) {
  if (e.key === 'Escape') skipTour();
}

/** Run a tour: nameOrSteps is a script key (TOUR_SCRIPTS) or a raw step array
 *  (tests). Production callers pass hard-coded script names only; page/sel targets
 *  come from constants/registered selectors — no arbitrary input selectors. */
export function runTour(nameOrSteps) {
  _tourCleanup();
  _tourDemoDisabled = false; // reset demo injection for the new tour
  const steps = Array.isArray(nameOrSteps)
    ? nameOrSteps
    : (_tourScripts[nameOrSteps] ? _tourScripts[nameOrSteps]() : null);
  if (!steps || !steps.length) return;
  _tourActive = true;
  _tourSteps = steps;
  _tourIdx = 0;
  _tourMount();
  window.addEventListener('resize', _tourReposition);
  window.addEventListener('scroll', _tourReposition, { passive: true, capture: true });
  window.addEventListener('keydown', _tourKeydown);
  _tourStartStep();
}

/** Skip: global button + Esc share this (single teardown path). */
export function skipTour() { _tourCleanup(); }

/** "Replay the tour" entry: pick the script by login state + role
 *  (admin walks the moderation console; guest scripts only cover visible modules).
 *  Does NOT reset the sufe_returning first-visit marker. */
export function startOnboardingTour() {
  const ctx = onboardContext();
  const script = ctx.loggedIn
    ? (ctx.role === 'admin' ? 'admin' : ctx.role === 'teacher' ? 'teacherUser' : 'studentUser')
    : (ctx.role === 'teacher' ? 'teacherGuest' : 'studentGuest');
  runTour(script);
}

// Logout reset (app-state registerLogoutReset protocol): a tour parked in the
// "waiting for click" state must end immediately on logout — no lingering overlay.
registerLogoutReset(() => { if (_tourActive) skipTour(); });

// ============================================================
// Demo conversation: injected while the tour is active (fresh accounts have no
// conversations, so the chat frame could not be introduced). Polls until the list
// render completes (loader removed — including the empty state, exactly the case
// to inject), then inserts the demo conv at the top. Idempotent via .tour-demo-conv.
// ============================================================
function _tourDemoChatEnsure() {
  if (_tourDemoDisabled || !_tourActive) return; // poll only while a tour is active
  const list = document.getElementById('my-chats-list');
  if (!list || list.querySelector('.tour-demo-conv')) return;
  if (list.querySelector('.loader')) {
    setTimeout(_tourDemoChatEnsure, 200);
    return;
  }
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();
  const teacherView = state.user && state.user.role === 'teacher';
  const demoName = teacherView ? TEXT.TOUR_DEMO_CHAT_NAME_TEACHER : TEXT.TOUR_DEMO_CHAT_NAME_STUDENT;
  const demoRole = teacherView ? TEXT.CHAT_ROLE_STUDENT : TEXT.CHAT_ROLE_TEACHER;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'conv-item tour-demo-conv';
  btn.setAttribute('data-conv-id', 'demo');
  btn.innerHTML = `
    <span class="conv-item-top">
      <span class="conv-item-name">${escHtml(demoName)}</span>
      <span class="conv-item-role glass glass--solid">${escHtml(demoRole)}</span>
    </span>
    <span class="conv-item-preview">${escHtml(TEXT.TOUR_DEMO_CHAT_PREVIEW)}</span>`;
  btn.addEventListener('click', demoOpenConversation);
  list.insertBefore(btn, list.firstChild);
}

/** Open the demo conversation: renders the real chat frame (peer = opposite-role
 *  demo name), no network. Does not set chat.convId — the page-leave read-mark
 *  hook would POST to a bogus id; the private flag drives the active class and
 *  cleanup instead. */
export function demoOpenConversation() {
  closeChatPlus();
  stopChatPolling();
  _tourDemoConvOpen = true;
  document.querySelectorAll('#my-chats-list .conv-item').forEach(b =>
    b.classList.toggle('active', b.dataset.convId === 'demo'));
  const frame = document.getElementById('chat-frame');
  if (!frame) return;
  const teacherView = state.user && state.user.role === 'teacher';
  const demoName = teacherView ? TEXT.TOUR_DEMO_CHAT_NAME_TEACHER : TEXT.TOUR_DEMO_CHAT_NAME_STUDENT;
  const demoRole = teacherView ? TEXT.CHAT_ROLE_STUDENT : TEXT.CHAT_ROLE_TEACHER;
  frame.innerHTML = renderChatFrame({
    id: 'demo', status: 'active',
    student_name: demoName, teacher_name: demoName,
    student_user_id: null, teacher_user_id: null,
  });
  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = `<div class="empty-state empty-state--small"><p>${escHtml(TEXT.TOUR_DEMO_CHAT_EMPTY)}</p></div>`;
}

/** Tour-end cleanup: remove the demo conv; if the demo frame is open, restore the
 *  chat placeholder (auto-hide outside the tour). */
function _tourDemoChatCleanup() {
  const list = document.getElementById('my-chats-list');
  if (list) list.querySelectorAll('.tour-demo-conv').forEach(el => el.remove());
  if (_tourDemoConvOpen) {
    _tourDemoConvOpen = false;
    const frame = document.getElementById('chat-frame');
    if (frame) frame.innerHTML = renderChatPlaceholder();
  }
}

/** Demo contract card: same idea as the demo conversation — fresh accounts have no
 *  contracts, so inject one to introduce the contract card + action buttons.
 *  Removed by _tourCleanup. */
function _tourDemoContractEnsure() {
  if (_tourDemoDisabled || !_tourActive) return; // poll only while a tour is active
  const list = document.getElementById('my-contracts-list');
  if (!list || list.querySelector('.tour-demo-contract')) return;
  if (list.querySelector('.loader')) {
    setTimeout(_tourDemoContractEnsure, 200);
    return;
  }
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();
  const demo = document.createElement('div');
  demo.className = 'list-card tour-demo-contract glass';
  demo.innerHTML = `
    <div class="contract-demo-head">${escHtml(TEXT.TOUR_DEMO_CONTRACT_TITLE)}</div>
    <p class="contract-demo-hint">${escHtml(TEXT.TOUR_DEMO_CONTRACT_HINT)}</p>
    <div class="contract-actions">
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable">${escHtml(TEXT.TOUR_DEMO_CONTRACT_VIEW)}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable">${escHtml(TEXT.TOUR_DEMO_CONTRACT_MODIFY)}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable">${escHtml(TEXT.TOUR_DEMO_CONTRACT_CONFIRM)}</button>
    </div>`;
  list.insertBefore(demo, list.firstChild);
}

function _tourDemoContractCleanup() {
  const list = document.getElementById('my-contracts-list');
  if (list) list.querySelectorAll('.tour-demo-contract').forEach(el => el.remove());
}

// Exported for tour step functions (tours.js) that inject demo content lazily.
export { _tourDemoChatEnsure, _tourDemoContractEnsure };
