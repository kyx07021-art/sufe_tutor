<script setup>
import UiDropdown from '@/components/ui/UiDropdown.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * TimeSlotEditor - step 4b: time slot component (weekday + start/end time, add/remove rows)
 * -------------------------------------------------------
 * - v-model array of { day: 'Mon'..'Sun', start: 'HH:mm', end: 'HH:mm' }.
 * - Each row: day dropdown + start/end time inputs + remove button; an add button
 *   appends a fresh empty row. Array is replaced immutably to keep reactivity.
 */
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue'])

const DAY_OPTIONS = MY_DEMANDS_COPY.DAY_LABELS.map((d) => ({ value: d, label: d }))

const rows = () => (Array.isArray(props.modelValue) ? props.modelValue.slice() : [])

function addRow() {
  emit('update:modelValue', [...rows(), { day: '周一', start: '', end: '' }])
}

function removeRow(i) {
  const next = rows()
  next.splice(i, 1)
  emit('update:modelValue', next)
}

function updateRow(i, patch) {
  const next = rows()
  next[i] = { ...next[i], ...patch }
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="ts-editor">
    <div v-for="(row, i) in modelValue" :key="i" class="ts-editor__row">
      <UiDropdown
        :model-value="row.day"
        variant="B"
        :options="DAY_OPTIONS"
        width="104px"
        @update:model-value="(v) => updateRow(i, { day: v })"
      />
      <UiInput
        :model-value="row.start"
        :placeholder="MY_DEMANDS_COPY.TS_START"
        :max-length="5"
        width="88px"
        @update:model-value="(v) => updateRow(i, { start: v })"
      />
      <span class="ts-editor__dash">–</span>
      <UiInput
        :model-value="row.end"
        :placeholder="MY_DEMANDS_COPY.TS_END"
        :max-length="5"
        width="88px"
        @update:model-value="(v) => updateRow(i, { end: v })"
      />
      <UiButton
        variant="B"
        circle
        size="sm"
        :aria-label="MY_DEMANDS_COPY.TS_REMOVE"
        @click="removeRow(i)"
      >
        <UiIcon name="close" :size="14" aria-hidden="true" />
      </UiButton>
    </div>

    <UiButton
      variant="B"
      :aria-label="MY_DEMANDS_COPY.TS_ADD"
      class="ts-editor__add"
      @click="addRow"
    >
      <UiIcon name="plus" :size="14" aria-hidden="true" />
      <span>{{ MY_DEMANDS_COPY.TS_ADD }}</span>
    </UiButton>
  </div>
</template>

<style scoped>
.ts-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.ts-editor__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ts-editor__dash {
  color: var(--gray-50);
}
.ts-editor__add {
  align-self: flex-start;
  --btn-w: auto;
  color: var(--gray-60);
  font-size: var(--fs-sm);
}
</style>
