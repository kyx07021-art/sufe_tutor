/**
 * chat feature module state (mutable object to share across split action files).
 */
import { STATUS } from '../../../shared/enums.js';

export const chat = {
  convId: null,
  list: [],
  pollTimer: null,
  lastMsgId: 0,
  pollBusy: false,
  sending: false,
  optimisticSending: false,
  optimisticSeq: 0,
  pendingOpen: null,
  staged: [],
  stageSeq: 0,
  // Q-2d-F2 idempotency: retries reuse the same batch keys (server dedups by key); retired on success/content change
  pendingBatchKey: null,
  pendingBatchFp: '',
};

/**
 * AI-9: whether the currently open conversation is closed — single source for write-locking
 * and hiding operation entries. Reads chat.convId + the chat.list row status (list rows carry
 * c.status from GET /api/conversations; the detail snapshot is merged back by openConversation —
 * both write the same field, no second data source).
 */
export function chatClosedNow() {
  if (!chat.convId) return false;
  const c = chat.list.find(x => x.id === chat.convId);
  return !!(c && c.status && c.status !== STATUS.ACTIVE);
}
