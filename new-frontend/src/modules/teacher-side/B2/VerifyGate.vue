<script setup>
/**
 * VerifyGate - B2-1b verification gate (four states from I-43)
 * ------------------------------------------------------------
 * - Fetches /api/teacher/verify-status on mount and branches by status:
 *   none     -> guidance copy + both submit channels (CHSI + admission)
 *   pending  -> waiting copy (provider appended when present)
 *   approved -> approved copy
 *   rejected -> rejected copy + both submit channels (re-submit)
 * - Loading / error states are displayed (B1_LOADING / B1_ERROR).
 * - reload() re-fetches the state; when the new status is 'approved' it emits
 *   `status-changed` so the parent (MyInfo) swaps to the edit card.
 * - Zero inline style/event attributes; copy from TEACHER_COPY single source.
 */
import { computed, onMounted, ref } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { fetchVerifyStatus } from './verify-service.js'
import VerifyChsi from './VerifyChsi.vue'
import VerifyAdmission from './VerifyAdmission.vue'

const emit = defineEmits(['status-changed'])

const status = ref('none')
const provider = ref('')
const loading = ref(true)
const error = ref('')

const pendingText = computed(() => {
  const base = TEACHER_COPY.B2_VERIFY_PENDING
  return provider.value ? `${base} (${provider.value})` : base
})

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const v = await fetchVerifyStatus()
    status.value = v.status
    provider.value = v.provider || ''
    if (v.status === 'approved') emit('status-changed', 'approved')
  } catch (e) {
    error.value = TEACHER_COPY.B1_ERROR
  } finally {
    loading.value = false
  }
}

onMounted(reload)
</script>

<template>
  <div class="verify-gate">
    <p v-if="loading" class="verify-gate__state">{{ TEACHER_COPY.B1_LOADING }}</p>
    <p v-else-if="error" class="verify-gate__state verify-gate__state--error">
      {{ error }}
    </p>

    <template v-else-if="status === 'none'">
      <p class="verify-gate__hint">{{ TEACHER_COPY.B2_VERIFY_NONE }}</p>
      <p class="verify-gate__hint">{{ TEACHER_COPY.B2_VERIFY_NONE_ALT }}</p>
      <div class="verify-gate__channels">
        <VerifyChsi @submitted="reload" />
        <VerifyAdmission @submitted="reload" />
      </div>
    </template>

    <p v-else-if="status === 'pending'" class="verify-gate__hint">
      {{ pendingText }}
    </p>

    <p v-else-if="status === 'approved'" class="verify-gate__hint">
      {{ TEACHER_COPY.B2_VERIFY_APPROVED }}
    </p>

    <template v-else-if="status === 'rejected'">
      <p class="verify-gate__hint">{{ TEACHER_COPY.B2_VERIFY_REJECTED }}</p>
      <div class="verify-gate__channels">
        <VerifyChsi @submitted="reload" />
        <VerifyAdmission @submitted="reload" />
      </div>
    </template>

    <!-- defensive fallback: an unknown status is treated as 'none' (service already clamps) -->
    <template v-else>
      <p class="verify-gate__hint">{{ TEACHER_COPY.B2_VERIFY_NONE }}</p>
      <p class="verify-gate__hint">{{ TEACHER_COPY.B2_VERIFY_NONE_ALT }}</p>
      <div class="verify-gate__channels">
        <VerifyChsi @submitted="reload" />
        <VerifyAdmission @submitted="reload" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.verify-gate {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.verify-gate__state {
  padding: var(--space-7) 0;
  text-align: center;
  color: var(--gray-50);
}
.verify-gate__state--error {
  color: var(--danger);
}
.verify-gate__hint {
  color: var(--gray-75);
  line-height: var(--lh-body);
}
.verify-gate__channels {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding-top: var(--space-3);
}
</style>
