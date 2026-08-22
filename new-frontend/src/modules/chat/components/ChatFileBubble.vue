<script setup>
import { computed } from 'vue'
import ChatFileLogo from './ChatFileLogo.vue'
import { truncateFileName } from '../logic/fileName.js'
import { CHAT_COPY } from '@/constants/ui.js'

/**
 * ChatFileBubble - C2.1 file message bubble (M4-11)
 * -----------------------------------------------------------------
 * Plan book C2.1 (L414-419): a paper-filled, line-framed rounded
 * rectangle of fixed width with a small corner tail:
 *   - Left 30% zone: square file-type logo (ChatFileLogo, M4-12).
 *   - Right 70% zone: two lines - black file name (truncated keeping
 *     the extension, M4-13) on top, gray small file size below.
 *   - Clicking opens message.body as a URL in a new tab when the body
 *     actually is a URL; a size-only body renders a non-navigating card.
 *   - `mine` right-aligns and mirrors the tail; peer stays left.
 * Contract 6: zero Chinese, zero inline event/style attrs, zero v-html,
 * zero <style> injection; JS only toggles classes. All sizing consumes
 * design tokens (tokens.css single source).
 */

const MAX_NAME_CHARS = 24
const LOGO_SIZE = 40

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

const props = defineProps({
  /** I-18 message row: { id, sender_user_id, kind:'file', name, body, created_at } */
  message: { type: Object, required: true },
  /** true when this row was sent by the current user (right-aligned) */
  mine: { type: Boolean, default: false },
})

/** last-dot extension, trimmed + lowercased; '' when no dot / empty */
const extFromName = (name) => { const s = String(name ?? '').trim().toLowerCase(); const i = s.lastIndexOf('.'); return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : '' }

const ext = computed(() => extFromName(props.message.name))
const fileName = computed(() => truncateFileName(String(props.message.name ?? ''), MAX_NAME_CHARS))

/** byte count -> "1.2MB" via CHAT_COPY.FILE_SIZE single source */
function formatBytes(bytes) {
  let value = bytes
  let unitIdx = 0
  while (value >= 1024 && unitIdx < SIZE_UNITS.length - 1) {
    value /= 1024
    unitIdx += 1
  }
  const n = unitIdx === 0 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  return CHAT_COPY.FILE_SIZE(n, SIZE_UNITS[unitIdx])
}

/** message.body -> display size label; raw fallback when unparseable */
function formatFileSizeLabel(body) {
  const raw = body == null ? '' : String(body).trim()
  if (raw === '') return ''
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const bytes = Number(raw)
    if (Number.isFinite(bytes)) return formatBytes(bytes)
  }
  const sizeMatch = /^([\d.]+)\s*(B|KB|MB|GB|TB)$/i.exec(raw)
  if (sizeMatch) return CHAT_COPY.FILE_SIZE(sizeMatch[1], sizeMatch[2].toUpperCase())
  return raw
}

const sizeLabel = computed(() => formatFileSizeLabel(props.message.body))

/** body treated as a URL when it carries a scheme / leading slash / data URI */
const fileUrl = computed(() => {
  const raw = String(props.message.body ?? '').trim()
  return /^(https?:\/\/|\/|data:)/i.test(raw) ? raw : ''
})
</script>

<template>
  <a
    class="chat-file-bubble"
    :class="mine ? 'chat-file-bubble--mine' : 'chat-file-bubble--peer'"
    :href="fileUrl || undefined"
    :target="fileUrl ? '_blank' : undefined"
    :rel="fileUrl ? 'noopener noreferrer' : undefined"
    :aria-label="CHAT_COPY.FILE_BUBBLE_ALT"
    :aria-disabled="fileUrl ? undefined : 'true'"
  >
    <span class="chat-file-bubble__logo">
      <ChatFileLogo :type="ext" :size="LOGO_SIZE" />
    </span>
    <span class="chat-file-bubble__info">
      <span class="chat-file-bubble__name" :title="props.message.name">{{ fileName }}</span>
      <span class="chat-file-bubble__size">{{ sizeLabel }}</span>
    </span>
  </a>
</template>

<style scoped>
.chat-file-bubble {
  position: relative;
  display: grid;
  grid-template-columns: 30% 70%;
  align-items: center;
  width: 260px;
  max-width: 70%;
  box-sizing: border-box;
  padding: var(--space-3) var(--space-4);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper);
  color: var(--ink);
  text-decoration: none;
  cursor: pointer;
}

.chat-file-bubble--mine {
  margin-left: auto; /* right-align own file cards */
}

.chat-file-bubble[aria-disabled='true'] {
  cursor: default;
}

.chat-file-bubble:focus-visible {
  outline: var(--border-w-thick) solid var(--brand);
  outline-offset: 2px;
}

.chat-file-bubble__logo {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
}

.chat-file-bubble__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding-left: var(--space-3);
}

.chat-file-bubble__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  font-size: var(--fs-base);
  line-height: var(--lh-tight);
  color: var(--ink);
}

.chat-file-bubble__size {
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
  color: var(--gray-50);
}

/* small corner tail: paper-filled triangle breaking the line frame */
.chat-file-bubble::after {
  content: '';
  position: absolute;
  top: 18px;
  width: 0;
  height: 0;
  border: 7px solid transparent;
}

.chat-file-bubble--peer::after {
  left: -7px;
  border-right-color: var(--paper);
}

.chat-file-bubble--mine::after {
  right: -7px;
  border-left-color: var(--paper);
}
</style>
