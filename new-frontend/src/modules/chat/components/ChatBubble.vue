<script setup>
/**
 * ChatBubble — C2 normal text bubble (M4-08 / M4-09 / M4-31)
 * -----------------------------------------------------------------
 * - M4-08 brand-purple filter: own bubble fill = `--brand-soft` (the chat
 *   own-bubble pale purple single source, tokens.css); peer bubble fill =
 *   `--gray-10`. colorFilter.js derives the same pale family and is unit-tested
 *   independently; this component consumes the single-source tokens directly.
 *   Geometry (G5, plan L412): the bubble box max-width is 70% of the message
 *   area on both sides.
 * - M4-09 bubble send time: bottom-right small label via
 *   `formatBubbleTime(message.created_at)` (../logic/timeFormat.js).
 * - M4-31 entrance animation: the optimistic send pipeline (M4-30) marks its
 *   in-flight row with a truthy local `pending` (and/or `tempId`) field that is
 *   NOT part of the I-18 wire shape. Only such sending rows get the `animate-in`
 *   mount animation (fade + slide-up, --dur-base). Confirmed / historical rows
 *   never animate; `prefers-reduced-motion: reduce` disables it.
 *
 * Props contract:
 *   message  Object   I-18 message row { id, sender_user_id, kind, name, body,
 *                     thumb, created_at }. `body` = text, `created_at` = ISO
 *                     timestamp. Optimistic rows add local `pending`/`tempId`.
 *   mine     Boolean  Own bubble (right-aligned, brand-soft fill) vs peer
 *                     (left-aligned, gray-10 fill).
 *
 * Contract 6: zero CJK / zero inline event + style attrs / zero v-html;
 * JS only toggles the `animate-in` class (dynamic styling via CSS variables).
 */
import { computed, onMounted, ref } from 'vue'
import { CHAT_COPY } from '@/constants/ui.js'
import { formatBubbleTime } from '../logic/timeFormat.js'

const props = defineProps({
  message: { type: Object, required: true },
  mine: { type: Boolean, default: false },
})

const rootEl = ref(null)

const timeLabel = computed(() => formatBubbleTime(props.message.created_at))
const ariaLabel = computed(() => (props.mine ? CHAT_COPY.BUBBLE_MINE_ALT : CHAT_COPY.BUBBLE_PEER_ALT))

/** M4-30 optimistic in-flight marker (local client field, not I-18 wire shape). */
const isSending = computed(() => props.mine && (props.message.pending || props.message.tempId))

onMounted(() => {
  if (isSending.value && rootEl.value) {
    rootEl.value.classList.add('animate-in')
  }
})
</script>

<template>
  <div
    ref="rootEl"
    class="chat-bubble"
    :class="mine ? 'is-mine' : 'is-peer'"
    role="group"
    :aria-label="ariaLabel"
  >
    <div class="chat-bubble__bubble">
      <p class="chat-bubble__text">{{ message.body }}</p>
      <span v-if="timeLabel" class="chat-bubble__time">{{ timeLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
/* -- Alignment: own right, peer left (plan C2.1) -- */
.chat-bubble {
  display: flex;
  width: 100%;
  min-width: 0;
}
.chat-bubble.is-mine { justify-content: flex-end; }
.chat-bubble.is-peer { justify-content: flex-start; }

/* -- Bubble box: max 70% of the message area, flat rounded rect -- */
.chat-bubble__bubble {
  position: relative;
  max-width: 70%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}
.chat-bubble.is-mine .chat-bubble__bubble { background: var(--brand-soft); }
.chat-bubble.is-peer .chat-bubble__bubble { background: var(--gray-10); }

.chat-bubble__text {
  margin: 0;
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  overflow-wrap: break-word;
  word-break: break-word;
  white-space: pre-wrap;
}
.chat-bubble.is-mine .chat-bubble__text { color: var(--gray-90); }
.chat-bubble.is-peer .chat-bubble__text { color: var(--ink); }

.chat-bubble__time {
  flex: none;
  align-self: flex-end;
  font-size: var(--fs-xs);
  line-height: 1;
  color: var(--gray-50);
}

/* -- Minimal flat tail: rotated square, fill inherits the bubble color -- */
.chat-bubble__bubble::after {
  content: '';
  position: absolute;
  top: 16px;
  width: 10px;
  height: 10px;
  background: inherit;
}
.chat-bubble.is-mine .chat-bubble__bubble::after {
  right: -5px;
  transform: rotate(45deg);
}
.chat-bubble.is-peer .chat-bubble__bubble::after {
  left: -5px;
  transform: rotate(45deg);
}

/* -- M4-31 entrance: fade + slide-up for sending bubbles only -- */
.chat-bubble.animate-in {
  animation: chat-bubble-in var(--dur-base) var(--ease-out);
}
@keyframes chat-bubble-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .chat-bubble.animate-in { animation: none; }
}
</style>
