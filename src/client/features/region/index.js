/**
 * region feature registry: shared province/gaokao/address component actions.
 * This feature has no pages; it exports reusable actions and optional delegation.
 */
import { TEXT } from '../../constants/text.js';
import * as actions from './actions.js';
import * as render from './render.js';

const ACTION_MAP = {
  'region.pickGkPill': actions.pickGkPill,
  'region.pickGkTrack': actions.pickGkTrack,
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

function onRegionChange(e) {
  const sel = e.target && e.target.closest ? e.target.closest('[data-region-change]') : null;
  if (!sel) return;
  const name = sel.dataset.regionChange;
  if (name === 'teacher.province') actions.onTeacherProvinceChange(sel.value);
  if (name === 'teacher.subjects') actions.onTeacherSubjectsChange();
  if (name === 'teacher.gradYear') actions.onTeacherGradYearChange();
}

function onScoreTab(e) {
  actions.onScoreTabChange(e);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  document.addEventListener('click', onActionClick);
  document.addEventListener('change', onRegionChange);
  document.addEventListener('seg-tab-change', onScoreTab);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('change', onRegionChange);
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
