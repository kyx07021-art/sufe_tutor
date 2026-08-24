<script setup>
/**
 * ChatHintText — C2.6 extra hint text (M4-16)
 * -------------------------------------------------------
 * Centered hint line inside the conversation area:
 *   "—————— <hint text> ——————"
 * - Gray text (--gray-50) with one divider line on each side, horizontally
 *   centered. Whole component width = 40% of the chat area (80% on mobile).
 * - Text max-width = 20% of the chat area (50% of this 40% container; 25% of
 *   the 80% mobile container), wraps when exceeded; every line centered.
 *   Manual "\n" line breaks are honored via white-space: pre-line.
 * - The side lines are vertically centered against the whole component height
 *   (not the first text line): align-items:center on the flex row + a 1px
 *   border-top on the zero-content ::before/::after pseudo items.
 * - Copy is external (temporary-session hints, M4-26+); this component holds
 *   no copy of its own (contract 6, module §2.7).
 */
defineProps({
  text: { type: String, default: '' },
})
</script>

<template>
  <div class="chat-hint">
    <span class="chat-hint__text">{{ text }}</span>
  </div>
</template>

<style scoped>
.chat-hint {
  display: flex;
  align-items: center; /* center the 1px lines against the whole height */
  gap: var(--space-3); /* gap between side lines and central text */
  width: 40%; /* 40% of the chat area (plan C2.6 L425) */
  margin: 0 auto; /* horizontally centered inside the chat area */
}

.chat-hint::before,
.chat-hint::after {
  content: '';
  flex: 1; /* grow to fill the space left over by the text */
  border-top: var(--border-w) solid var(--divider);
}

.chat-hint__text {
  min-width: 0;
  max-width: 50%; /* = 20% of the chat area (40% container / 2) */
  text-align: center; /* every wrapped line centered */
  white-space: pre-line; /* manual "\n" breaks + auto wrap */
  overflow-wrap: break-word;
  line-height: var(--lh-body);
  color: var(--gray-50);
  font-size: var(--fs-sm);
}

@media (max-width: 600px) {
  .chat-hint {
    width: 80%; /* mobile: whole component = 80% of the chat area */
  }
  .chat-hint__text {
    max-width: 25%; /* still 20% of the chat area (80% container / 4) */
  }
}
</style>
