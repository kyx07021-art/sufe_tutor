/**
 * index.js - C2 chat module unified exit (module boundary)
 * -----------------------------------------------------------------
 * - External consumers (pages.js / other modules) import ONLY from here; deep-path
 *   imports are forbidden (W6 reuse discipline).
 * - Internal components / state / logic / copy each live in their own file
 *   (see CONTRACT.md primitive file map).
 * - Assembly actions (loadMessages/sendText/closeConversation/startTempConversation/
 *   startActivePolling) are exported here for cross-module entries
 *   (teacher-square "send message", etc.).
 */
export { default as ChatPage } from './ChatPage.vue'
export { default as ChatBubble } from './components/ChatBubble.vue'
export { default as ChatImageBubble } from './components/ChatImageBubble.vue'
export { default as ChatFileBubble } from './components/ChatFileBubble.vue'
export { default as ChatSpecialBubble } from './components/ChatSpecialBubble.vue'
export { default as ChatMessageList } from './components/ChatMessageList.vue'
export { default as ChatInputBar } from './components/ChatInputBar.vue'
export { default as ChatTopBar } from './components/ChatTopBar.vue'
export { default as ChatEndConfirmModal } from './components/ChatEndConfirmModal.vue'
export { default as ChatHintText } from './components/ChatHintText.vue'
export {
  chatState,
  activeConversation,
  openConversation,
  backToList,
  isChatInputVisible,
  loadMessages,
  loadMoreMessages,
  sendText,
  startTempConversation,
  closeConversation,
  loadRelations,
  startActivePolling,
  stopActivePolling,
  isEndSessionBusy,
  isSendBusy,
} from './state.js'
export { formatListTime, formatBubbleTime } from './logic/timeFormat.js'
export { brandSoftFilter } from './logic/colorFilter.js'
export { truncateFileName } from './logic/fileName.js'
export { normalizeMessage, dedupByMid, sliceTail, advanceCursor, hasMore } from './logic/messages.js'
export { createClientKey, makeOptimistic, sendMessages } from './logic/send.js'
export { pollOnce, createPoller } from './logic/polling.js'
export { canEnd, applyEnded, endSession } from './logic/endSession.js'
export { deriveTempHint, tempVisibleToMe, tempQuotaLeft, applyTempSent, applyFormal, initTemp } from './logic/tempConversation.js'
export { stageAttachment, compressImage } from './logic/upload.js'
export { CHAT_COPY } from '@/constants/m-chat.js'
