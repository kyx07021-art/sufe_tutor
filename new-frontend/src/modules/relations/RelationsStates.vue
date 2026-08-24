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
import { UiButton, UiIcon } from '@/components/ui/index.js'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

const props = defineProps({
  state: {
    type: String,
    default: 'loading',
    validator: (v) => ['loading', 'error', 'empty'].includes(v),
  },
  /** Optional override; falls back to RELATIONS_COPY copy for the state. */
  message: { type: String, default: '' },
  /** Current user's avatar shown above the empty-state text ('' -> fallback icon). */
  selfAvatar: { type: String, default: '' },
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
      <div v-if="state === 'empty'" class="rel-states__avatar">
        <img v-if="selfAvatar" :src="selfAvatar" class="rel-states__avatar-img" alt="" />
        <span v-else class="rel-states__avatar-fallback" aria-hidden="true">
          <UiIcon class="rel-states__avatar-icon" name="user" />
        </span>
      </div>
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

.rel-states__avatar {
  width: 88px;
  max-width: 100%;
  min-width: 0;
}

.rel-states__avatar-img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  border-radius: var(--radius-circle);
  object-fit: cover;
  border: var(--border-w) solid var(--gray-20);
}

/* Neutral circle fallback: gray-10 disc with a gray-70 user glyph (same pattern
   as the board avatars / profile modal). */
.rel-states__avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-circle);
  background: var(--gray-10);
  color: var(--gray-70);
}

.rel-states__avatar-icon {
  width: 45%;
  height: 45%;
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
