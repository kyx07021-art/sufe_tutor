/**
 * region feature registry: shared province/gaokao/address component actions.
 * This feature has no pages; it exports reusable actions and optional delegation.
 */
import { TEXT } from '../../constants/text.js';
import * as actions from './actions.js';
import * as render from './render.js';

const ACTION_MAP = {
  'region.pickGrade': actions.pickGrade,
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
}

function onScoreTab(e) {
  actions.onScoreTabChange(e);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  document.addEventListener('click', onActionClick);
  document.addEventListener('seg-tab-change', onScoreTab);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('seg-tab-change', onScoreTab);
    installed = false;
  };
}

export default {
  id: 'region',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  render,
  onLoad,
};

export { actions, render, TEXT };
