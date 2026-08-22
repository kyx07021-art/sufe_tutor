<script setup>
import { computed, ref } from 'vue'
import UiButton from './UiButton.vue'
import UiDropdownPanel from './UiDropdownPanel.vue'
import { injectFieldContext, injectFieldFill } from '@/composables/useFieldContext'
import ArrowDown from '@/assets/svg/arrow-down.svg'

/**
 * UiDropdown - Dropdown button (plan "input component styles - dropdown button A/B")
 * -------------------------------------------------------
 * - A: like button A1, but the SVG arrow is a downward V; clicking opens the dropdown; V rotates 180deg to point up; clicking again closes.
 * - B: like A, no border.
 * - Unselected: gray placeholder text; after selection: black text fills the button.
 * - No lift on focus (dropdown button A spec).
 */
const props = defineProps({
  variant: { type: String, default: 'A', validator: (v) => ['A', 'B'].includes(v) },
  options: { type: Array, default: () => [] }, // Array<string> | Array<{label,value}>
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  align: { type: String, default: 'down', validator: (v) => ['down', 'up', 'left', 'right'].includes(v) },
  alignX: { type: String, default: 'left' },
  columns: { type: Number, default: 0 },
  width: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  /** panel min width (CSS length), default follows button width */
  panelMinWidth: { type: String, default: '' },
  /** surface fill: auto (info input area default gray-10) | paper */
  fill: { type: String, default: 'auto', validator: (v) => ['auto', 'paper', 'gray-10'].includes(v) },
})

const emit = defineEmits(['update:modelValue', 'select'])

const fieldFill = injectFieldFill()
const fieldCtx = injectFieldContext()
const resolvedFill = computed(() =>
  props.fill === 'auto' ? fieldFill || 'paper' : props.fill,
)

const open = ref(false)
const btnRef = ref(null)
const triggerEl = computed(() => (btnRef.value ? btnRef.value.el : null))

const items = computed(() =>
  props.options.map((o) => (typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value })),
)
const selected = computed(() => items.value.find((it) => String(it.value) === String(props.modelValue)))
const displayText = computed(() => (selected.value ? selected.value.label : props.placeholder))

function toggle() {
  if (props.disabled) return
  fieldCtx?.markTouched()
  open.value = !open.value
}

function onSelect(value) {
  fieldCtx?.markTouched()
  emit('update:modelValue', value)
  emit('select', value)
}

function onClose() {
  open.value = false
}
</script>

<template>
  <div class="ui-dropdown">
    <UiButton
      ref="btnRef"
      :variant="variant === 'A' ? 'A' : 'B'"
      :disabled="disabled"
      :width="width"
      :surface="resolvedFill === 'gray-10' ? 'gray-10' : ''"
      :lift="false"
      class="ui-dropdown__btn"
      :class="{ 'is-open': open }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="ui-dropdown__content">
        <span class="ui-dropdown__text" :class="{ 'is-placeholder': !selected }">{{ displayText }}</span>
        <ArrowDown class="ui-dropdown__v" aria-hidden="true" />
      </span>
    </UiButton>

    <UiDropdownPanel
      :open="open"
      :variant="variant"
      :options="options"
      :model-value="modelValue"
      :trigger="triggerEl"
      :align="align"
      :align-x="alignX"
      :columns="columns"
      :min-width-px="panelMinWidth"
      @select="onSelect"
      @close="onClose"
    />
  </div>
</template>

<style scoped>
.ui-dropdown {
  display: inline-block;
}
.ui-dropdown__content {
  display: inline-flex;
  align-items: center;
  gap: var(--btn-gap, 1em);
  max-width: 100%;
}
.ui-dropdown__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-dropdown__text.is-placeholder {
  color: var(--gray-50);
}
.ui-dropdown__v {
  flex: none;
  width: 1em;
  height: 1em;
  transition: transform var(--dur-sm) var(--ease-out);
}
.ui-dropdown.is-open .ui-dropdown__v,
.ui-dropdown__btn.is-open .ui-dropdown__v {
  transform: rotate(180deg);
}
</style>
