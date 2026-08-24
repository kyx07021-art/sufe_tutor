<script setup>
import { ref } from 'vue'
import { UiCheckbox } from '@/components/ui/index.js'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { notifyState, setBlockSystem, loadNotifications } from './data.js'
import { api } from '@/core/api.js'

/**
 * BlockSystemToggle - M5-03 block-system-notifications checkbox
 * -------------------------------------------------------
 * - Checkbox row (UiCheckbox: square box + check, no stretch) toggling the
 *   server-side blockSystemNotifications preference (I-28). AK-C2-F9 (#4): the
 *   boolean preference is checkbox-shaped — a UiCheckButton would stretch right
 *   on select (the exact 'button elongates' anti-pattern the user rejected).
 * - Single source of truth = notifyState.blockSystem (data.js). The client
 *   does NOT re-filter; after a successful PUT the list is re-fetched so the
 *   server-filtered result is reflected (mutation anchor: removing the
 *   re-fetch leaves system notifications visible after the toggle).
 * - Optimistic write with rollback on failure (mutation anchor: removing the
 *   rollback desyncs the checkbox from the persisted state).
 * - Busy lock disables the control while the PUT / reload is in flight,
 *   preventing a double-toggle race.
 * - Contract 6: zero raw CJK, zero inline style attrs, zero v-html, zero
 *   runtime <style> injection; scoped <style> only.
 */
const props = defineProps({
  /** external disable (e.g. a parent-level busy state) */
  disabled: { type: Boolean, default: false },
})

const busy = ref(false)

async function onToggle(next) {
  if (busy.value || props.disabled) return
  const prev = notifyState.blockSystem
  // Optimistic write: flip the module state immediately.
  setBlockSystem(next)
  busy.value = true
  try {
    await api('/settings', {
      method: 'PUT',
      body: { blockSystemNotifications: next },
    })
    // Re-fetch so the server-filtered list reflects the new preference.
    // loadNotifications never throws (it records notifyState.error itself).
    await loadNotifications()
  } catch (e) {
    // Persist failed: revert the optimistic write so UI matches the server.
    setBlockSystem(prev)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="bst">
    <UiCheckbox
      :model-value="notifyState.blockSystem"
      :label="NOTIF_COPY.NOTIF_BLOCK_SYSTEM"
      :disabled="busy || disabled"
      @update:model-value="onToggle"
    />
  </div>
</template>

<style scoped>
/* Minimal inline container: the check button sits inline, no dividers. */
.bst {
  display: inline-flex;
  align-items: center;
}
</style>
