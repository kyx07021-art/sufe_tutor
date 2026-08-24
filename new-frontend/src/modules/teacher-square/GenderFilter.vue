<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { useAnchoredPanel } from '@/composables/useAnchoredPanel'
import { useFocusTrap } from '@/composables/useFocusTrap'
import ArrowDown from '@/assets/svg/arrow-down.svg'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * GenderFilter - M7-09 gender filter card (single-select)
 * -------------------------------------------------------
 * - Self-contained filter project card: title above, rounded-rectangle trigger
 *   below (left-aligned). Resting text = T.FILTER_ALL_GENDER; once a gender is
 *   chosen the trigger shows T.GENDER_MALE / T.GENDER_FEMALE.
 * - Clicking the trigger opens a small anchored panel with three options
 *   (male / female / any) as radio semantics - exactly one active; the active row
 *   is UiCheckButton variant B with gray-10 fill.
 * - Closes on option pick, click outside, or Escape.
 * - Zero inline event/style attributes, zero v-html, zero runtime style-element injection,
 *   zero raw CJK in template/comments; tokens only (contract 6).
 */
const props = defineProps({
  /** '' = any | 'male' | 'female' */
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])

const OPTIONS = [
  { value: 'male', label: T.GENDER_MALE },
  { value: 'female', label: T.GENDER_FEMALE },
  { value: '', label: T.GENDER_ANY },
]

const open = ref(false)
const triggerRef = ref(null)
const panelRef = ref(null)

const { style: panelStyle, placeNextTick, bind, unbind } = useAnchoredPanel(panelRef, triggerRef, {
  align: 'down',
  alignX: 'left',
  matchWidth: true,
})

useFocusTrap(panelRef, { active: open })

const displayText = computed(() => {
  if (props.modelValue === 'male') return T.GENDER_MALE
  if (props.modelValue === 'female') return T.GENDER_FEMALE
  return T.FILTER_ALL_GENDER
})
const hasValue = computed(() => props.modelValue !== '')

function toggle() {
  open.value = !open.value
}

function pick(value) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
    emit('change', value)
  }
  focusTrigger()
  open.value = false
}

function focusTrigger() {
  if (triggerRef.value) triggerRef.value.focus()
}

function onDocPointerDown(e) {
  if (!open.value) return
  if (panelRef.value && panelRef.value.contains(e.target)) return
  if (triggerRef.value && triggerRef.value.contains(e.target)) return
  open.value = false
}

function onDocKeydown(e) {
  if (e.key === 'Escape' && open.value) {
    focusTrigger()
    open.value = false
  }
}

watch(open, (val) => {
  if (val) {
    placeNextTick()
    bind()
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown)
  } else {
    unbind()
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown)
  }
})

onBeforeUnmount(() => {
  unbind()
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <div class="gender-filter">
    <span class="ui-title-sm">{{ T.FILTER_TITLE_GENDER }}</span>
    <button
      ref="triggerRef"
      type="button"
      class="gender-filter__trigger"
      :class="{ 'is-open': open }"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="gender-filter__value" :class="{ 'is-placeholder': !hasValue }">{{ displayText }}</span>
      <ArrowDown class="gender-filter__chevron" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="gf-drop">
        <div
          v-if="open"
          ref="panelRef"
          class="gender-filter__panel"
          :style="panelStyle"
          role="group"
          :aria-label="T.FILTER_TITLE_GENDER"
        >
          <UiCheckButton
            v-for="opt in OPTIONS"
            :key="opt.value"
            variant="B"
            :model-value="modelValue === opt.value"
            :label="opt.label"
            :fill="modelValue === opt.value ? 'gray-10' : 'auto'"
            @update:model-value="pick(opt.value)"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.gender-filter {
  --gender-w: 200px;
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  width: var(--gender-w);
  max-width: 100%;
  min-width: 0;
}
.gender-filter__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  width: 100%;
  height: var(--input-h);
  padding: 0 var(--space-3);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-sm);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: border-color var(--dur-sm) var(--ease-out);
}
.gender-filter__trigger:hover,
.gender-filter__trigger:focus-visible {
  border-color: var(--gray-60);
}
.gender-filter__trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}
.gender-filter__value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.gender-filter__value.is-placeholder {
  color: var(--gray-50);
}
.gender-filter__chevron {
  flex: none;
  width: 1em;
  height: 1em;
  color: var(--gray-50);
  transition: transform var(--dur-sm) var(--ease-out);
}
.gender-filter__trigger.is-open .gender-filter__chevron {
  transform: rotate(180deg);
}

/* anchored panel */
.gender-filter__panel {
  position: fixed;
  z-index: 1200;
  box-sizing: border-box;
  padding: var(--space-2);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  box-shadow: var(--shadow-float-sm);
}
/* compact full-width B rows; active = gray-10 fill, check reserved on every row */
.gender-filter__panel :deep(.ui-checkbtn) {
  --btn-w: 100%;
  --btn-h: 40px;
  --btn-fs: var(--fs-sm);
  --btn-pad: var(--space-3);
  --btn-radius: var(--radius-sm);
  justify-content: flex-start;
}
.gender-filter__panel :deep(.ui-checkbtn.is-checked) {
  width: 100%;
}
.gender-filter__panel :deep(.ui-checkbtn__check),
.gender-filter__panel :deep(.ui-checkbtn.is-checked .ui-checkbtn__check) {
  width: 28px;
}

/* float-in + fade (summon direction: down) */
.gf-drop-enter-active,
.gf-drop-leave-active {
  transition: opacity var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.gf-drop-enter-from,
.gf-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .gender-filter__trigger,
  .gender-filter__chevron,
  .gender-filter__panel {
    transition: none;
  }
  .gender-filter__trigger.is-open .gender-filter__chevron {
    transform: none;
  }
  .gf-drop-enter-active,
  .gf-drop-leave-active {
    transition: none;
  }
}
</style>
