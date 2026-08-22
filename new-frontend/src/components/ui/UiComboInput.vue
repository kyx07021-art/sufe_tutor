<script setup>
import { computed, ref } from 'vue'
import UiInput from './UiInput.vue'
import UiDropdownPanel from './UiDropdownPanel.vue'
import { useRipple } from '@/composables/useRipple'
import { injectFieldContext, injectFieldFill } from '@/composables/useFieldContext'
import ArrowDown from '@/assets/svg/arrow-down.svg'

/**
 * UiComboInput - Combo input A (plan "input component styles - combo input A")
 * -------------------------------------------------------
 * - Overall outline = dropdown button B: V at the far right, an input A tucked on the left (left/top/bottom aligned, right edge leaving a gap before V).
 * - Clicking the input zone summons the caret (does not trigger the dropdown); clicking the right V zone opens the dropdown (applies dropdown button effect to the whole component).
 * - The input is forced fill-less (fill='none', ignores gray-10 instruction), but the focus gray mask stays.
 * - Selecting an item from the dropdown auto-fills the input (without summoning the caret); placeholder logic is handled by the input.
 */
const props = defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  filter: { type: String, default: 'none' },
  align: { type: String, default: 'down', validator: (v) => ['down', 'up', 'left', 'right'].includes(v) },
  disabled: { type: Boolean, default: false },
  columns: { type: Number, default: 0 },
  /** surface fill: auto (info input area default gray-10) | paper */
  fill: { type: String, default: 'auto', validator: (v) => ['auto', 'paper', 'gray-10'].includes(v) },
})

const emit = defineEmits(['update:modelValue', 'select'])

const fieldFill = injectFieldFill()
const fieldCtx = injectFieldContext()
const resolvedFill = computed(() => (props.fill === 'auto' ? fieldFill || 'paper' : props.fill))

const rootRef = ref(null)
const vBtnRef = ref(null)
const open = ref(false)

useRipple(vBtnRef, { disabled: computed(() => props.disabled) })

function toggle() {
  if (props.disabled) return
  fieldCtx?.markTouched()
  open.value = !open.value
}

function onSelect(value) {
  fieldCtx?.markTouched()
  emit('update:modelValue', value)
  emit('select', value)
  open.value = false
}
</script>

<template>
  <div ref="rootRef" class="ui-combo" :class="{ 'is-open': open, 'ui-combo--gray10': resolvedFill === 'gray-10' }">
    <div class="ui-combo__input">
      <UiInput
        :model-value="modelValue"
        :placeholder="placeholder"
        :filter="filter"
        fill="none"
        :disabled="disabled"
        width="100%"
        @update:model-value="(v) => emit('update:modelValue', v)"
      />
    </div>
    <button
      ref="vBtnRef"
      type="button"
      class="ui-combo__v"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <ArrowDown class="ui-combo__v-icon" :class="{ 'is-open': open }" aria-hidden="true" />
    </button>

    <UiDropdownPanel
      :open="open"
      :options="options"
      :model-value="modelValue"
      :trigger="rootRef"
      :align="align"
      :columns="columns"
      @select="onSelect"
      @close="open = false"
    />
  </div>
</template>

<style scoped>
.ui-combo {
  position: relative;
  display: flex;
  align-items: stretch;
  box-sizing: border-box;
  width: 100%;
  background: var(--combo-bg, var(--paper));
  border-radius: var(--input-radius);
  overflow: hidden;
  transition: background var(--dur-sm) var(--ease-out);
}
/* dropdown open -> whole component recolors; info input area default gray-10 background */
.ui-combo.is-open { background: var(--gray-10); }
.ui-combo--gray10 { --combo-bg: var(--gray-10); }

.ui-combo__input {
  flex: 1;
  min-width: 0;
  padding-right: var(--space-3); /* input right edge leaves a gap before V */
}

.ui-combo__v {
  position: relative;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.ui-combo__v:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--brand); }

/* ripple (same as button B) */
.ui-combo__v::before,
.ui-combo__v::after {
  content: "";
  position: absolute;
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--btn-d, 200px);
  height: var(--btn-d, 200px);
  margin-left: calc(var(--btn-d, 200px) / -2);
  margin-top: calc(var(--btn-d, 200px) / -2);
  border-radius: 50%;
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.ui-combo__v::before {
  background: var(--gray-15);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--dur-md) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-combo__v:hover::before,
  .ui-combo__v:focus-visible::before {
    opacity: 1;
    animation: ui-combo-v-in var(--dur-xs) var(--ease-out) forwards;
  }
}
@keyframes ui-combo-v-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}
.ui-combo__v::after { background: var(--gray-30); }
.ui-combo__v.is-rippling::after {
  animation: ui-ripple var(--dur-xl) var(--ease-out) forwards;
}

.ui-combo__v-icon {
  position: relative;
  z-index: 1;
  flex: none;
  width: 1em;
  height: 1em;
  transition: transform var(--dur-sm) var(--ease-out);
}
.ui-combo__v-icon.is-open { transform: rotate(180deg); }

@media (prefers-reduced-motion: reduce) {
  .ui-combo,
  .ui-combo__v::before,
  .ui-combo__v::after,
  .ui-combo__v.is-rippling::after { transition: none; animation: none; }
}
</style>
