/**
 * v2 onboard feature actions: first-visit modal, usage guide and the tour entry
 * points. No inline handlers (archtest) — modal buttons carry data-action
 * handled by the onboard registry's click delegation.
 * auth/flow.js statically imports startOnboardingTour from this module.
 */
import { TEXT } from '../../constants/text.js';
import { CONFIG } from '../../../shared/config.js';
import { isReturning, setReturning } from '../../core/state.js';
import { openModal, closeModal } from '../../core/ui.js';
import { escHtml } from '../../core/dom.js';
import { startOnboardingTour, setTourScripts } from './engine.js';
import { TOUR_SCRIPTS } from './tours.js';

setTourScripts(TOUR_SCRIPTS); // engine reads the script table through this registry

/** First-visit modal (policy summary; primary button dismisses — the client is
 *  only reachable after login, and login/register buttons sit on the landing). */
function openOnboarding() {
  const policyItems = (TEXT.ONBOARD_POLICY || []).map(p =>
    `<div class="onboard-policy-item"><span class="about-sec-mark glass" aria-hidden="true"></span><p>${escHtml(p)}</p></div>`).join('');
  const primary = `<button type="button" class="btn glass glass--pressable" data-action="onboard.close">${escHtml(TEXT.ONBOARD_CONFIRM)}</button>`;
  openModal({
    title: TEXT.ONBOARD_TITLE,
    // (2026-08-19 user report: login/register clicks dead): the first-visit modal
    // must be dismissible by clicking the overlay. closable:false + transparent fullscreen
    // modal-overlay (z-index 200, zero background) swallowed every click on the page below
    // (login/register/browse buttons) with no feedback; the only exits were the tiny x or
    // the browseGuest guide button (near-fullscreen on mobile hid the landing entirely).
    // true: the guide still shows; a click anywhere dismisses it and unlocks the page.
    closable: true,
    // h5a-g2: explicit width single-sourced in CONFIG (MODAL_W_ONBOARD = .modal
    // default max-width, zero visual change); passes through ui-modal cssText
    // (h5a-g6 note: CSSOM cssText is not governed by style-src-attr, verified).
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

export { startOnboardingTour };
export function closeOnboard() { closeModal(); }
