<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { UI_CONSTANTS } from '@/constants/ui.js'
import { injectFieldContext, injectFieldFill } from '@/composables/useFieldContext'

/**
 * UiInput - Input A (plan "input component styles - input A")
 * -------------------------------------------------------
 * - Capsule shape (zero vertical line), white fill no border; focus smoothly fades to gray-10.
 * - Placeholder text is gray-30, present only when empty and not focused.
 * - On focus a thin line appears 5px above the bottom (divider config), under the text.
 * - Char limit: when remaining < 60, a second line under the input shows remaining chars (<10 red); released on blur.
 * - Auto-grows on newline into a rounded rectangle; Enter sends (shift/ctrl+enter for manual newline); grow direction configurable (default down).
 * - Text-type filtering (digits only etc.) strips illegal chars on input.
 * - fill: paper (default) / gray-10 (info input area default gray-10) / none (dropdown-style input forces no fill, focus mask unchanged).
 * - Info input area context: auto-reports "interacted" (yellow star disappears).
 */
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  placeholder: { type: String, default: '' },
  /** input filter: none | digits | phone | idcard | alnum */
  filter: { type: String, default: 'none' },
  maxLength: { type: Number, default: 0 },
  /** grow direction: down | up (up needs module to bottom-anchor) */
  growDirection: { type: String, default: 'down', validator: (v) => ['down', 'up'].includes(v) },
  /** whether Enter sends (false = Enter inserts newline) */
  sendOnEnter: { type: Boolean, default: true },
  /** taller input (lift should be a whole-line multiple; text top-aligned, underline still 5px from bottom) */
  minHeight: { type: String, default: '' },
  fill: {
    type: String,
    default: 'auto',
    validator: (v) => ['auto', 'paper', 'gray-10', 'none', 'bare'].includes(v),
  },
  width: { type: String, default: '' },
  /** underline right inset override (captcha input: right 30% shifted further left) */
  underlineInsetRight: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'send', 'focus', 'blur', 'input'])

const taRef = ref(null)
const focused = ref(false)
const fieldCtx = injectFieldContext()
const fieldFill = injectFieldFill()

/** fill='auto' -> gray-10 inside info input area, otherwise paper */
const resolvedFill = computed(() =>
  props.fill === 'auto' ? fieldFill || 'paper' : props.fill,
)

const baseH = computed(() => {
  if (props.minHeight) {
    const n = parseInt(props.minHeight, 10)
    if (!Number.isNaN(n)) return n
  }
  return 44
})

const showPlaceholder = computed(() => String(props.modelValue).length === 0 && !focused.value)
const remaining = computed(() =>
  props.maxLength ? Math.max(0, props.maxLength - String(props.modelValue).length) : 0,
)
const showCounter = computed(
  () =>
    focused.value &&
    props.maxLength > 0 &&
    remaining.value < UI_CONSTANTS.INPUT_COUNTER_SHOW_THRESHOLD,
)

const rootStyle = computed(() => {
  const s = {}
  if (props.width) s['--input-w'] = props.width
  if (props.underlineInsetRight) s['--input-underline-r'] = props.underlineInsetRight
  return s
})

function filterValue(raw) {
  let v = raw
  if (props.filter === 'digits') v = v.replace(/\D/g, '')
  else if (props.filter === 'phone') v = v.replace(/[^\d+]/g, '').slice(0, 20)
  else if (props.filter === 'idcard') v = v.replace(/[^0-9Xx]/g, '').toUpperCase().slice(0, 18)
  else if (props.filter === 'alnum') v = v.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '')
  if (props.maxLength > 0) v = v.slice(0, props.maxLength)
  return v
}

function autoResize() {
  const ta = taRef.value
  if (!ta) return
  ta.style.height = 'auto'
  const h = Math.max(baseH.value, ta.scrollHeight)
  ta.style.height = h + 'px'
}

function onInput(e) {
  const raw = e.target.value
  const v = filterValue(raw)
  if (v !== raw) e.target.value = v
  emit('update:modelValue', v)
  emit('input', v)
  fieldCtx?.markTouched()
  autoResize()
}

function onKeydown(e) {
  if (e.key === 'Enter' && props.sendOnEnter) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return // manual newline
    e.preventDefault()
    emit('send', props.modelValue)
  }
}

function onFocus() {
  focused.value = true
  fieldCtx?.markTouched()
  emit('focus')
}

function onBlur() {
  focused.value = false
  emit('blur')
}

onMounted(autoResize)
watch(() => props.modelValue, () => autoResize())

defineExpose({
  focus: () => taRef.value && taRef.value.focus(),
  blur: () => taRef.value && taRef.value.blur(),
})
</script>

<template>
  <div
    class="ui-input"
    :class="[
      `ui-input--fill-${resolvedFill}`,
      { 'is-focused': focused, 'has-counter': showCounter, 'is-disabled': disabled },
    ]"
    :style="rootStyle"
  >
    <div class="ui-input__main">
      <textarea
        ref="taRef"
        class="ui-input__ta"
        :value="modelValue"
        rows="1"
        :aria-label="placeholder || undefined"
        :disabled="disabled"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
      ></textarea>
      <span v-if="showPlaceholder" class="ui-input__placeholder" aria-hidden="true">{{ placeholder }}</span>
      <span class="ui-input__underline" :class="{ 'is-visible': focused }"></span>
    </div>
    <div v-if="showCounter" class="ui-input__counter" :class="{ 'is-warn': remaining < 10 }">
      {{ remaining }}
    </div>
  </div>
</template>

<style scoped>
.ui-input {
  --input-w: 280px;
  --input-h: 44px;
  --input-pad-y: 11px;
  --input-pad-x: var(--space-4);
  --input-lh: 20px;
  --input-radius: calc(var(--input-h) / 2);
  --input-underline-r: var(--input-radius);

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--input-w); /* intrinsic max; shrinks in narrow containers (mobile 375 FieldInput fix) */
  min-width: 0;
  background: var(--paper);
  border-radius: var(--input-radius);
  overflow: hidden;
  transition: background var(--dur-sm) var(--ease-out);
}
.ui-input.is-focused { background: var(--gray-10); }
.ui-input--fill-none { background: transparent; }
.ui-input--fill-none.is-focused { background: var(--gray-10); } /* focus gray mask unchanged */
.ui-input--fill-gray10 { background: var(--gray-10); }
.ui-input--fill-bare { background: transparent; }
.ui-input--fill-bare.is-focused { background: transparent; } /* container manages focus mask */
.ui-input.is-disabled { opacity: 0.6; }

.ui-input__main {
  position: relative;
}

.ui-input__ta {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: var(--input-h);
  padding: var(--input-pad-y) var(--input-pad-x);
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: var(--input-lh);
  resize: none;
  overflow: hidden;
}
.ui-input__ta::placeholder { color: transparent; }
.ui-input.is-disabled .ui-input__ta { cursor: default; }

/* placeholder: present when empty and not focused (gray-30, same font size) */
.ui-input__placeholder {
  position: absolute;
  left: var(--input-pad-x);
  top: 50%;
  transform: translateY(-50%);
  color: var(--gray-30);
  font-size: var(--fs-base);
  line-height: var(--input-lh);
  white-space: pre-wrap;
  pointer-events: none;
  max-width: calc(100% - var(--input-pad-x) * 2);
  overflow: hidden;
}

/* underline: 5px above bottom, left/right = capsule straight-segment bounds (apply divider config) */
.ui-input__underline {
  position: absolute;
  left: var(--input-radius);
  right: var(--input-underline-r);
  bottom: 5px;
  height: 1px;
  background: var(--line);
  opacity: 0;
  transition: opacity var(--dur-sm) var(--ease-out);
}
.ui-input__underline.is-visible { opacity: 1; }

/* remaining chars: released on blur (v-if), <10 red */
.ui-input__counter {
  padding: 0 var(--input-pad-x) 6px;
  text-align: right;
  color: var(--gray-75);
  font-size: var(--fs-sm);
  line-height: 1;
  user-select: none;
}
.ui-input__counter.is-warn { color: var(--danger); }

@media (prefers-reduced-motion: reduce) {
  .ui-input { transition: none; }
}
</style>
