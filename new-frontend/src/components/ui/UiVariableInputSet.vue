<script setup>
import { computed } from 'vue'
import { UI_COPY } from '@/constants/ui.js'
import { vRipple } from '@/directives/ripple.js'
import Close from '@/assets/svg/close.svg'
import Plus from '@/assets/svg/plus.svg'

/**
 * UiVariableInputSet - Variable input set A (plan "input component styles - variable input set A")
 * -------------------------------------------------------
 * - Itself has no fill and no border, but has fill-color/move interfaces (fill instruction passes through to all inner inputs).
 * - Contains one or more same-kind normal inputs stacked vertically; left edge aligned, right edge leaves 10% blank from the set's right edge.
 * - Inside the right 10% blank, each row aligns a round X button B (deletes the row); the first row's X is grayed out.
 * - Below the rows, a plus round button B (new row) aligned to the left edge of the set.
 * - The X/plus are unaffected by the "gray-10 fill" instruction and stay white.
 * - All rows evenly distributed with proper spacing, dynamically stretching the set.
 * - Ripple = v-ripple directive (suited for v-for dynamic buttons).
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  /** input component rendered per row (Vue component) */
  inputComponent: { type: Object, required: true },
  /** props passed to each input component (recommend passing width:'100%') */
  inputProps: { type: Object, default: () => ({}) },
  /** max rows (0 = unlimited) */
  max: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue'])

const list = computed(() => props.modelValue)

function updateItem(i, v) {
  const next = list.value.slice()
  next[i] = v
  emit('update:modelValue', next)
}

function removeItem(i) {
  const next = list.value.slice()
  next.splice(i, 1)
  emit('update:modelValue', next)
}

function addItem() {
  if (props.max > 0 && list.value.length >= props.max) return
  emit('update:modelValue', list.value.concat(['']))
}

const atMax = computed(() => props.max > 0 && list.value.length >= props.max)
</script>

<template>
  <div class="ui-varset">
    <div
      v-for="(item, i) in list"
      :key="i"
      class="ui-varset__row"
    >
      <div class="ui-varset__input">
        <component
          :is="inputComponent"
          v-bind="inputProps"
          :model-value="item"
          @update:model-value="(v) => updateItem(i, v)"
        />
      </div>
      <button
        type="button"
        v-ripple
        class="ui-varset__remove"
        :class="{ 'is-disabled': i === 0 }"
        :disabled="i === 0"
        :aria-label="UI_COPY.VARSET_REMOVE"
        @click="removeItem(i)"
      >
        <Close class="ui-varset__remove-icon" aria-hidden="true" />
      </button>
    </div>

    <button
      type="button"
      v-ripple
      class="ui-varset__add"
      :class="{ 'is-disabled': atMax }"
      :disabled="atMax"
      :aria-label="UI_COPY.VARSET_ADD"
      @click="addItem"
    >
      <Plus class="ui-varset__add-icon" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.ui-varset {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.ui-varset__row {
  position: relative;
  margin-bottom: var(--space-4);
}
.ui-varset__row:last-child { margin-bottom: 0; }

/* input aligns to the set's left edge, right edge leaves 10% blank from the set's right edge */
.ui-varset__input {
  width: 90%;
  min-width: 0;
}

/* X: inside the right 10% blank, horizontally aligned with the input, vertically centered */
.ui-varset__remove {
  position: absolute;
  right: calc(var(--space-2) + 1%);
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.ui-varset__remove:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }
.ui-varset__remove-icon {
  width: 16px;
  height: 16px;
  position: relative;
  z-index: 1;
}
.ui-varset__remove.is-disabled {
  color: var(--gray-50);
  cursor: default;
}

/* plus: below the rows, aligned to the set's left edge */
.ui-varset__add {
  margin-top: var(--space-4);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--ink);
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
}
.ui-varset__add:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }
.ui-varset__add-icon {
  width: 20px;
  height: 20px;
  position: relative;
  z-index: 1;
}
.ui-varset__add.is-disabled {
  color: var(--gray-50);
  cursor: default;
}

/* ripple (X/plus, white round button B) */
.ui-varset__remove::before,
.ui-varset__remove::after,
.ui-varset__add::before,
.ui-varset__add::after {
  content: "";
  position: absolute;
  left: var(--mx, 50%);
  top: var(--my, 50%);
  width: var(--btn-d, 120px);
  height: var(--btn-d, 120px);
  margin-left: calc(var(--btn-d, 120px) / -2);
  margin-top: calc(var(--btn-d, 120px) / -2);
  border-radius: 50%;
  transform: scale(0);
  opacity: 0;
  pointer-events: none;
}
.ui-varset__remove::before,
.ui-varset__add::before {
  background: var(--gray-15);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--dur-md) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-varset__remove:hover::before,
  .ui-varset__add:hover::before,
  .ui-varset__remove:focus-visible::before,
  .ui-varset__add:focus-visible::before {
    opacity: 1;
    animation: ui-varset-in var(--dur-xs) var(--ease-out) forwards;
  }
}
@keyframes ui-varset-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}
.ui-varset__remove::after,
.ui-varset__add::after { background: var(--gray-30); }
.ui-varset__remove.is-rippling::after,
.ui-varset__add.is-rippling::after {
  animation: ui-ripple var(--dur-xl) var(--ease-out) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .ui-varset__remove,
  .ui-varset__add,
  .ui-varset__remove::before,
  .ui-varset__remove::after,
  .ui-varset__add::before,
  .ui-varset__add::after { transition: none; animation: none; }
}
</style>
