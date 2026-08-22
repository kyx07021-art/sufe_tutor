<script setup>
import { computed, provide, ref } from 'vue'
import { FIELD_CTX_KEY, FIELD_FILL_KEY } from '@/composables/useFieldContext'
import StarFilled from '@/assets/svg/star-filled.svg'
import Check from '@/assets/svg/check.svg'

/**
 * UiFieldInput - Info input area A (plan "input component styles - info input area A")
 * -------------------------------------------------------
 * - Wide and flat, stackable vertically; white fill no border; 5% left / 10% right blank.
 * - Layout: left 5%~25% black bold title + status mark; left 30%~90% is the input component zone.
 * - Status marks (thin, light SVG strokes):
 *   - required unfilled: red star   - optional unfilled (not touched): yellow star   - filled: green check
 *   Once an optional item is interacted with (caret summoned / dropdown opened etc.) the yellow star disappears for this mother-component opening.
 * - Input components inside the zone default to gray-10 background (fill='auto' resolves via FIELD_FILL_KEY).
 * - Row spacing between items is large (>= 2x text height).
 */
const props = defineProps({
  title: { type: String, default: '' },
  required: { type: Boolean, default: false },
  /** whether it is filled (module computes from actual value) */
  filled: { type: Boolean, default: false },
  /** externally controlled touched (passed in when persisting across step-modal pages, see StepModal) */
  touched: { type: Boolean, default: false },
  markSize: { type: Number, default: 15 },
})

const emit = defineEmits(['update:touched'])
const localTouched = ref(false)
const isTouched = computed(() => props.touched || localTouched.value)

function markTouched() {
  if (!isTouched.value) {
    localTouched.value = true
    emit('update:touched', true)
  }
}

provide(FIELD_CTX_KEY, { markTouched })
provide(FIELD_FILL_KEY, 'gray-10')

const status = computed(() => {
  if (props.filled) return 'filled'
  if (props.required) return 'required-empty'
  if (isTouched.value) return 'touched'
  return 'optional-empty'
})
</script>

<template>
  <div class="ui-fieldinput" :class="`ui-fieldinput--${status}`">
    <div class="ui-fieldinput__label">
      <span class="ui-fieldinput__title">{{ title }}</span>
      <span v-if="status !== 'touched'" class="ui-fieldinput__mark">
        <StarFilled
          v-if="status === 'required-empty' || status === 'optional-empty'"
          class="ui-fieldinput__mark-icon"
          aria-hidden="true"
        />
        <Check v-else-if="status === 'filled'" class="ui-fieldinput__mark-icon" aria-hidden="true" />
      </span>
    </div>
    <div class="ui-fieldinput__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ui-fieldinput {
  display: grid;
  grid-template-columns: 5% 20% 5% 60% 10%;
  align-items: center; /* when the input occupies multiple rows, title+mark center against the whole height */
  box-sizing: border-box;
  width: 100%;
  background: var(--paper);
  padding: var(--space-3) 0;
}

.ui-fieldinput__label {
  grid-column: 2;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.ui-fieldinput__title {
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ui-fieldinput__mark {
  display: inline-flex;
  flex: none;
  line-height: 0;
}
.ui-fieldinput__mark-icon {
  width: v-bind(markSize + 'px');
  height: v-bind(markSize + 'px');
}

.ui-fieldinput--required-empty .ui-fieldinput__mark-icon { color: var(--danger); }
.ui-fieldinput--optional-empty .ui-fieldinput__mark-icon { color: var(--warn); }
.ui-fieldinput--filled .ui-fieldinput__mark-icon { color: var(--success); }

.ui-fieldinput__content {
  grid-column: 4;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: calc(var(--lh-body) * 1em); /* large row spacing between items (>= 2x text height) */
}
</style>
