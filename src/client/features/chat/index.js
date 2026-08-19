/**
 * chat feature registry: my-chats page + delegation.
 * Document-level listeners only (the frame innerHTML is rebuilt per conversation):
 * click delegation, input autogrow, Enter-to-send, file change, dropzone, and the
 * plus-menu close-outside behavior (v1 parity).
 */
import { TEXT } from './text.js';
import { ROLES } from '../../../shared/enums.js'; // Z-16-F5: roles via shared enums
import { registerPage } from '../../core/router.js';
import * as actions from './actions.js';
import { setChatConvById } from '../contract/actions-chat-bridge.js';
import { chatBindDropzone } from './actions-misc.js';

const ACTION_MAP = {
  'chat.openConv': el => actions.openConversation(Number(el.dataset.id)),
  'chat.back': actions.backToConvList,
  'chat.plus': actions.toggleChatPlus,
  'chat.send': actions.sendChatMessage,
  'chat.unstage': el => actions.chatUnstage(Number(el.dataset.id)),
  'chat.openImage': (el, e) => actions.chatOpenImage(Number(el.dataset.mid), e.target.closest('img') || null),
  'chat.plusDraft': actions.chatPlusDraft,
  'chat.plusSigning': actions.chatPlusSigning,
  'chat.respond': el => actions.respondSigning(Number(el.dataset.id), el.dataset.accept === '1'),
  'chat.openProfile': el => actions.chatOpenProfile(Number(el.dataset.id)),
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
  // Enter sends, Shift+Enter inserts a newline; IME composition Enter (picking a
  // candidate) must not send (v1 chatInputKeydown parity)
  if (e.target && e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    actions.sendChatMessage();
  }
}

function onChange(e) {
  const el = e.target;
  if (!el || !el.dataset) return;
  if (el.dataset.action === 'chat.image') { actions.closeChatPlus(); actions.chatOnImagePicked(el); }
  else if (el.dataset.action === 'chat.file') { actions.closeChatPlus(); actions.chatOnFilePicked(el); }
}

function onDocumentClick(e) {
  // plus menu closes when clicking outside (v1 enterMyChats parity, bound once)
  const w = document.getElementById('chat-plus-wrap');
  if (w && e.target && e.target.closest && !e.target.closest('.chat-plus-wrap')) w.classList.remove('open');
}

function onLoad() {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  registerPage({
    id: 'my-chats',
    roles: [ROLES.STUDENT, ROLES.TEACHER],
    label: TEXT.PAGE_MY_CHATS,
    desc: TEXT.PAGE_MY_CHATS_DESC,
    auth: true,
    enter: () => actions.enterMyChats(),
    leave: () => actions.chatLeavePage(),
  });
  setChatConvById(actions.chatConvById);
  document.addEventListener('click', onActionClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('change', onChange);
  chatBindDropzone();
  return () => {
    document.removeEventListener('click', onActionClick);
    document.removeEventListener('click', onDocumentClick);
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
};

export { actions, TEXT };
