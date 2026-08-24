<script setup>
/**
 * SubjectEditor - B2-4 subjects + scores + awards + teaching philosophy editor
 * ----------------------------------------------------------------------------
 * - Structured editor: each subject row has subject name / score / full score /
 *   awards (comma text), plus remove-row; an "add subject" button appends a row;
 *   a multiline textarea edits the teaching philosophy.
 * - v-model: modelValue = { subjects: [{ subject, score, full, awards: [] }], philosophy }
 * - Emits a fresh object on every user change (explicit handlers; NO deep watch on
 *   internal rows — that caused an emit/echo loop with the parent). External prefill /
 *   reset flows in through the modelValue prop watch (B2-5 parent owns collection).
 */
import { ref, watch } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { UiButton, UiInput } from '@/components/ui/index.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({ subjects: [], philosophy: '' }),
  },
})

const emit = defineEmits(['update:modelValue'])

function normalizeRows(list) {
  return (Array.isArray(list) ? list : []).map((r) => ({
    subject: (r && r.subject) || '',
    score: r && r.score != null ? String(r.score) : '',
    full: r && r.full != null ? String(r.full) : '',
    awards: Array.isArray(r && r.awards) ? r.awards.join('、') : '',
  }))
}

const rows = ref(normalizeRows(props.modelValue.subjects))
const philosophy = ref(props.modelValue.philosophy || '')

function buildOutput() {
  return {
    subjects: rows.value.map((r) => ({
      subject: r.subject.trim(),
      score: r.score === '' ? null : Number(r.score),
      full: r.full === '' ? null : Number(r.full),
      awards: r.awards
        .split(/[、,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    })),
    philosophy: philosophy.value,
  }
}

function pushOut() {
  emit('update:modelValue', buildOutput())
}

function onField(i, field, value) {
  rows.value[i][field] = value
  pushOut()
}

function onPhilosophy(value) {
  philosophy.value = value
  pushOut()
}

function addRow() {
  rows.value.push({ subject: '', score: '', full: '', awards: '' })
  pushOut()
}

function removeRow(i) {
  rows.value.splice(i, 1)
  pushOut()
}

// external prefill / reset (from parent) -> reflect into internal rows without echoing
watch(
  () => props.modelValue,
  (nv) => {
    rows.value = normalizeRows(nv && nv.subjects)
    philosophy.value = (nv && nv.philosophy) || ''
  },
)
</script>

<template>
  <div class="subject-editor">
    <p class="subject-editor__label ui-title-sm">{{ TEACHER_COPY.B2_FIELD_SUBJECTS }}</p>

    <div v-if="!rows.length" class="subject-editor__empty">{{ TEACHER_COPY.B1_EMPTY }}</div>

    <div v-for="(row, i) in rows" :key="i" class="subject-editor__row">
      <UiInput
        :model-value="row.subject"
        :aria-label="TEACHER_COPY.B2_FIELD_SUBJECTS"
        :placeholder="TEACHER_COPY.B2_PLACEHOLDER_SUBJECT"
        width="100%"
        @update:model-value="onField(i, 'subject', $event)"
      />
      <UiInput
        :model-value="row.score"
        filter="digits"
        :aria-label="TEACHER_COPY.B2_PLACEHOLDER_SCORE"
        :placeholder="TEACHER_COPY.B2_PLACEHOLDER_SCORE"
        width="90px"
        @update:model-value="onField(i, 'score', $event)"
      />
      <UiInput
        :model-value="row.full"
        filter="digits"
        :aria-label="TEACHER_COPY.B2_PLACEHOLDER_FULL"
        :placeholder="TEACHER_COPY.B2_PLACEHOLDER_FULL"
        width="90px"
        @update:model-value="onField(i, 'full', $event)"
      />
      <UiInput
        :model-value="row.awards"
        :aria-label="TEACHER_COPY.B2_FIELD_AWARDS"
        :placeholder="TEACHER_COPY.B2_FIELD_AWARDS"
        width="100%"
        @update:model-value="onField(i, 'awards', $event)"
      />
      <UiButton variant="S" :aria-label="TEACHER_COPY.B2_REMOVE_ROW" @click="removeRow(i)">
        {{ TEACHER_COPY.B2_REMOVE_ROW }}
      </UiButton>
    </div>

    <div class="subject-editor__actions">
      <UiButton variant="S" @click="addRow">{{ TEACHER_COPY.B2_ADD_SUBJECT }}</UiButton>
    </div>

    <p class="subject-editor__label ui-title-sm">{{ TEACHER_COPY.B2_FIELD_PHILOSOPHY }}</p>
    <UiInput
      :model-value="philosophy"
      :placeholder="TEACHER_COPY.B2_FIELD_PHILOSOPHY"
      width="100%"
      @update:model-value="onPhilosophy"
    />
  </div>
</template>

<style scoped>
.subject-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.subject-editor__empty {
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
.subject-editor__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 90px;
  gap: var(--space-2);
  align-items: center;
}
.subject-editor__row > :nth-child(4),
.subject-editor__row > :nth-child(5) {
  grid-column: 1 / -1;
}
.subject-editor__row > :nth-child(5) {
  justify-self: start;
}
.subject-editor__actions {
  display: flex;
}
</style>
