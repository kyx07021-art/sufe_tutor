<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'
import { PERSONALITY_TAGS, tagLabel } from '@/modules/my-demands/region.js'
import ArrowDown from '@/assets/svg/arrow-down.svg'

/**
 * PersonalityFilter - M7-10 teacher-personality filter card (multi-select check rows)
 * ----------------------------------------------------------------------------------
 * - Card: title (T.FILTER_TITLE_PERSONALITY) above, trigger (rounded rectangle,
 *   left-aligned) below. Resting text = T.FILTER_ALL_PERSONALITY; once tags are
 *   selected the trigger shows them comma-joined with a single-line ellipsis.
 * - Clicking the trigger opens a Teleported panel listing every tag in
 *   region.js PERSONALITY_TAGS as UiCheckButton rows (single column, variant B).
 *   Toggling mutates the selection array of ENGLISH ids only (PA-2-F4: the
 *   backend /api/teachers matches personalities by English id while the previous
 *   copy pool used Chinese labels, so any personality filter returned zero
 *   cards); labels come from tagLabel(). Rows toggle in/out and the panel stays
 *   open while toggling (multi-select). It closes on click-outside (capture-phase
 *   pointerdown) or Escape (which returns focus to the trigger).
 * - Any-hit matching semantics belong to the match engine
 *   (match-dimensions.js personality dimension), not to this component.
 * - Emits: update:modelValue(next array), change(next array).
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const triggerRef = ref(null)
const panelRef = ref(null)

const { style: panelStyle, placeNextTick, bind, unbind } = useAnchoredPanel(panelRef, triggerRef, {
  align: 'down',
  alignX: 'left',
})

/** Normalized selection (guards null / undefined, contract C3). */
const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

const isSelected = (tag) => selected.value.includes(tag)

const displayText = computed(() =>
  selected.value.length ? selected.value.map(tagLabel).join(T.FILTER_JOIN) : T.FILTER_ALL_PERSONALITY,
)

function toggleTag(tag) {
  const next = isSelected(tag)
    ? selected.value.filter((x) => x !== tag)
    : [...selected.value, tag]
  emit('update:modelValue', next)
  emit('change', next)
}

function toggleOpen() {
  open.value = !open.value
}

function onDocPointerDown(e) {
  if (!open.value) return
  const p = panelRef.value
  const t = triggerRef.value
  if (p && p.contains(e.target)) return
  if (t && t.contains(e.target)) return
  open.value = false
}

function onDocKeydown(e) {
  if (!open.value) return
  if (e.key !== 'Escape') return
  open.value = false
  triggerRef.value?.focus()
}

watch(open, (val) => {
  if (val) {
    placeNextTick()
    bind()
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown, true)
  } else {
    unbind()
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown, true)
  }
})

onBeforeUnmount(() => {
  unbind()
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown, true)
})
</script>

<template>
  <div class="pf">
    <span class="pf__title">{{ T.FILTER_TITLE_PERSONALITY }}</span>
    <button
      ref="triggerRef"
      type="button"
      class="pf__trigger"
      :class="{ 'is-open': open, 'is-selected': selected.length > 0 }"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <span class="pf__trigger-text">{{ displayText }}</span>
      <ArrowDown class="pf__chevron" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="pf-drop">
        <div
          v-if="open"
          ref="panelRef"
          class="pf-panel"
          role="group"
          :aria-label="T.FILTER_TITLE_PERSONALITY"
          :style="panelStyle"
        >
          <div class="pf-panel__list">
            <UiCheckButton
              v-for="tag in PERSONALITY_TAGS"
              :key="tag.value"
              variant="B"
              :model-value="isSelected(tag.value)"
              :label="tag.label"
              @update:model-value="toggleTag(tag.value)"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.pf {
  display: inline-flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 100%;
}

.pf__title {
  color: var(--gray-60);
  font-size: var(--fs-sm);
  line-height: var(--lh-tight);
}

/* trigger: rounded rectangle, left-aligned text, trailing chevron */
.pf__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: 220px;
  max-width: 100%;
  height: var(--input-h);
  padding: 0 var(--input-pad-x);
  border: var(--border-w) solid var(--ink);
  border-radius: var(--radius-md);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-base);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-sm) var(--ease-out);
}
.pf__trigger:hover { background: var(--gray-10); }
.pf__trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }

.pf__trigger-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.pf__trigger:not(.is-selected) .pf__trigger-text { color: var(--gray-50); }

.pf__chevron {
  flex: none;
  width: 1em;
  height: 1em;
  color: var(--gray-50);
  transition: transform var(--dur-sm) var(--ease-out);
}
.pf__trigger.is-open .pf__chevron { transform: rotate(180deg); }

/* Teleported panel: fixed position anchored to the trigger; list keeps a
   stable 220px width so a checked (stretched) row never overflows. */
.pf-panel {
  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  padding: var(--space-2);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float-sm);
}
.pf-panel__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 220px; /* matches trigger width; reserves room for a stretched row */
}
/* Compact check rows: unchecked 180px, checked 180 + 40 stretch = 220px = list width.
   :deep(.ui-checkbtn) beats the component's own token defaults (specificity 0,3,0 > 0,2,0). */
.pf-panel__list :deep(.ui-checkbtn) {
  --btn-w: 180px;
  --btn-h: 40px;
  --checkbtn-stretch: 40px;
}

/* float-in + fade (direction follows align: down) */
.pf-drop-enter-active,
.pf-drop-leave-active {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.pf-drop-enter-from,
.pf-drop-leave-to { opacity: 0; transform: translateY(-6px); }

@media (prefers-reduced-motion: reduce) {
  .pf__trigger,
  .pf__chevron { transition: none; }
  .pf-drop-enter-active,
  .pf-drop-leave-active { transition: none; }
  .pf-drop-enter-from,
  .pf-drop-leave-to { transform: none; }
}
</style>
