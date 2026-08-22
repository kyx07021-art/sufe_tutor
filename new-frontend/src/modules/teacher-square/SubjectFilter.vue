<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import ArrowDown from '@/assets/svg/arrow-down.svg'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * SubjectFilter - M7-08 subject filter card (double-column multi-select)
 * -------------------------------------------------------
 * - Self-contained filter card for the "subject" dimension: a title above, a dropdown-A
 *   trigger below. Resting text = T.FILTER_ALL_SUBJECT; once subjects are
 *   selected the trigger shows the comma-joined names, ellipsis-truncated.
 * - Clicking the trigger opens a panel (absolutely positioned below the card)
 *   listing every subject from T.SUBJECT_OPTIONS as a two-column vertical
 *   checkbox list (UiCheckButton variant B). Toggling mutates the selection
 *   array only; any-hit semantics belong to the match engine (M7-12).
 * - Open state is owned here: click outside / Escape close the panel; the
 *   panel is clamped horizontally so it never overflows the 375px viewport.
 * - Contract 6: zero inline event/style attrs, zero v-html, zero raw CJK in
 *   template/comments (copy comes from T only). Reduced-motion respected.
 */
const props = defineProps({
  /** array of selected subject strings (v-model) */
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const rootRef = ref(null)
const panelRef = ref(null)

const selected = computed(() =>
  Array.isArray(props.modelValue) ? props.modelValue : [],
)
const hasSelection = computed(() => selected.value.length > 0)
const displayText = computed(() =>
  hasSelection.value ? selected.value.join(', ') : T.FILTER_ALL_SUBJECT,
)
/** two vertical columns -> rows = ceil(options / 2) */
const panelRows = Math.ceil(T.SUBJECT_OPTIONS.length / 2)

function isSelected(subject) {
  return selected.value.includes(subject)
}

function toggleSubject(subject) {
  const next = selected.value.includes(subject)
    ? selected.value.filter((s) => s !== subject)
    : [...selected.value, subject]
  emit('update:modelValue', next)
  emit('change', next)
}

function toggle() {
  open.value = !open.value
}

function close() {
  open.value = false
}

/** Horizontal viewport clamp: shift the panel left when it would overflow right. */
function placePanel() {
  const root = rootRef.value
  const panel = panelRef.value
  if (!root || !panel) return
  const r = root.getBoundingClientRect()
  const pw = panel.offsetWidth
  const overflow = r.left + pw - window.innerWidth + 4
  if (overflow > 0) {
    panel.style.setProperty('--sf-left', Math.round(-overflow) + 'px')
  } else {
    panel.style.removeProperty('--sf-left')
  }
}

function onDocPointerDown(e) {
  if (!open.value) return
  const root = rootRef.value
  if (root && root.contains(e.target)) return
  close()
}

function onDocKeydown(e) {
  if (!open.value) return
  if (e.key === 'Escape') close()
}

function onViewportResize() {
  if (open.value) placePanel()
}

watch(open, async (val) => {
  if (val) {
    await nextTick()
    if (!open.value) return
    placePanel()
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown)
    window.addEventListener('resize', onViewportResize)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown)
    window.removeEventListener('resize', onViewportResize)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('resize', onViewportResize)
})
</script>

<template>
  <div ref="rootRef" class="subject-filter">
    <p class="subject-filter__title">{{ T.FILTER_TITLE_SUBJECT }}</p>

    <UiButton
      variant="C"
      block
      :lift="false"
      class="subject-filter__trigger"
      :class="{ 'is-open': open }"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="toggle"
    >
      <span
        class="subject-filter__value"
        :class="{ 'is-placeholder': !hasSelection }"
      >{{ displayText }}</span>
      <ArrowDown class="subject-filter__chevron" aria-hidden="true" />
    </UiButton>

    <Transition name="sf-panel">
      <div
        v-if="open"
        ref="panelRef"
        class="subject-filter__panel"
        role="group"
        :aria-label="T.FILTER_TITLE_SUBJECT"
        :style="{ '--sf-rows': panelRows }"
      >
        <UiCheckButton
          v-for="s in T.SUBJECT_OPTIONS"
          :key="s"
          variant="B"
          :model-value="isSelected(s)"
          :label="s"
          @click="toggleSubject(s)"
        />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.subject-filter {
  position: relative;
  width: 100%;
  min-width: 0;
}
.subject-filter__title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-sm);
  line-height: 1.4;
  color: var(--gray-60);
}
.subject-filter__trigger {
  width: 100%;
}
/* dropdown-A look with left-aligned text: the UiButton label fills and lays out row */
.subject-filter__trigger :deep(.ui-btn__label) {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: flex-start;
}
.subject-filter__value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.subject-filter__value.is-placeholder {
  color: var(--gray-50);
}
.subject-filter__chevron {
  flex: none;
  width: 1em;
  height: 1em;
  transition: transform var(--dur-sm) var(--ease-out);
}
.subject-filter__trigger.is-open .subject-filter__chevron {
  transform: rotate(180deg);
}
.subject-filter__panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: var(--sf-left, 0px);
  z-index: 50;
  box-sizing: border-box;
  width: min(320px, calc(100vw - var(--space-4)));
  max-height: min(360px, 60vh);
  overflow-y: auto;
  padding: var(--space-2);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float-sm);
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  grid-template-rows: repeat(var(--sf-rows), auto);
  gap: var(--space-1) var(--space-2);
}
/* compact check rows inside the panel; keep fixed width in both states so the
   selected-state stretch never overflows the two-column cells (375px safe) */
.subject-filter__panel :deep(.ui-checkbtn) {
  width: 100%;
  --btn-h: 36px;
  --btn-fs: 14px;
}
.subject-filter__panel :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}

.sf-panel-enter-active,
.sf-panel-leave-active {
  transition:
    opacity var(--dur-sm) var(--ease-out),
    transform var(--dur-sm) var(--ease-out);
}
.sf-panel-enter-from,
.sf-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .subject-filter__chevron,
  .sf-panel-enter-active,
  .sf-panel-leave-active {
    transition: none;
  }
}
</style>
