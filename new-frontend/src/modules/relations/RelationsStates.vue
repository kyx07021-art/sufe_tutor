<script setup>
/**
 * RelationsStates - M3-09 empty / loading / failed state block
 * -----------------------------------------------------------
 * - Single source for the three relation-board data states.
 * - Props: state ('loading' | 'error' | 'empty'), optional message override.
 * - Emits: retry (only meaningful in error state).
 * - User-visible copy lives in RELATIONS_COPY (m-relations.js) - zero raw
 *   Chinese in markup / script / comments (contract 6).
 */
import { computed } from 'vue'
import { UiButton } from '@/components/ui/index.js'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

const props = defineProps({
  state: {
    type: String,
    default: 'loading',
    validator: (v) => ['loading', 'error', 'empty'].includes(v),
  },
  /** Optional override; falls back to RELATIONS_COPY copy for the state. */
  message: { type: String, default: '' },
})

const emit = defineEmits(['retry'])

const COPY = RELATIONS_COPY

const DEFAULT_TEXT = {
  loading: COPY.LOADING,
  error: COPY.LOAD_FAILED,
  empty: COPY.EMPTY,
}

const text = computed(() => props.message || DEFAULT_TEXT[props.state])
</script>

<template>
  <div class="rel-states" :class="`rel-states--${state}`" role="status">
    <p v-if="state === 'loading'" class="rel-states__text">{{ text }}</p>
    <template v-else>
      <p class="rel-states__text">{{ text }}</p>
      <UiButton v-if="state === 'error'" variant="B" class="rel-states__retry" @click="emit('retry')">
        {{ COPY.RETRY }}
      </UiButton>
    </template>
  </div>
</template>

<style scoped>
/* Fill the parent board surface; stack text (+ optional retry button) centered. */
.rel-states {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}

.rel-states__text {
  margin: 0;
  color: var(--gray-60);
  font-size: var(--fs-base);
}

/* Loading is slightly softer than error/empty. */
.rel-states--loading .rel-states__text {
  color: var(--gray-50);
}
</style>
