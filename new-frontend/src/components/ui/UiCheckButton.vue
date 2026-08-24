<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRipple } from '@/composables/useRipple'
import { injectFieldContext, injectFieldFill } from '@/composables/useFieldContext'
import Check from '@/assets/svg/check.svg'

/**
 * UiCheckButton - Check button (plan "input component styles - check button A/B")
 * -------------------------------------------------------
 * - A: like button A, stretches right on selection (--checkbtn-stretch), text shifts right evenly;
 *      the left space spawns a check SVG with an entrance animation; clicking again shrinks back and hides the check.
 * - B: like A, no border, no lift on focus.
 * - Text can change when selected (checkedLabel); stretch distance is further adjusted by the text length delta.
 */
const props = defineProps({
  variant: { type: String, default: 'A', validator: (v) => ['A', 'B'].includes(v) },
  modelValue: { type: Boolean, default: false },
  label: { type: String, default: '' },
  /** text shown when selected (empty = reuse label) */
  checkedLabel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  /** surface fill: auto (info input area default gray-10) | paper */
  fill: { type: String, default: 'auto', validator: (v) => ['auto', 'paper', 'gray-10'].includes(v) },
})

const emit = defineEmits(['update:modelValue', 'click'])
const el = ref(null)
const labelRef = ref(null)
const checkedLabelRef = ref(null)
const extraWidth = ref(0)
const fieldFill = injectFieldFill()
const fieldCtx = injectFieldContext()
const resolvedFill = computed(() => (props.fill === 'auto' ? fieldFill || 'paper' : props.fill))

useRipple(el, { disabled: computed(() => props.disabled) })

const isChecked = computed(() => props.modelValue)
const stretchVar = computed(() => ({ '--checkbtn-stretch': 44 + extraWidth.value + 'px' }))

function measure() {
  const a = labelRef.value ? labelRef.value.scrollWidth : 0
  const b = checkedLabelRef.value ? checkedLabelRef.value.scrollWidth : 0
  extraWidth.value = Math.max(0, b - a)
}

onMounted(measure)
watch([() => props.modelValue, () => props.checkedLabel, () => props.label], measure)

function toggle() {
  if (props.disabled) return
  fieldCtx?.markTouched()
  emit('update:modelValue', !props.modelValue)
  emit('click', !props.modelValue)
}

function onKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  toggle()
}
</script>

<template>
  <button
    ref="el"
    type="button"
    class="ui-checkbtn"
    :class="[
      `ui-checkbtn--${variant.toLowerCase()}`,
      { 'is-checked': isChecked, 'is-disabled': disabled, 'ui-checkbtn--gray10': resolvedFill === 'gray-10' },
    ]"
    :style="stretchVar"
    :aria-pressed="isChecked"
    :disabled="disabled"
    @click="toggle"
    @keydown="onKeydown"
  >
    <span class="ui-checkbtn__check">
      <Check class="ui-checkbtn__check-svg" aria-hidden="true" />
    </span>
    <span class="ui-checkbtn__label">
      <span ref="labelRef" class="ui-checkbtn__label-text" :class="{ 'is-inactive': isChecked }">{{ label }}</span>
      <span
        ref="checkedLabelRef"
        class="ui-checkbtn__label-text"
        :class="{ 'is-inactive': !isChecked }"
      >{{ checkedLabel || label }}</span>
    </span>
  </button>
</template>

<style scoped>
.ui-checkbtn {
  --btn-w: 220px;
  --btn-h: 52px;
  --btn-fs: 16px;
  --btn-pad: calc(var(--btn-h) / 2);
  --btn-radius: calc(var(--btn-h) / 2);
  --btn-hover-bg: var(--gray-15);
  --btn-click-bg: var(--gray-30);
  --btn-hover-ink: var(--gray-60);
  --btn-dur-in: var(--dur-xs);
  --btn-dur-color: var(--dur-sm);
  --btn-dur-focus: var(--dur-md);
  --btn-dur-out: var(--dur-md);
  --btn-dur-click: var(--dur-xl);
  --checkbtn-stretch: 44px;

  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--btn-w);
  height: var(--btn-h);
  padding: 0 var(--btn-pad);
  border: var(--border-w) solid transparent;
  border-radius: var(--btn-radius);
  background: var(--btn-bg, transparent);
  color: var(--ink);
  font-size: var(--btn-fs);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    width var(--dur-sm) var(--ease-out),
    transform var(--btn-dur-color) var(--ease-out);
}
.ui-checkbtn--a { --btn-bg: var(--paper); border-color: var(--ink); }
.ui-checkbtn--b { border-color: transparent; }
.ui-checkbtn--gray10 { --btn-bg: var(--gray-10); }

.ui-checkbtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }

/* selected: stretch right */
.ui-checkbtn.is-checked { width: calc(var(--btn-w) + var(--checkbtn-stretch)); }

/* check container: collapse/expand */
.ui-checkbtn__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0;
  opacity: 0;
  overflow: hidden;
  transition:
    width var(--dur-sm) var(--ease-out),
    opacity var(--dur-sm) var(--ease-out);
}
.ui-checkbtn.is-checked .ui-checkbtn__check {
  width: var(--checkbtn-stretch);
  opacity: 1;
}
.ui-checkbtn__check-svg {
  flex: none;
  width: 1.1em;
  height: 1.1em;
  color: var(--brand);
}
.ui-checkbtn.is-checked .ui-checkbtn__check-svg {
  animation: ui-check-in var(--dur-sm) var(--ease-out);
}
@keyframes ui-check-in {
  from { transform: scale(0.4); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* label: one in normal flow + one hidden for measuring */
.ui-checkbtn__label {
  display: inline-flex;
  align-items: center;
}
.ui-checkbtn__label-text.is-inactive {
  visibility: hidden;
  position: absolute;
}

/* ripple (same as button) */
.ui-checkbtn::before,
.ui-checkbtn::after {
  content: "";
  position: absolute;
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--btn-d, 600px);
  height: var(--btn-d, 600px);
  margin-left: calc(var(--btn-d, 600px) / -2);
  margin-top: calc(var(--btn-d, 600px) / -2);
  border-radius: 50%;
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.ui-checkbtn::before {
  background: var(--btn-hover-bg);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--btn-dur-out) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-checkbtn:hover::before,
  .ui-checkbtn:focus-visible::before {
    opacity: 1;
    animation: ui-checkbtn-hover-in var(--btn-dur-in) var(--ease-out) forwards;
  }
}
@keyframes ui-checkbtn-hover-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}
.ui-checkbtn::after { background: var(--btn-click-bg); }
.ui-checkbtn.is-rippling::after {
  animation: ui-ripple var(--btn-dur-click) var(--ease-out) forwards;
}

/* content layer above ripple */
.ui-checkbtn__check,
.ui-checkbtn__label {
  position: relative;
  z-index: 1;
  transition: color var(--btn-dur-color) var(--ease-out);
}

/* B-series no lift */
@media (hover: hover) and (pointer: fine) {
  .ui-checkbtn--a:hover { transform: translateY(var(--btn-lift)); }
  .ui-checkbtn:hover .ui-checkbtn__label,
  .ui-checkbtn:hover .ui-checkbtn__check { color: var(--btn-hover-ink); }
}

/* disabled */
.ui-checkbtn.is-disabled {
  cursor: default;
  color: var(--gray-50);
}
.ui-checkbtn.is-disabled::before,
.ui-checkbtn.is-disabled::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  .ui-checkbtn,
  .ui-checkbtn::before,
  .ui-checkbtn::after,
  .ui-checkbtn.is-rippling::after,
  .ui-checkbtn__check,
  .ui-checkbtn__label { transition: none; animation: none; }
  .ui-checkbtn:hover::before,
  .ui-checkbtn:focus-visible::before { opacity: 1; transform: scale(1); }
  .ui-checkbtn::after { opacity: 0; }
}
</style>
