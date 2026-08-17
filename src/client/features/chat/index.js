/**
 * chat feature registry: my-chats page + delegation.
 */
import { TEXT } from './text.js';
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { setChatEnsureAuth } from './actions-list.js';
import { setChatConvById } from '../contract/actions-chat-bridge.js';

const ACTION_MAP = {
  'chat.openConv': el => actions.openConversation(Number(el.dataset.id)),
  'chat.back': actions.backToConvList,
  'chat.plus': actions.toggleChatPlus,
  'chat.send': actions.sendChatMessage,
  'chat.unstage': el => actions.chatUnstage(Number(el.dataset.id)),
  'chat.openImage': (el, e) => actions.chatOpenImage(Number(el.dataset.mid), e.target.closest('img') || null),
  'chat.download': el => actions.chatDownload(Number(el.dataset.mid)),
  'chat.plusDraft': actions.chatPlusDraft,
  'chat.plusSigning': actions.chatPlusSigning,
  'chat.respond': el => actions.respondSigning(Number(el.dataset.id), el.dataset.accept === '1'),
};

let installed = false;

function onActionClick(e) {
  const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
  if (!el) return;
  const fn = ACTION_MAP[el.dataset.action];
  if (!fn) return;
  if (e.target && e.target.matches('input[type="file"]')) return; // file picker handled on change
  e.preventDefault();
  fn(el, e);
}

function onInput(e) {
  const el = e.target;
  if (el && el.id === 'chat-input') actions.chatAutogrow(el);
}

function onKeydown(e) {
  if (e.target && e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    actions.sendChatMessage();
  }
}

function onChange(e) {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.action === 'chat.image') actions.chatOnImagePicked(el);
  else if (el.dataset.action === 'chat.file') actions.chatOnFilePicked(el);
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'my-chats',
    roles: ['student', 'teacher'],
    label: TEXT.PAGE_MY_CHATS,
    desc: TEXT.PAGE_MY_CHATS_DESC,
    auth: true,
    enter: () => actions.enterMyChats(),
  });
  setChatConvById(actions.chatConvById);
  document.addEventListener('click', onActionClick);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('change', onChange);
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('change', onChange);
    installed = false;
  };
}

export default {
  id: 'chat',
  text: TEXT,
  pages: [],
  actions: ACTION_MAP,
  onLoad,
  setEnsureAuth: setChatEnsureAuth,
};

export { actions, TEXT };
