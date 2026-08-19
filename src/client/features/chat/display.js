/**
 * chat domain display mappings (Z-10-F2: V-2-4b pattern — these were inline in
 * render.js). Pure functions; text from constants/text.js single source only.
 */
import { TEXT } from '../../constants/text.js';

/** Conversation list preview text from last message kind/body/sender (v1 parity). */
export function chatPreviewText(c, meUserId) {
  let preview = TEXT.CHAT_EMPTY_NO_MESSAGES;
  if (c.last_kind === 'contract') {
    preview = TEXT.CHAT_PREVIEW_CONTRACT;
  } else if (c.last_kind === 'signing_request' || c.last_kind === 'signing_response') {
    preview = c.last_kind === 'signing_request' ? TEXT.CHAT_PREVIEW_SIGNING_REQ : TEXT.CHAT_PREVIEW_SIGNING_RESP;
  } else if (c.last_kind && c.last_kind !== 'text') {
    preview = (c.last_sender === meUserId ? TEXT.CHAT_PREVIEW_ME_PREFIX : '') + (c.last_kind === 'image' ? TEXT.CHAT_PREVIEW_IMAGE : TEXT.CHAT_PREVIEW_FILE);
  } else if (c.last_body) {
    preview = (c.last_sender === meUserId ? TEXT.CHAT_PREVIEW_ME_PREFIX : '') + c.last_body;
  }
  return preview;
}

export function signingMethodText(method) {
  return method === 'online' ? TEXT.SIGNING_METHOD_ONLINE : TEXT.SIGNING_METHOD_OFFLINE;
}

export function signingRequestTitle(mine) {
  return mine ? TEXT.CHAT_SIGNING_MINE_TITLE : TEXT.CHAT_SIGNING_REQUEST_TITLE;
}

export function signingResponseLabel(mine, accept) {
  return mine
    ? (accept ? TEXT.SIGNING_MY_CONFIRMED : TEXT.SIGNING_MY_REJECTED)
    : (accept ? TEXT.SIGNING_CONFIRMED : TEXT.SIGNING_REJECTED);
}

export function contractBubbleText(mine) {
  return mine ? TEXT.CHAT_CONTRACT_BUBBLE_MINE : TEXT.CHAT_CONTRACT_BUBBLE_OTHER;
}

/** Attachment data URL human size (B/KB/MB), v1 parity. */
export function chatFileSize(dataUrl) {
  try {
    const s = String(dataUrl || '');
    const b64Idx = s.indexOf(';base64,');
    const bytes = b64Idx >= 0 ? Math.round((s.length - b64Idx - 8) * 3 / 4) : s.length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  } catch { return ''; }
}

/** Attachment file extension badge (uppercase, fallback FILE), v1 parity. */
export function chatFileExt(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? m[1].toUpperCase() : 'FILE';
}
