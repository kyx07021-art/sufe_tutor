/**
 * onboard feature registry.
 *
 * Action map: first-visit modal buttons (onboard.*) plus the about-page revisit
 * entries (about-usage-guide / about-revisit-tour — B2 wiring: core/about.js renders
 * those buttons with data-action, this registry makes them live; the redundant
 * CustomEvent('about-action') dispatch in about.js has no listener, no double fire).
 */
import { TEXT } from '../../constants/text.js';
import { ROLES } from '../../../shared/enums.js';
import * as actions from './actions.js';

const ACTION_MAP = {
  'onboard.close': actions.closeOnboard,
  'onboard.usageGuide': actions.openUsageGuide,
  'onboard.browseGuest': () => actions.browseAsGuest(ROLES.STUDENT),
  'about-usage-guide': actions.openUsageGuide,
  'about-revisit-tour': actions.startOnboardingTour,
};

let installed = false;
function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  e.preventDefault(); fn(el, e);
}
function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  document.addEventListener('click', onActionClick);
  return () => { document.removeEventListener('click', onActionClick); installed = false; };
}
export default { id: 'onboard', text: TEXT, pages: [], actions: ACTION_MAP, onLoad };
export { actions, TEXT };
