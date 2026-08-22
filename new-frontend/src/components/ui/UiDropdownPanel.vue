<script setup>
import { computed, ref, watch } from 'vue'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { UI_COPY } from '@/constants/ui.js'

/**
 * UiDropdownPanel - Dropdown panel (plan "input component styles - dropdown panel A/B")
 * -------------------------------------------------------
 * - A: rounded rectangle, no border, wide gradient shadow, system-level module selection; slightly larger font, wider margins; >10 items auto button grid (multi-column)
 * - B: bordered, smaller shadow, specific-info selection; standard font, smaller buttons
 * - Item = button B (black text), focus fill appears/disappears instantly (suited to fast caret movement); small rounded rectangle (not sausage-like);
 *   vertically adjacent items touch edges, but item height is generous -> adjacent text/SVG line spacing >= 2x font height.
 * - Summon animation: float in toward the summon direction + fade (small but visible shift); direction decided by align.
 * - Not scrollable; >10 items auto multi-column button grid.
 * - Close: click outside the panel / outside the trigger element -> emit('close').
 */
const props = defineProps({
  variant: { type: String, default: 'B', validator: (v) => ['A', 'B'].includes(v) },
  open: { type: Boolean, default: false },
  /** summon direction (float-in animation direction) */
  align: { type: String, default: 'down', validator: (v) => ['down', 'up', 'left', 'right'].includes(v) },
  alignX: { type: String, default: 'left', validator: (v) => ['left', 'center', 'right'].includes(v) },
  options: { type: Array, default: () => [] }, // Array<string> | Array<{label,value}>
  modelValue: { type: [String, Number], default: '' },
  /** anchor element (the trigger that summoned the dropdown) */
  trigger: { type: Object, default: null },
  /** explicit column count (default: >10 items auto multi-column) */
  columns: { type: Number, default: 0 },
  matchWidth: { type: Boolean, default: false },
  minWidth: { type: Boolean, default: true },
  /** panel min width (CSS length) */
  minWidthPx: { type: String, default: '' },
})

const emit = defineEmits(['select', 'close', 'update:modelValue'])

const panelRef = ref(null)
const triggerRef = computed(() => props.trigger)
const { style: panelStyle, placeNextTick, bind, unbind } = useAnchoredPanel(panelRef, triggerRef, {
  align: computed(() => props.align),
  alignX: computed(() => props.alignX),
  matchWidth: props.matchWidth,
  minWidth: props.minWidth,
})

useFocusTrap(panelRef, { active: computed(() => props.open) })

const items = computed(() =>
  props.options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value },
  ),
)
const cols = computed(() => {
  if (props.columns > 0) return props.columns
  return items.value.length > 10 ? Math.ceil(items.value.length / 10) : 1
})
const isMulti = computed(() => cols.value > 1)

function selectItem(value) {
  emit('update:modelValue', value)
  emit('select', value)
  emit('close')
}

function onDocPointerDown(e) {
  if (!props.open) return
  const p = panelRef.value
  const t = props.trigger
  if (p && p.contains(e.target)) return
  if (t && t.contains(e.target)) return
  emit('close')
}

watch(
  () => props.open,
  (val) => {
    if (val) {
      placeNextTick()
      bind()
      document.addEventListener('pointerdown', onDocPointerDown, true)
    } else {
      unbind()
      document.removeEventListener('pointerdown', onDocPointerDown, true)
    }
  },
)

watch(
  () => props.options,
  () => {
    if (props.open) placeNextTick()
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition :name="`ui-drop-${align}`">
      <div
        v-if="open"
        ref="panelRef"
        class="ui-droppanel"
        :class="[`ui-droppanel--${variant.toLowerCase()}`, { 'ui-droppanel--multi': isMulti }]"
        :style="[panelStyle, minWidthPx ? { minWidth: minWidthPx } : null]"
        role="listbox"
        :aria-label="UI_COPY.DROPDOWN_LIST"
      >
        <div class="ui-droppanel__grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }">
          <button
            v-for="it in items"
            :key="it.value"
            type="button"
            class="ui-droppanel__item"
            :class="{ 'is-selected': String(it.value) === String(modelValue) }"
            role="option"
            :aria-selected="String(it.value) === String(modelValue)"
            @click="selectItem(it.value)"
          >
            {{ it.label }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-droppanel {
  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float);
}
.ui-droppanel--b {
  border: var(--border-w) solid var(--line);
  box-shadow: var(--shadow-float-sm);
}
.ui-droppanel--a { font-size: calc(var(--fs-base) * 1.1); }
.ui-droppanel--b { font-size: var(--fs-base); }

.ui-droppanel__grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(10, auto);
  grid-auto-columns: minmax(0, 1fr);
  column-gap: var(--space-1);
}
.ui-droppanel:not(.ui-droppanel--multi) .ui-droppanel__grid {
  display: block;
}

/* item = button B: black text, small rounded rectangle, instant pale-gray focus */
.ui-droppanel__item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
/* vertically adjacent item line spacing >= 2x font height: item min-height = 1.6x font size (extra after padding) */
.ui-droppanel__item {
  min-height: calc(var(--fs-base) * 1.6);
}
.ui-droppanel--a .ui-droppanel__item { min-height: calc(var(--fs-base) * 1.7); }

/* focus fill appears/disappears instantly (no transition) */
.ui-droppanel__item:hover,
.ui-droppanel__item:focus-visible {
  outline: none;
  background: var(--gray-10);
}
.ui-droppanel__item.is-selected {
  background: var(--gray-10);
  color: var(--ink);
  font-weight: 500;
}

/* -- summon float-in + fade (direction follows align) -- */
.ui-drop-down-enter-active,
.ui-drop-down-leave-active,
.ui-drop-up-enter-active,
.ui-drop-up-leave-active,
.ui-drop-left-enter-active,
.ui-drop-left-leave-active,
.ui-drop-right-enter-active,
.ui-drop-right-leave-active {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.ui-drop-down-enter-from,
.ui-drop-down-leave-to { opacity: 0; transform: translateY(-6px); }
.ui-drop-up-enter-from,
.ui-drop-up-leave-to { opacity: 0; transform: translateY(6px); }
.ui-drop-left-enter-from,
.ui-drop-left-leave-to { opacity: 0; transform: translateX(6px); }
.ui-drop-right-enter-from,
.ui-drop-right-leave-to { opacity: 0; transform: translateX(-6px); }

@media (prefers-reduced-motion: reduce) {
  .ui-droppanel { transition: none; }
}
</style>
