<script setup>
import UiIcon from './UiIcon.vue'

/**
 * UiFieldDisplay - Info display area A (plan "input component styles - info display area A")
 * -------------------------------------------------------
 * - Wide and flat, stackable vertically; white fill no border; 5% left / 10% right blank.
 * - Left 5%~20% black bold info item title (optionally with a small SVG icon on the left); 25%~90% is the info text zone.
 * - Info text left-aligned, auto-wrapping, gray-75; on multiple lines the title aligns to the first line (not vertically centered).
 */
defineProps({
  /** info items: { label, value, icon? } (icon = UiIcon name) */
  items: { type: Array, default: () => [] },
})
</script>

<template>
  <div class="ui-fielddisplay">
    <div v-for="(it, i) in items" :key="i" class="ui-fielddisplay__row">
      <div class="ui-fielddisplay__label">
        <UiIcon v-if="it.icon" :name="it.icon" :size="14" class="ui-fielddisplay__label-icon" aria-hidden="true" />
        <span class="ui-fielddisplay__label-text">{{ it.label }}</span>
      </div>
      <div class="ui-fielddisplay__value">{{ it.value }}</div>
    </div>
  </div>
</template>

<style scoped>
.ui-fielddisplay {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  background: var(--paper);
}

.ui-fielddisplay__row {
  display: grid;
  grid-template-columns: 5% 15% 5% 65% 10%;
  align-items: start; /* title aligns to the info text first line (not vertically centered) */
  padding: var(--space-2) 0;
}

.ui-fielddisplay__label {
  grid-column: 2;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.ui-fielddisplay__label-icon {
  flex: none;
  margin-top: 3px;
  color: var(--gray-50);
}
.ui-fielddisplay__label-text {
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-fielddisplay__value {
  grid-column: 4;
  min-width: 0;
  color: var(--gray-75);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
