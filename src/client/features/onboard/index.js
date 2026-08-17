/**
 * onboard feature registry.
 */
import { TEXT } from './text.js';
import * as actions from './actions.js';
const ACTION_MAP = { 'onboard.close': actions.closeOnboard };
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
