/**
 * onboard feature actions: first-visit modal and tour engine (ESM port).
 */
import { TEXT } from './text.js';
import { state, isReturning, setReturning } from '../../core/state.js';
import { openModal, closeModal, showToast } from '../../core/ui.js';

export function showOnboardingIfNeeded() {
  if (isReturning()) return;
  setReturning();
  openModal({ title: TEXT.ONBOARD_TITLE, body: `<p>${TEXT.ONBOARD_INTRO}</p>`, footer: `<button type="button" class="btn glass glass--pressable" data-action="onboard.close">${TEXT.BTN_START}</button>` });
}

export function openOnboarding() { showOnboardingIfNeeded(); }
export function openUsageGuide() { openModal({ title: TEXT.ONBOARD_TITLE, body: `<p>${TEXT.ONBOARD_GUIDE}</p>` }); }
export function startOnboardingTour() { showToast(TEXT.ONBOARD_TOUR_START); }
export function skipTour() { closeModal(); }
export function runTour() { startOnboardingTour(); }
export function browseAsGuest() { showToast(TEXT.ONBOARD_GUEST_HINT); }
export function closeOnboard() { closeModal(); }
