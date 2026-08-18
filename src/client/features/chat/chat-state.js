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
};
