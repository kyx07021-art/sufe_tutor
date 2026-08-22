<script setup>
import { computed, ref } from 'vue'
import { UiButton, UiFieldInput, UiInput } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { showToast } from '@/composables/useToast'
import { api } from '@/core/api.js'

/**
 * FeedbackForm - M5-15 feedback submit area (anonymous hard constraint)
 * -------------------------------------------------------
 * - Kind switch (row of button B1s): bug / suggestion / report. Selecting a kind
 *   shows its own detail fields and resets the whole form (mutation anchor: removing
 *   the reset bleeds a previous kind's title/content into the next kind -> red).
 * - Field sets: bug & suggestion = required title + required content; report = optional
 *   target (the title slot) + required content. Optional contact is always available.
 * - Submit (A) disabled until content is non-empty (and title for bug/suggestion).
 * - ANONYMITY (mutation anchor "identity leak red"): the payload never carries an auth
 *   identity - no token, no user id. The only identity substitute is a locally generated
 *   clientToken kept in sessionStorage ('m5_feedback_client'), so the backend can group
 *   tickets by device. This component never reads or sends the auth token.
 */

const CLIENT_TOKEN_KEY = 'm5_feedback_client'

const kinds = [
  { id: 'bug', label: NOTIF_COPY.FEEDBACK_KIND_BUG },
  { id: 'suggestion', label: NOTIF_COPY.FEEDBACK_KIND_SUGGESTION },
  { id: 'report', label: NOTIF_COPY.FEEDBACK_KIND_REPORT },
]

const kind = ref('bug')
const title = ref('')
const content = ref('')
const contact = ref('')
const submitting = ref(false)

// report kind: the title slot doubles as an optional target; other kinds require a title.
const titleRequired = computed(() => kind.value !== 'report')

const canSubmit = computed(() => {
  const hasContent = content.value.trim().length > 0
  if (kind.value === 'report') return hasContent
  return title.value.trim().length > 0 && hasContent
})

function selectKind(id) {
  if (id === kind.value) return
  kind.value = id
  // reset the whole form so a previous kind's text never bleeds into the next kind
  title.value = ''
  content.value = ''
  contact.value = ''
}

function generateClientToken() {
  const c = typeof window !== 'undefined' ? window.crypto : null
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16)
    c.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10).join(''),
    ].join('-')
  }
  // last-resort random id (device-scoped only, never an auth identity)
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function getOrCreateClientToken() {
  const store = window.sessionStorage
  const existing = store.getItem(CLIENT_TOKEN_KEY)
  if (existing) return existing
  const token = generateClientToken()
  store.setItem(CLIENT_TOKEN_KEY, token)
  return token
}

async function onSubmit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    const clientToken = getOrCreateClientToken()
    // anonymity hard constraint: the payload carries NO auth identity (no token, no user id)
    // auth:false keeps the feedback anonymous - no X-Auth-Token is injected, so the
    // payload carries no auth identity (anonymity hard constraint preserved through
    // the single-point api()).
    await api('/feedbacks', {
      method: 'POST',
      auth: false,
      body: {
        kind: kind.value,
        title: title.value.trim(),
        content: content.value.trim(),
        contact: contact.value.trim() || undefined,
        attrs: {},
        clientToken,
      },
    })
    showToast(NOTIF_COPY.FEEDBACK_SUBMITTED)
    title.value = ''
    content.value = ''
    contact.value = ''
  } catch (err) {
    showToast((err && err.message) || 'Request failed')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="ff-feedback">
    <div class="ff-kind" role="group" :aria-label="NOTIF_COPY.FEEDBACK_TITLE">
      <UiButton
        v-for="k in kinds"
        :key="k.id"
        variant="B1"
        class="ff-kind__btn"
        :class="{ 'is-active': kind === k.id }"
        :aria-pressed="kind === k.id"
        @click="selectKind(k.id)"
      >
        {{ k.label }}
      </UiButton>
    </div>

    <div class="ff-fields">
      <!-- report kind: the title slot is the optional report target; other kinds require a title -->
      <UiFieldInput
        :title="NOTIF_COPY.FEEDBACK_TITLE_LABEL"
        :required="titleRequired"
        :filled="title.trim() !== ''"
      >
        <UiInput v-model="title" class="ff-control" />
      </UiFieldInput>

      <UiFieldInput
        :title="NOTIF_COPY.FEEDBACK_CONTENT_LABEL"
        :required="true"
        :filled="content.trim() !== ''"
      >
        <UiInput v-model="content" class="ff-control" min-height="120" />
      </UiFieldInput>

      <UiFieldInput
        :title="NOTIF_COPY.FEEDBACK_CONTACT_LABEL"
        :required="false"
        :filled="contact.trim() !== ''"
      >
        <UiInput v-model="contact" class="ff-control" />
      </UiFieldInput>
    </div>

    <div class="ff-footer">
      <span class="ff-anon">{{ NOTIF_COPY.FEEDBACK_ANONYMOUS }}</span>
      <UiButton variant="A" :disabled="!canSubmit || submitting" @click="onSubmit">
        {{ NOTIF_COPY.FEEDBACK_SUBMIT }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.ff-feedback {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.ff-kind {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.ff-kind__btn {
  --btn-w: auto;
}

.ff-kind__btn.is-active {
  background: var(--gray-10);
  font-weight: 500;
}

/* forms stack with spacing only - no dividers between fields */
.ff-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ff-control {
  --input-w: 100%;
}

.ff-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.ff-anon {
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
</style>
