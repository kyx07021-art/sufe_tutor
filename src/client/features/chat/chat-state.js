/**
 * chat feature module state (mutable object to share across split action files).
 */
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
