<script setup>
import { computed, ref } from 'vue'
import { UiButton, UiInput } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { AUTH_COPY, UI_COPY } from '@/constants/ui.js'
import { showToast } from '@/composables/useToast'
import { settingsState } from './settings-data.js'

/**
 * SettingsContact - M5-09c contact info row (I-12)
 * -------------------------------------------------------
 * - Settings row (label + control column, flex row, gap --space-4,
 *   no dividers - plan :559 flat design language).
 * - Shows the masked phone / email from settingsState.user.contactMasks
 *   (agreed interface, e.g. "138****8000" / "a***@x.com"). A channel with no
 *   bound target renders a bind trigger (UiButton B) instead.
 * - Clicking a bind trigger opens an inline mini-form: a channel toggle
 *   (phone / email) + a target input + a code input + a submit action.
 * - The OTP send / code-verify flow belongs to M6 (auth module), so the
 *   mini-form is a data-cap placeholder: submit carries data-cap="m5-09c-contact"
 *   and shows NOTIF_COPY.CAP_TOAST instead of calling the API.
 *   Intended I-12 call once M6 ships: updateSettings({ channel, target, code }).
 *   409 "already bound" negative path: the real API returns 409
 *   PHONE_ALREADY_BOUND / EMAIL_ALREADY_BOUND; since no API is called here, that
 *   path is a cap note for the M6 wiring - no fake "occupied" state is rendered.
 * - Copy: all Chinese via copy single-sources (NOTIF_COPY for the row;
 *   AUTH_COPY = M6's single source, the flow this defers to, re-exported through
 *   ui.js; UI_COPY = M0 base-layer copy). The bind-action label has no dedicated
 *   NOTIF_COPY key yet, so NOTIF_COPY.CAP_TOAST stands in - module owner
 *   finalizes a SETTINGS_BIND key during copy collection.
 * - Contract 6: zero raw CJK, zero inline style attrs, zero v-html, zero runtime
 *   <style> injection; scoped <style> only.
 */
const formOpen = ref(false)
const channel = ref('phone')
const target = ref('')
const code = ref('')

/** Normalize the agreed contactMasks shape ({phone,email} masked strings). */
const masks = computed(() => {
  const u = settingsState.user
  const cm = (u && u.contactMasks) || {}
  return { phone: cm.phone || '', email: cm.email || '' }
})

const targetPlaceholder = computed(() =>
  channel.value === 'phone'
    ? AUTH_COPY.IDENTIFIER_PLACEHOLDER_PHONE
    : AUTH_COPY.IDENTIFIER_PLACEHOLDER_EMAIL,
)

/** Open the bind mini-form for a channel; a second click on the active one toggles it closed. */
function openBind(ch) {
  if (formOpen.value && channel.value === ch) {
    closeForm()
    return
  }
  channel.value = ch
  target.value = ''
  code.value = ''
  formOpen.value = true
}

/** Channel switch clears channel-scoped fields (review note 6 clean-state discipline). */
function switchChannel(ch) {
  if (ch === channel.value) return
  channel.value = ch
  target.value = ''
  code.value = ''
}

function closeForm() {
  formOpen.value = false
  target.value = ''
  code.value = ''
}

function onSubmit() {
  // I-12 would PUT /api/settings { channel, target, code }; the OTP send belongs
  // to M6 (auth). Capped: no network call, only the under-development toast.
  // 409 "already bound" note: a real response is 409 PHONE_ALREADY_BOUND /
  // EMAIL_ALREADY_BOUND -> surface it as an inline error / toast when M6 wires
  // the flow; no fake occupied state is rendered here.
  showToast(NOTIF_COPY.CAP_TOAST)
  closeForm()
}
</script>

<template>
  <div class="sc-row" role="group" :aria-label="NOTIF_COPY.SETTINGS_CONTACT">
    <span class="sc-label">{{ NOTIF_COPY.SETTINGS_CONTACT }}</span>
    <div class="sc-control">
      <!-- phone channel: masked value or a bind trigger -->
      <div class="sc-line">
        <span class="sc-line__key">{{ AUTH_COPY.CHANNEL_PHONE }}</span>
        <span v-if="masks.phone" class="sc-line__val">{{ masks.phone }}</span>
        <UiButton
          v-else
          variant="B"
          size="sm"
          width="220px"
          @click="openBind('phone')"
        >{{ NOTIF_COPY.SETTINGS_BIND }}</UiButton>
      </div>

      <!-- email channel: masked value or a bind trigger -->
      <div class="sc-line">
        <span class="sc-line__key">{{ AUTH_COPY.CHANNEL_EMAIL }}</span>
        <span v-if="masks.email" class="sc-line__val">{{ masks.email }}</span>
        <UiButton
          v-else
          variant="B"
          size="sm"
          width="220px"
          @click="openBind('email')"
        >{{ NOTIF_COPY.SETTINGS_BIND }}</UiButton>
      </div>

      <!-- inline bind mini-form (data-cap: OTP/code flow is M6's) -->
      <div v-if="formOpen" class="sc-form" data-cap="m5-09c-contact">
        <div class="sc-tabs" role="group" :aria-label="NOTIF_COPY.SETTINGS_CONTACT">
          <UiButton
            variant="B"
            size="sm"
            width="96px"
            class="sc-tab"
            :class="{ 'is-active': channel === 'phone' }"
            :aria-pressed="channel === 'phone'"
            @click="switchChannel('phone')"
          >{{ AUTH_COPY.CHANNEL_PHONE }}</UiButton>
          <UiButton
            variant="B"
            size="sm"
            width="96px"
            class="sc-tab"
            :class="{ 'is-active': channel === 'email' }"
            :aria-pressed="channel === 'email'"
            @click="switchChannel('email')"
          >{{ AUTH_COPY.CHANNEL_EMAIL }}</UiButton>
        </div>
        <UiInput
          v-model="target"
          :placeholder="targetPlaceholder"
          :filter="channel === 'phone' ? 'phone' : 'none'"
          width="100%"
        />
        <UiInput
          v-model="code"
          :placeholder="AUTH_COPY.OTP_CODE_PLACEHOLDER"
          filter="digits"
          :max-length="6"
          width="100%"
        />
        <div class="sc-form__actions">
          <UiButton
            variant="B"
            size="sm"
            data-cap="m5-09c-contact"
            @click="onSubmit"
          >{{ UI_COPY.STEP_SUBMIT }}</UiButton>
          <UiButton
            variant="B"
            size="sm"
            @click="closeForm"
          >{{ UI_COPY.ALERT_CANCEL }}</UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Single settings row: label + control on one flex line, no divider (flat design). */
.sc-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}
.sc-label {
  flex: none;
  width: 96px;
  font-size: var(--fs-base);
  color: var(--ink);
  line-height: 1.4;
}
.sc-control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
/* One channel per line; a masked value row and a bind-trigger row share the same height. */
.sc-line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
}
.sc-line__key {
  flex: none;
  width: 40px;
  font-size: var(--fs-sm);
  color: var(--gray-50);
}
.sc-line__val {
  font-size: var(--fs-base);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
/* Inline mini-form: bare stack, no background / divider (text sits on the module surface). */
.sc-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-1);
}
.sc-tabs {
  display: flex;
  gap: var(--space-2);
}
/* Active channel tab: gray-10 fill on the UiButton root (specificity beats ui-btn). */
.sc-tab.is-active {
  background: var(--gray-10);
}
.sc-form__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
