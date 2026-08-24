<script setup>
import { computed, ref, watch } from 'vue'
import { UiModalA1 } from '@/components/ui/index.js'
import { api } from '@/core/api.js'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'
import DetailLeft from './DetailLeft.vue'
import DetailMiddle from './DetailMiddle.vue'
import DetailRight from './DetailRight.vue'

/**
 * TeacherDetailModal - M7-18 detail modal shell + three columns + data loading
 * -------------------------------------------------------
 * - Modal A1 titled with the teacher name (X close); closing re-forwards
 *   update:open to the parent.
 * - Body = three EQUAL columns (left/middle/right) with vertical dividers,
 *   stacked to a single column on mobile (<=720px). Column renderers are the
 *   sibling components in this module dir.
 * - Reviews load through the core api() single point when the modal opens; the
 *   middle column shows a gray loading text until resolved, then DetailMiddle.
 * - A fetch failure resolves to an empty list with no console error; the
 *   send-message action is re-forwarded from DetailRight carrying the teacher.
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  /** M7-01 mapped teacher model (the one selected from the list card) */
  teacher: { type: Object, default: null },
})

const emit = defineEmits(['update:open', 'send-message'])

const reviews = ref([])
const reviewsStatus = ref('idle') // idle | loading | ready
let fetchSeq = 0

const modalTitle = computed(() => (props.teacher ? props.teacher.name || '' : ''))

watch(
  () => props.open,
  (val) => {
    if (val && props.teacher) loadReviews()
  },
  { immediate: true },
)

watch(
  () => props.teacher,
  () => {
    if (props.open && props.teacher) loadReviews()
  },
)

async function loadReviews() {
  const id = props.teacher && props.teacher.teacherId
  const seq = ++fetchSeq
  if (id == null) {
    reviews.value = []
    reviewsStatus.value = 'ready'
    return
  }
  reviewsStatus.value = 'loading'
  try {
    const data = await api('/reviews?teacherUserId=' + id)
    if (seq !== fetchSeq) return // stale response after a teacher switch
    reviews.value = Array.isArray(data && data.reviews) ? data.reviews : []
  } catch {
    if (seq !== fetchSeq) return
    reviews.value = [] // failure renders the empty state; no console error
  }
  reviewsStatus.value = 'ready'
}

function onUpdateOpen(v) {
  emit('update:open', v)
}

function onSendMessage() {
  emit('send-message', props.teacher)
}
</script>

<template>
  <UiModalA1 :open="open" :title="modalTitle" @update:open="onUpdateOpen">
    <div v-if="teacher" class="teacher-detail-modal">
      <div class="teacher-detail-modal__col">
        <DetailLeft :teacher="teacher" />
      </div>
      <div class="teacher-detail-modal__col">
        <p v-if="reviewsStatus !== 'ready'" class="teacher-detail-modal__state" data-state="loading">{{ T.LOADING }}</p>
        <DetailMiddle v-else :teacher="teacher" :reviews="reviews" />
      </div>
      <div class="teacher-detail-modal__col">
        <DetailRight :teacher="teacher" :is-student="true" @send-message="onSendMessage" />
      </div>
    </div>
  </UiModalA1>
</template>

<style scoped>
/* The modal panel teleports to <body> and is an ANCESTOR of this slot root;
   CSS custom properties inherit downward, so a scoped rule on the wrapper
   cannot set the panel's --modal-w. This :global() escape keys the override to
   the unique wrapper class via :has(), widening only this modal (~70% desktop;
   mobile keeps the M0 --modal-w-mobile fallback). */
:global(.ui-modal__panel:has(.teacher-detail-modal)) {
  --modal-w: 70%;
}

.teacher-detail-modal {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  min-width: 0;
}

.teacher-detail-modal__col {
  min-width: 0;
}

/* vertical divider between columns (desktop); the first column has none */
.teacher-detail-modal__col + .teacher-detail-modal__col {
  border-left: var(--border-w) solid var(--divider);
}

.teacher-detail-modal__state {
  margin: 0;
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-50);
  font-size: var(--fs-sm);
}

/* mobile: stack to a single column, dividers become horizontal */
@media (max-width: 720px) {
  .teacher-detail-modal {
    grid-template-columns: 1fr;
  }
  .teacher-detail-modal__col + .teacher-detail-modal__col {
    border-left: none;
    border-top: var(--border-w) solid var(--divider);
  }
}
</style>
