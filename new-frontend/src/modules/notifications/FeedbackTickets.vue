<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { UiCard } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { api } from '@/core/api.js'
import { formatNotificationTime } from './data.js'

/**
 * FeedbackTickets - M5-16 my tickets list (anonymous identity model)
 * -------------------------------------------------------
 * - Rendered inside FeedbackModal's "my tickets" tab. No props, no emits: it loads
 *   on mount and owns its list state.
 * - Anonymous identity = a per-device clientToken (crypto.randomUUID) persisted in
 *   sessionStorage under 'm5_feedback_client'; GET /api/feedbacks/mine?clientToken=...
 *   returns the tickets created under that token. A logged-in user's id takes
 *   precedence on the server (review note 7); this client only sends clientToken.
 * - Ticket cards reuse M0 UiCard B1 (no border; no second card renderer).
 * - Empty / loading states route copy through NOTIF_COPY; error text is the server
 *   message verbatim (never a hardcoded Chinese string).
 * - Zero inline style / runtime HTML injection / runtime style injection (contract 6).
 */
const STORAGE_KEY = 'm5_feedback_client'

const tickets = ref([])
const loading = ref(true)
const error = ref('')

let disposed = false

/** Kind values come from the POST body contract: bug | suggestion | report. */
const KIND_LABELS = {
  bug: NOTIF_COPY.FEEDBACK_KIND_BUG,
  suggestion: NOTIF_COPY.FEEDBACK_KIND_SUGGESTION,
  report: NOTIF_COPY.FEEDBACK_KIND_REPORT,
}

function kindLabel(kind) {
  // Fall back to the raw server value (data, not hardcoded copy) for unknown kinds.
  return KIND_LABELS[kind] || kind || ''
}

/** Build (or restore) the anonymous identity token shared with M5-15. */
function getClientToken() {
  let token = sessionStorage.getItem(STORAGE_KEY)
  if (!token) {
    token = crypto.randomUUID()
    sessionStorage.setItem(STORAGE_KEY, token)
  }
  return token
}

/** Accept { feedbacks: [] } / { items: [] } / a bare array (defensive normalize). */
function toTickets(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.feedbacks)) return data.feedbacks
  if (data && Array.isArray(data.items)) return data.items
  return []
}

async function loadTickets() {
  loading.value = true
  error.value = ''
  try {
    const clientToken = getClientToken()
    // auth:false preserves the anonymous identity model - only clientToken is sent,
    // never the auth token (see module comment: a logged-in id takes precedence on
    // the server, but this client deliberately sends clientToken only).
    const data = await api(
      '/feedbacks/mine?clientToken=' + encodeURIComponent(clientToken),
      { auth: false },
    )
    if (disposed) return
    tickets.value = toTickets(data)
  } catch (e) {
    if (disposed) return
    error.value = (e && e.message) || ''
  } finally {
    if (!disposed) loading.value = false
  }
}

onMounted(loadTickets)
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <div class="ft">
    <div v-if="loading" class="ft__state">{{ NOTIF_COPY.NOTIF_LOADING }}</div>
    <div v-else-if="error" class="ft__state ft__state--error">{{ error }}</div>
    <div v-else-if="!tickets.length" class="ft__state">{{ NOTIF_COPY.FEEDBACK_EMPTY }}</div>
    <div v-else class="ft__list">
      <UiCard
        v-for="(ticket, i) in tickets"
        :key="ticket.id != null ? ticket.id : i"
        variant="B1"
        class="ft__card"
      >
        <div class="ft__card-head">
          <span class="ft__kind">{{ kindLabel(ticket.kind) }}</span>
          <time class="ft__time" :datetime="ticket.created_at">
            {{ formatNotificationTime(ticket.created_at) }}
          </time>
        </div>
        <div class="ft__title">{{ ticket.title }}</div>
        <div class="ft__content">{{ ticket.content }}</div>
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.ft {
  display: flex;
  flex-direction: column;
}

/* Cards stacked with spacing only --space-3; no dividers between them. */
.ft__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ft__card {
  padding: var(--space-4);
  border-radius: var(--radius-md);
}

.ft__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.ft__kind {
  font-size: var(--fs-xs);
  color: var(--gray-70);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--gray-10);
}

.ft__time {
  font-size: var(--fs-xs);
  color: var(--gray-50);
  white-space: nowrap;
}

.ft__title {
  margin-top: var(--space-3);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: break-word;
}

.ft__content {
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--gray-60);
  line-height: var(--lh-body);
  overflow-wrap: break-word;
}

.ft__state {
  padding: var(--space-6) 0;
  font-size: var(--fs-sm);
  color: var(--gray-50);
  text-align: center;
}

.ft__state--error {
  color: var(--danger);
}
</style>
