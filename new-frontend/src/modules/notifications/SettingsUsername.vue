<script setup>
import { computed, ref } from 'vue'
import { UiButton, UiInput } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { UI_COPY } from '@/constants/ui.js'
import { settingsState, updateSettings } from './settings-data.js'

/**
 * SettingsUsername - M5-09a username edit row (I-10)
 * -------------------------------------------------------
 * - Settings row: label "username" on the left, inline editable control on the right.
 *   Flat row (no divider) per the settings design language; comfortable min-height.
 * - Display state shows settingsState.user.username and an edit button B ("edit").
 *   Clicking reveals a small inline UiInput + a confirm button A.
 * - Submit builds the I-10 patch { username, capToken }. The capToken flow belongs to
 *   M6 (identity auth), which is NOT built yet. Until a real capToken producer is
 *   wired in, submit is a data-cap placeholder: it does NOT call the API, instead it
 *   toasts the generic cap copy and marks the input container data-cap="m5-09a-username".
 * - When settingsState.usernameStatus.canChange === false the username renders
 *   read-only with a generic cap note (a dedicated cooldown text is not surfaced yet)
 *   and no edit entry.
 * - F7: on a real successful write settings-data.js mergeSettingsResponse syncs the
 *   local username; a 'saved' event lets the shell refresh the sidebar.
 */
const emit = defineEmits(['saved'])

const canChange = computed(() => !!settingsState.usernameStatus.canChange)
const username = computed(() => settingsState.user.username || '')
const editing = ref(false)
const draft = ref('')
const saving = ref(false) // F6 in-flight guard: no double submit
const capHit = ref(false) // marks the input container data-cap when the cap fires

function startEdit() {
  draft.value = username.value
  editing.value = true
  capHit.value = false
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
  capHit.value = false
}

/**
 * Honest cap: the M6 identity-auth flow that produces a capToken is not built yet.
 * Swap this seam for the real openIdentityAuth({ onVerified }) producer when M6 lands.
 */
async function acquireCapToken() {
  return ''
}

async function submitEdit() {
  if (!editing.value || saving.value) return
  const next = draft.value.trim()
  if (!next || next === username.value) {
    cancelEdit()
    return
  }
  saving.value = true
  try {
    // I-10 requires capToken; the M6 flow is capped, so the write never reaches the API.
    const capToken = await acquireCapToken()
    if (!capToken) {
      capHit.value = true
      showToast(NOTIF_COPY.CAP_TOAST)
      return
    }
    await updateSettings({ username: next, capToken })
    showToast(NOTIF_COPY.SETTINGS_SAVED)
    editing.value = false
    draft.value = ''
    emit('saved', next)
  } catch (err) {
    showToast((err && err.message) || NOTIF_COPY.CAP_TOAST)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="su-row">
    <span class="su-row__label">{{ NOTIF_COPY.SETTINGS_USERNAME }}</span>

    <!-- read-only branch: username cannot change (cooldown etc.) -->
    <div v-if="!canChange" class="su-readonly">
      <span class="su-readonly__value">{{ username }}</span>
      <span class="su-readonly__note">{{ NOTIF_COPY.CAP_TOAST }}</span>
    </div>

    <!-- editable branch -->
    <div v-else class="su-edit">
      <template v-if="!editing">
        <span class="su-edit__value">{{ username }}</span>
        <UiButton variant="B" size="sm" class="su-edit__edit-btn" @click="startEdit">
          {{ NOTIF_COPY.SETTINGS_EDIT }}
        </UiButton>
      </template>
      <div
        v-else
        class="su-edit__form"
        :data-cap="capHit ? 'm5-09a-username' : undefined"
      >
        <UiInput
          v-model="draft"
          class="su-edit__input"
          min-height="36"
          :disabled="saving"
          @send="submitEdit"
        />
        <UiButton
          variant="A"
          class="su-edit__confirm"
          :disabled="saving"
          @click="submitEdit"
        >
          {{ UI_COPY.ALERT_CONFIRM }}
        </UiButton>
        <UiButton
          variant="B"
          class="su-edit__cancel"
          :disabled="saving"
          @click="cancelEdit"
        >
          {{ UI_COPY.ALERT_CANCEL }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* AK-N-G2: username row shares the settings grid baseline — a fixed label column
   (--settings-label-w) + a 1fr value column. The value column content (value +
   edit button) is left-aligned so the row aligns with avatar / contact rows. */
.su-row {
  display: grid;
  grid-template-columns: var(--settings-label-w) 1fr;
  align-items: center;
  gap: var(--space-4);
  min-height: 44px;
  box-sizing: border-box;
}
.su-row__label {
  color: var(--ink);
  font-size: var(--fs-base);
}
.su-readonly {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-4);
  min-width: 0;
}
.su-readonly__value {
  color: var(--ink);
  font-size: var(--fs-base);
}
.su-readonly__note {
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
.su-edit {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-4);
  min-width: 0;
}
.su-edit__value {
  color: var(--ink);
  font-size: var(--fs-base);
}
/* AK-N-G2: edit action is UiButton B sm — same variant + size as the avatar
   "change" and contact "bind" triggers (no per-button width overrides). */
.su-edit__edit-btn {
  flex: none;
}
.su-edit__form {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-3);
  min-width: 0;
}
.su-edit__input {
  --input-w: 150px;
  --input-h: 36px;
  flex: none;
}
.su-edit__confirm {
  flex: none;
  --btn-w: 84px;
  --btn-h: 34px;
  --btn-fs: var(--fs-sm);
}
.su-edit__cancel {
  flex: none;
  --btn-w: 68px;
  --btn-h: 34px;
  --btn-fs: var(--fs-sm);
}
</style>
