<script setup>
import { computed, ref } from 'vue'
import { useRipple } from '@/composables/useRipple'
import ArrowRight from '@/assets/svg/arrow-right.svg'
import ArrowLeft from '@/assets/svg/arrow-left.svg'
import Magnifier from '@/assets/svg/magnifier.svg'

/**
 * UiButton - Button library (plan "component common styles")
 * -------------------------------------------------------
 * - variant:
 *   A   capsule + fill matching background + thin black border + fixed width + hover gray-15 ripple / click gray-30 + grayed disabled
 *   A1  A + right arrow (60-deg acute angle, shifts right on focus)
 *   B   A's hit/focus/click, but resting no fill no border black text (no lift on focus)
 *   B1  A1's no-fill no-border black text
 *   B2  B1 but arrow swapped for a magnifier ("show details")
 *   C   A but rounded rectangle
 *   C1  A1 but rounded rectangle
 *   S   plain black text, hit area = text rectangle, focus turns gray-60
 *   S1  like S but underlined, smaller font, text+underline gray-60, focus turns black
 * - fill: 'paper' | 'brand' | 'danger' - hover/click palette for non-white fills
 *   (dark fills grayscale -15/-30; colors saturation +10/+20 - already precomputed in tokens)
 * - Ripple = CSS variable data channel (useRipple), durations from tokens, reduced-motion respected.
 * - Zero inline event/style attributes (Vue template bindings are framework-level, not HTML inline).
 */
const props = defineProps({
  variant: {
    type: String,
    default: 'A',
    validator: (v) => ['A', 'A1', 'B', 'B1', 'B2', 'C', 'C1', 'S', 'S1'].includes(v),
  },
  disabled: { type: Boolean, default: false },
  type: { type: String, default: 'button' },
  /** override fixed width (CSS length value) */
  width: { type: String, default: '' },
  fill: { type: String, default: 'paper', validator: (v) => ['paper', 'brand', 'danger'].includes(v) },
  size: { type: String, default: '', validator: (v) => ['', 'sm', 'lg'].includes(v) },
  /** override default arrow: ''=inferred from variant | 'none' | 'right' | 'left' | 'magnifier' */
  arrow: { type: String, default: '' },
  /** circular button (icon button, width=height) */
  circle: { type: Boolean, default: false },
  /** stretch to fill parent width */
  block: { type: Boolean, default: false },
  /** surface fill override: '' | 'gray-10' (info input area default gray-10 background) */
  surface: { type: String, default: '', validator: (v) => ['', 'gray-10'].includes(v) },
  /** whether A-series lifts on hover (disabled for dropdown buttons etc.) */
  lift: { type: Boolean, default: true },
})

const emit = defineEmits(['click'])
const el = ref(null)

useRipple(el, { disabled: computed(() => props.disabled) })

const isPill = computed(() => ['A', 'A1', 'B', 'B1', 'B2'].includes(props.variant))
const isRounded = computed(() => ['C', 'C1'].includes(props.variant))
const isText = computed(() => ['S', 'S1'].includes(props.variant))
const isBare = computed(() => ['B', 'B1', 'B2'].includes(props.variant))
const arrowVariant = computed(() => ['A1', 'B1', 'C1'].includes(props.variant))

const effArrow = computed(() => {
  if (props.arrow === 'none') return ''
  if (props.arrow) return props.arrow
  if (props.variant === 'B2') return 'magnifier'
  if (arrowVariant.value) return 'right'
  return ''
})

const classes = computed(() => [
  'ui-btn',
  `ui-btn--${props.variant.toLowerCase()}`,
  {
    'ui-btn--pill': isPill.value,
    'ui-btn--rounded': isRounded.value,
    'ui-btn--text': isText.value,
    'ui-btn--bare': isBare.value,
    'is-disabled': props.disabled,
    'ui-btn--fill-brand': props.fill === 'brand',
    'ui-btn--fill-danger': props.fill === 'danger',
    'ui-btn--lg': props.size === 'lg',
    'ui-btn--sm': props.size === 'sm',
    'ui-btn--circle': props.circle,
    'ui-btn--block': props.block,
    'ui-btn--arrow-left': effArrow.value === 'left',
    'ui-btn--surface-gray10': props.surface === 'gray-10',
    'ui-btn--no-lift': !props.lift,
  },
])

const styleVar = computed(() => (props.width ? { '--btn-w': props.width } : null))

function onClick(e) {
  if (props.disabled) return
  emit('click', e)
}

defineExpose({ el })
</script>

<template>
  <button
    ref="el"
    :class="classes"
    :disabled="disabled"
    :type="type"
    :style="styleVar"
    @click="onClick"
  >
    <template v-if="effArrow === 'left'">
      <ArrowLeft class="ui-btn__arrow" aria-hidden="true" />
      <span class="ui-btn__label"><slot /></span>
    </template>
    <template v-else>
      <span class="ui-btn__label"><slot /></span>
      <ArrowRight v-if="effArrow === 'right'" class="ui-btn__arrow" aria-hidden="true" />
      <Magnifier v-else-if="effArrow === 'magnifier'" class="ui-btn__arrow" aria-hidden="true" />
    </template>
  </button>
</template>

<style scoped>
/* =========== base =========== */
.ui-btn {
  /* component tokens (parent can override) */
  --btn-w: 220px;
  --btn-h: 52px;
  --btn-fs: 16px;
  --btn-pad: calc(var(--btn-h) / 2);   /* >= half-radius: text endpoints stay inside the two half-circle centers */
  --btn-radius: calc(var(--btn-h) / 2);/* capsule: exact half-circles at both ends */
  --btn-gap: 1em;                      /* text <-> arrow ~ one full-width space */
  --btn-hover-bg: var(--gray-15);
  --btn-click-bg: var(--gray-30);
  --btn-hover-ink: var(--gray-60);
  --btn-dur-in: var(--dur-xs);
  --btn-dur-color: var(--dur-sm);
  --btn-dur-focus: var(--dur-md);
  --btn-dur-out: var(--dur-md);
  --btn-dur-click: var(--dur-xl);
  --btn-arrow-shift: 4px;

  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--btn-gap);
  box-sizing: border-box;
  width: var(--btn-w);
  height: var(--btn-h);
  padding: 0 var(--btn-pad);
  border: var(--border-w) solid transparent;
  border-radius: var(--btn-radius);
  background: transparent;
  color: var(--ink);
  font-size: var(--btn-fs);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;          /* clip circle layer and overlong text inside the capsule */
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--btn-dur-color) var(--ease-out);
}

/* variant resting */
.ui-btn--pill.ui-btn--a,
.ui-btn--pill.ui-btn--a1,
.ui-btn--rounded.ui-btn--c,
.ui-btn--rounded.ui-btn--c1 {
  background: var(--btn-bg, var(--paper));
  border-color: var(--ink);
}
/* info input area inputs default gray-10 background */
.ui-btn--surface-gray10 { --btn-bg: var(--gray-10); }
.ui-btn--pill.ui-btn--b,
.ui-btn--pill.ui-btn--b1,
.ui-btn--pill.ui-btn--b2 {
  border-color: transparent;
}

/* text variants (S/S1): hit area = text rectangle, no ripple no clipping */
.ui-btn--text {
  width: auto;
  height: auto;
  padding: 0;
  overflow: visible;
  border: none;
  background: transparent;
  white-space: normal;
}
.ui-btn--text::before,
.ui-btn--text::after,
.ui-btn--text .ui-btn__arrow { display: none; }

.ui-btn--s { font-size: var(--fs-base); transition: color var(--btn-dur-color) var(--ease-out); }
.ui-btn--s1 {
  font-size: var(--fs-sm);
  color: var(--gray-60);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--btn-dur-color) var(--ease-out);
}
.ui-btn--s:hover,
.ui-btn--s:focus-visible { color: var(--gray-60); }
.ui-btn--s1:hover,
.ui-btn--s1:focus-visible { color: var(--ink); }

/* size tiers */
.ui-btn--lg { --btn-w: 260px; --btn-h: 64px; --btn-fs: 20px; }
.ui-btn--sm { --btn-w: 120px; --btn-h: 40px; --btn-fs: 14px; }
.ui-btn--circle { --btn-pad: 0; --btn-radius: 50%; --btn-w: var(--btn-h); }
.ui-btn--block { width: 100%; }

/* focus ring (radius follows capsule, box-shadow not clipped by overflow) */
.ui-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }

/* =========== dual circle layers (ripple) =========== */
.ui-btn::before,
.ui-btn::after {
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

/* hover pale-gray layer: cascade opacity + animation drives transform only
   (opacity in cascade rules, on unhover the :hover mismatch triggers base transition to fade back evenly) */
.ui-btn::before {
  background: var(--btn-hover-bg);
  transform: scale(1);
  opacity: 0;
  transition: opacity var(--btn-dur-out) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ui-btn:hover::before,
  .ui-btn:focus-visible::before {
    opacity: 1;
    animation: ui-btn-hover-in var(--btn-dur-in) var(--ease-out) forwards;
  }
}
@keyframes ui-btn-hover-in {
  from { transform: scale(0); }
  to { transform: scale(1); }
}

/* click dark layer: one-shot animation (spread to fill -> fade back evenly) */
.ui-btn::after { background: var(--btn-click-bg); }
.ui-btn.is-rippling::after {
  animation: ui-ripple var(--btn-dur-click) var(--ease-out) forwards;
}

/* =========== content layer =========== */
.ui-btn__label,
.ui-btn__arrow {
  position: relative;
  z-index: 1;
  transition: color var(--btn-dur-color) var(--ease-out);
}
.ui-btn__arrow {
  flex: none;
  width: 1em;
  height: 1em;
  transition:
    transform var(--btn-dur-color) var(--ease-out),
    color var(--btn-dur-color) var(--ease-out);
}

/* hover: text/SVG fade to gray-60; arrow focus shift (direction follows arrow) */
@media (hover: hover) and (pointer: fine) {
  .ui-btn:hover .ui-btn__label,
  .ui-btn:hover .ui-btn__arrow,
  .ui-btn:focus-visible .ui-btn__label,
  .ui-btn:focus-visible .ui-btn__arrow { color: var(--btn-hover-ink); }

  .ui-btn:hover .ui-btn__arrow,
  .ui-btn:focus-visible .ui-btn__arrow { transform: translateX(var(--btn-arrow-shift)); }
  .ui-btn--arrow-left:hover .ui-btn__arrow,
  .ui-btn--arrow-left:focus-visible .ui-btn__arrow { transform: translateX(calc(var(--btn-arrow-shift) * -1)); }
}

/* =========== non-white fill palettes (brand purple / danger red) ===========
   dark fills: grayscale -15/-30 + hue saturation +10/+20 (token precomputed);
   inner text stays white (--btn-hover-ink overridden to brand ink). */
.ui-btn--fill-brand {
  background: var(--brand);
  border-color: transparent;
  color: var(--brand-ink);
  --btn-hover-bg: var(--brand-hover);
  --btn-click-bg: var(--brand-active);
  --btn-hover-ink: var(--brand-ink);
}
.ui-btn--fill-danger {
  background: var(--danger);
  border-color: transparent;
  color: var(--danger-ink);
  --btn-hover-bg: var(--danger-hover);
  --btn-click-bg: var(--danger-active);
  --btn-hover-ink: var(--danger-ink);
}

/* A-series hover micro-lift (B/B1/B2/S/S1 no lift; no-lift explicitly disables, e.g. dropdown buttons) */
@media (hover: hover) and (pointer: fine) {
  .ui-btn--a:hover,
  .ui-btn--a1:hover,
  .ui-btn--c:hover,
  .ui-btn--c1:hover { transform: translateY(var(--btn-lift)); }
  .ui-btn--no-lift:hover { transform: none; }
}

/* =========== grayed disabled =========== */
.ui-btn.is-disabled {
  cursor: default;
  color: var(--gray-50);
  box-shadow: none;
  transform: none !important;
}
.ui-btn.is-disabled::before,
.ui-btn.is-disabled::after { display: none; }
.ui-btn.is-disabled .ui-btn__label,
.ui-btn.is-disabled .ui-btn__arrow { color: var(--gray-50); }
.ui-btn.is-disabled.ui-btn--fill-brand {
  background: var(--brand-disabled);
  border-color: transparent;
  color: var(--gray-50);
}
.ui-btn.is-disabled.ui-btn--fill-danger {
  background: var(--danger-disabled);
  border-color: transparent;
  color: var(--gray-50);
}

/* =========== reduced-motion fallback =========== */
@media (prefers-reduced-motion: reduce) {
  .ui-btn::before,
  .ui-btn::after,
  .ui-btn.is-rippling::after,
  .ui-btn__label,
  .ui-btn__arrow { animation: none; transition: none; }
  .ui-btn:hover::before,
  .ui-btn:focus-visible::before { opacity: 1; transform: scale(1); }
  .ui-btn::after { opacity: 0; }
}
</style>
