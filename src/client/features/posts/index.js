/**
 * posts feature registry: page registration + data-action/change/input delegation.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { setPostsEnsureAuth } from './actions-list.js';

const ACTION_MAP = {
  'posts.toggleFav': actions.togglePostsFav,
  'posts.openCard': (el, e) => actions.postCardClick(e, Number(el.dataset.postId || el.closest('[data-post-id]').dataset.postId)),
  'posts.openEditor': actions.openPostEditor,
  'posts.submit': actions.submitPost,
  'posts.closeModal': actions.closeModalAction,
  'posts.confirmDelete': el => actions.postConfirmDelete(Number(el.dataset.id)),
  'posts.submitBroadcast': actions.submitBroadcast,
  'posts.submitFeedback': actions.submitFeedback,
  'posts.feedbackBug': () => { actions.closeModalAction(); actions.openFeedbackModal('bug'); },
  'posts.feedbackSuggestion': () => { actions.closeModalAction(); actions.openFeedbackModal('suggestion'); },
  'posts.openComplaint': actions.openComplaintAction,
  'md-wrap': el => actions.mdWrap(el.dataset.md),
  'post-image': el => actions.insertPostImage(el),
  'post-preview': actions.openPostPreview,
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  // Let native checkbox/file/label interactions proceed: preventing default here
  // would swallow like/fav checkbox toggles and file pickers.
  if (e.target && (e.target.matches('input[type="checkbox"]') || e.target.matches('input[type="file"]') || e.target.closest('.post-like, .post-fav, .post-del'))) return;
  e.preventDefault();
  fn(el, e);
}

function onFileChange(e) {
  const el = e.target;
  if (el && el.dataset && el.dataset.action === 'post-image') actions.insertPostImage(el);
}

function onInput(e) {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.input === 'posts.search') actions.postsSearchDebounced();
  else if (el.dataset.input === 'posts.titleCount') actions.updateTitleCount();
}

function onChange(e) {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.change === 'posts.sort') actions.loadPosts();
  else if (el.dataset.postsLike != null) actions.togglePostLike(Number(el.dataset.postsLike), el);
  else if (el.dataset.postsFav != null) actions.togglePostFavorite(Number(el.dataset.postsFav), el);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'resource-share',
    roles: ['teacher'],
    label: TEXT.PAGE_RESOURCE_SHARE,
    desc: TEXT.PAGE_RESOURCE_SHARE_DESC,
    auth: false,
    enter: () => actions.enterResourceShare(),
  });
  document.addEventListener('click', onActionClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('change', onFileChange);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onChange);
    document.removeEventListener('change', onFileChange);
    installed = false;
  };
}

export default {
  id: 'posts',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
  setEnsureAuth: setPostsEnsureAuth,
};

export { actions, TEXT };
