<script setup>
import { computed } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiFieldDisplay from '@/components/ui/UiFieldDisplay.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * DetailRight - M7-21 detail modal right column + send-message button (student gate)
 * ---------------------------------------------------------------------------------
 * - Three-row info display area A (price / region / time slots), a divider in normal
 *   flow, then a wide brand A1 button pinned to the column bottom.
 * - Student gate (contract surface ⑤): the send-message button renders ONLY when
 *   isStudent is true; a teacher sees nothing in its place.
 */

const props = defineProps({
  teacher: { type: Object, default: null },
  isStudent: { type: Boolean, default: true },
})

const emit = defineEmits(['send-message'])

function priceText() {
  const t = props.teacher
  if (t && t.priceMin != null && t.priceMax != null) return T.PRICE_RANGE(t.priceMin, t.priceMax)
  if (t && t.priceMin != null) return T.PRICE_FROM(t.priceMin)
  if (t && t.priceMax != null) return T.PRICE_TO(t.priceMax)
  return T.PRICE_NA
}

function addressText() {
  const t = props.teacher
  return t && t.region ? t.region : T.DETAIL_ADDRESS_NA
}

/**
 * Format I-29 timeSlots into one display string.
 * Slot shape (v2): { type: 'week', dow: 1..7, start: 'HH:mm', end: 'HH:mm' }.
 * A day-string slot ({ day: '<weekday>', start, end }) is also accepted.
 * Falls back to T.DETAIL_TIME_NA when nothing is renderable.
 */
function timeText() {
  const t = props.teacher
  if (!t || !Array.isArray(t.timeSlots) || t.timeSlots.length === 0) return T.DETAIL_TIME_NA
  const days = T.DETAIL_TIME_DAYS
  const sep = T.DETAIL_TIME_JOIN
  const parts = []
  for (const s of t.timeSlots) {
    if (!s || typeof s !== 'object') continue
    const start = typeof s.start === 'string' ? s.start : ''
    const end = typeof s.end === 'string' ? s.end : ''
    if (!start || !end) continue
    const range = `${start}-${end}`
    let day = typeof s.day === 'string' && s.day ? s.day : ''
    if (!day && typeof s.dow === 'number' && Array.isArray(days)) day = days[s.dow - 1] || ''
    parts.push(day ? `${day} ${range}` : range)
  }
  return parts.length ? parts.join(sep || ', ') : T.DETAIL_TIME_NA
}

const items = computed(() => [
  { label: T.DETAIL_PRICE, value: priceText() },
  { label: T.DETAIL_ADDRESS, value: addressText() },
  { label: T.DETAIL_TIME, value: timeText() },
])

function onSend() {
  emit('send-message', props.teacher)
}
</script>

<template>
  <div class="dr">
    <UiFieldDisplay :items="items" />
    <div class="dr__divider" aria-hidden="true"></div>
    <div v-if="isStudent" class="dr__send">
      <UiButton variant="A1" fill="brand" block @click="onSend">
        {{ T.SEND_MESSAGE }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.dr {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 0;
  height: 100%;
  padding-top: calc(2 * var(--fs-base));
}
.dr__divider,
.dr__send {
  flex: none;
}
.dr__divider {
  margin-top: var(--space-4);
  border-top: var(--border-w) solid var(--divider);
}
.dr__send {
  margin-top: auto;
  padding: var(--space-4) 5% 5%;
}
</style>
