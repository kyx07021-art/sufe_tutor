/**
 * v2 onboard feature actions: first-visit modal, usage guide, guest browse and the
 * tour entry points. No inline handlers (archtest) — modal buttons carry data-action
 * handled by the onboard registry's click delegation.
 * auth/flow.js statically imports startOnboardingTour from this module, so the
 * enterRolePreview dependency is a call-time dynamic import (breaks the cycle).
 */
import { TEXT } from '../../constants/text.js';
import { CONFIG } from '../../../shared/config.js';
import { state, isReturning, setReturning } from '../../core/state.js';
import { openModal, closeModal } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { onboardContext, runTour, skipTour, startOnboardingTour, setTourScripts } from './engine.js';
import { TOUR_SCRIPTS } from './tours.js';

setTourScripts(TOUR_SCRIPTS); // engine reads the script table through this registry

/** First-visit modal (policy summary; primary button depends on login state:
 *  logged-in users dismiss; guests jump straight into the client as a student). */
function openOnboarding() {
  const ctx = onboardContext();
  const policyItems = (TEXT.ONBOARD_POLICY || []).map(p =>
    `<div class="onboard-policy-item"><span class="about-sec-mark glass" aria-hidden="true"></span><p>${escHtml(p)}</p></div>`).join('');
  const primary = ctx.loggedIn
    ? `<button type="button" class="btn glass glass--pressable" data-action="onboard.close">${escHtml(TEXT.ONBOARD_CONFIRM)}</button>`
    : `<button type="button" class="btn glass glass--pressable" data-action="onboard.browseGuest">${escHtml(TEXT.ONBOARD_CONFIRM_BROWSE)}</button>`;
  openModal({
    title: TEXT.ONBOARD_TITLE,
    // Z-14-F1 (2026-08-19 user report: login/register clicks dead): the first-visit modal
    // must be dismissible by clicking the overlay. closable:false + transparent fullscreen
    // modal-overlay (z-index 200, zero background) swallowed every click on the page below
    // (login/register/browse buttons) with no feedback; the only exits were the tiny x or
    // the browseGuest guide button (near-fullscreen on mobile hid the landing entirely).
    // true: the guide still shows; a click anywhere dismisses it and unlocks the page.
    closable: true,
    // h5a-g2: explicit width single-sourced in CONFIG (MODAL_W_ONBOARD = .modal
    // default max-width, zero visual change); passes through ui-modal cssText
    // (h5a-g6 note: CSSOM cssText is not governed by style-src-attr, F1 verified).
    style: `max-width:${CONFIG.MODAL_W_ONBOARD};`,
    body: `<p class="onboard-intro">${escHtml(TEXT.ONBOARD_INTRO)}</p><div class="onboard-policy">${policyItems}</div><p class="funds-note onboard-funds">${escHtml(TEXT.FUNDS_NOTE_SHORT)}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="onboard.usageGuide">${escHtml(TEXT.USAGE_GUIDE_BTN)}</button>${primary}`,
  });
}

/** Init entry: only first visit opens the modal; the device marker is written here
 *  (login/register also write it), so the guest landing respects it too. */
export function showOnboardingIfNeeded() {
  if (isReturning()) return;
  setReturning();
  openOnboarding();
}

export { openOnboarding };

/** Detailed usage guide: sectioned modal (also reachable from the about page). */
export function openUsageGuide() {
  const sections = (TEXT.USAGE_GUIDE_SECTIONS || []).map(s => `
      <div class="usage-guide-section">
        <h4 class="usage-guide-title">${escHtml(s.t)}</h4>
        ${(s.p || []).map(p => `<p class="usage-guide-text">${escHtml(p)}</p>`).join('')}
      </div>`).join('');
  openModal({
    title: TEXT.USAGE_GUIDE_TITLE,
    cls: 'modal--wide',
    body: `<div class="usage-guide">${sections}</div>`,
    footer: `<button type="button" class="btn glass glass--pressable" data-action="onboard.close">${escHtml(TEXT.ONBOARD_CONFIRM)}</button>`,
  });
}

/** First-visit "browse the client": close modal -> enter the role preview (await
 *  render) -> auto-run the matching tour. Silent degrade on entry failure (network /
 *  script 404): the landing entries stay usable, no tour on error. */
export async function browseAsGuest(role) {
  try {
    closeModal();
    const { enterRolePreview } = await import('../auth/flow.js'); // call-time: breaks the auth/flow <-> onboard cycle
    await enterRolePreview(role);
    startOnboardingTour();
  } catch (err) {
    console.warn('browseAsGuest', err);
  }
}

export { startOnboardingTour, runTour, skipTour };
export function closeOnboard() { closeModal(); }
