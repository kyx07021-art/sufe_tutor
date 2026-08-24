<script setup>
/**
 * UiCheckbox - compact checkbox row (AK-A7 agreement checkboxes; future list toggles)
 * -------------------------------------------------------
 * - Checkbox metaphor: a bordered square (box) on the left + left-aligned text.
 *   Selecting fills the box with brand and reveals a white check; deselecting
 *   restores the empty bordered box. The row does NOT stretch or ripple —
 *   unlike UiCheckButton (a capsule button that stretches right on selection).
 *   AK-A7 user spec: smaller font (--fs-sm 14px), lower height (~30px), tight
 *   row gap, left-aligned, box + check only.
 * - Native input[type=checkbox] drives semantics: role/aria-checked/Space are
 *   browser-provided; the visually-hidden native input keeps the label as the
 *   accessible name and a full-row click target. The visible box is a separate
 *   span styled via the :checked + sibling selector (JS-free state styling).
 * - Contract 6: zero inline event/style attrs, zero raw CJK, zero v-html, zero
 *   runtime <style>; animation lives in CSS (P7), reduced-motion respected.
 */
import Check from '@/assets/svg/check.svg'

defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change'])

function onChange(e) {
  const next = e.target.checked
  emit('update:modelValue', next)
  emit('change', next)
}
</script>

<template>
  <label class="ui-checkbox" :class="{ 'is-disabled': disabled }">
    <input
      class="ui-checkbox__native"
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="ui-checkbox__box" aria-hidden="true">
      <Check class="ui-checkbox__check" />
    </span>
    <span class="ui-checkbox__label">{{ label }}</span>
  </label>
</template>

<style scoped>
.ui-checkbox {
  /* component tokens (parent may override via :deep) */
  --cb-h: 30px;
  --cb-box: 18px;
  --cb-fs: var(--fs-sm);
  --cb-gap: var(--space-2);

  display: inline-flex;
  align-items: center;
  justify-content: flex-start; /* left-aligned (AK-A7) */
  gap: var(--cb-gap);
  box-sizing: border-box;
  min-height: var(--cb-h);
  padding: 0;
  color: var(--ink);
  font-size: var(--cb-fs);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* native input visually hidden but focusable; :checked + :focus-visible drive
   the visible box via sibling selectors */
.ui-checkbox__native {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  opacity: 0;
}

/* box: bordered square; fills brand + white check when selected */
.ui-checkbox__box {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--cb-box);
  height: var(--cb-box);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-xs);
  background: transparent;
  transition:
    border-color var(--dur-sm) var(--ease-out),
    background var(--dur-sm) var(--ease-out);
}
.ui-checkbox__check {
  width: 72%;
  height: 72%;
  color: var(--brand-ink);
  opacity: 0;
  transform: scale(0.4);
  transition:
    opacity var(--dur-sm) var(--ease-out),
    transform var(--dur-sm) var(--ease-out);
}
.ui-checkbox__native:checked + .ui-checkbox__box {
  border-color: var(--brand);
  background: var(--brand);
}
.ui-checkbox__native:checked + .ui-checkbox__box .ui-checkbox__check {
  opacity: 1;
  transform: scale(1);
}

/* focus ring on the box (standard checkbox pattern) */
.ui-checkbox__native:focus-visible + .ui-checkbox__box {
  box-shadow: 0 0 0 2px var(--brand);
}

/* hover: only the UNCHECKED box border darkens; text stays black (AK-B3).
   :not(:checked) keeps the hover affordance from fighting the checked brand
   fill (same-specificity sibling rule would otherwise win by source order). */
@media (hover: hover) and (pointer: fine) {
  .ui-checkbox:not(.is-disabled) .ui-checkbox__native:not(:checked) + .ui-checkbox__box:hover {
    border-color: var(--gray-60);
  }
}

.ui-checkbox.is-disabled {
  cursor: default;
  color: var(--gray-50);
}
.ui-checkbox.is-disabled .ui-checkbox__box {
  border-color: var(--gray-30);
}
/* disabled + checked: brand fill and white check degrade to gray (kept readable
   but no longer saturated — TASK B #5) */
.ui-checkbox.is-disabled .ui-checkbox__native:checked + .ui-checkbox__box {
  border-color: var(--gray-30);
  background: var(--gray-30);
}
.ui-checkbox.is-disabled .ui-checkbox__native:checked + .ui-checkbox__box .ui-checkbox__check {
  color: var(--gray-50);
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .ui-checkbox__box,
  .ui-checkbox__check {
    transition: none;
  }
  .ui-checkbox__native:checked + .ui-checkbox__box .ui-checkbox__check {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
