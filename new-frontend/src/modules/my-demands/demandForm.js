/**
 * demandForm.js - demand form state helpers (M8-06/12/13)
 * -------------------------------------------------------
 * - Empty form shape, expectedTime serialization/parsing (backend JSON contract), and the
 *   I-35 payload mapper.
 * - Time-slot wire format (backend sanitizeTimeSlots): JSON string of
 *   [{ type:'week', dow:1..7, start:'HH:MM', end:'HH:MM' }]. The editor form keeps rows as
 *   { day, start, end } for display (day is one of MY_DEMANDS_COPY.DAY_LABELS values); this
 *   module converts day<->dow.
 */
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

export function emptyDemandForm() {
  return {
    subject: '',
    grade: '',
    province: '',
    teachingMethod: '', // 'online' | 'offline' | 'both'
    currentScore: '',
    currentScoreFull: '',
    addressArea: '',
    expectedTime: [], // [{ day: <MY_DEMANDS_COPY.DAY_LABELS value>, start: 'HH:mm', end: 'HH:mm' }]
    preferredTags: [],
    preferredGender: '',
    budgetMin: '',
    budgetMax: '',
    additionalInfo: '',
  }
}

/** MY_DEMANDS_COPY.DAY_LABELS value -> dow 1..7 (backend WEEKDAYS). */
const DAY_TO_DOW = MY_DEMANDS_COPY.DAY_LABELS.reduce((m, label, i) => {
  m[label] = i + 1
  return m
}, {})
const DOW_TO_DAY = ['', ...MY_DEMANDS_COPY.DAY_LABELS]

/** Serialize editor slot rows to the backend JSON wire string ('' when empty/invalid). */
export function formatTimeSlots(slots) {
  const list = Array.isArray(slots) ? slots.filter((s) => s && s.day && s.start && s.end) : []
  const arr = list
    .map((s) => ({ type: 'week', dow: DAY_TO_DOW[s.day] || 0, start: s.start, end: s.end }))
    .filter((s) => s.dow >= 1 && s.dow <= 7 && s.start < s.end)
  return arr.length ? JSON.stringify(arr) : ''
}

/** Parse the backend JSON wire string back to editor rows ({ day, start, end }). */
export function parseTimeSlots(text) {
  if (!text) return []
  let arr
  try {
    arr = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .filter(
      (it) =>
        it && it.type === 'week' && Number.isInteger(it.dow) && it.dow >= 1 && it.dow <= 7 && it.start && it.end,
    )
    .map((it) => ({ day: DOW_TO_DAY[it.dow] || '', start: it.start, end: it.end }))
    .filter((s) => s.day)
}

/** Format editor slot rows for card display: TIME_SLOT_PREFIX + weekday + time range, TIME_JOIN-joined. */
export function displayTimeSlots(slots) {
  const rows = parseTimeSlots(Array.isArray(slots) ? JSON.stringify(convertToWire(slots)) : slots)
  const dayShort = (label) => label.slice(1) // strip the single-char weekday prefix from every DAY_LABELS value
  return rows
    .map((s) => `${MY_DEMANDS_COPY.TIME_SLOT_PREFIX}${dayShort(s.day)} ${s.start}-${s.end}`)
    .join(MY_DEMANDS_COPY.TIME_JOIN)
}

/** Convert editor rows to wire objects (used by displayTimeSlots for array input). */
function convertToWire(slots) {
  const list = Array.isArray(slots) ? slots.filter((s) => s && s.day && s.start && s.end) : []
  return list
    .map((s) => ({ type: 'week', dow: DAY_TO_DOW[s.day] || 0, start: s.start, end: s.end }))
    .filter((s) => s.dow >= 1 && s.dow <= 7)
}

/**
 * Map the reactive form to the I-35 POST/PUT body (empty optionals -> null, numerics as numbers).
 * - currentScoreFull is omitted: the backend derives the full from the subject (repo subjectMaxFor).
 * - expectedTime is the backend JSON wire string.
 */
export function demandPayload(form) {
  return {
    subject: form.subject || '',
    grade: form.grade || '',
    province: form.province || '',
    teachingMethod: form.teachingMethod || '',
    currentScore: form.currentScore === '' || form.currentScore == null ? null : Number(form.currentScore),
    addressArea: form.addressArea || '',
    expectedTime: formatTimeSlots(form.expectedTime),
    preferredTags: Array.isArray(form.preferredTags) ? form.preferredTags.slice() : [],
    preferredGender: form.preferredGender || '',
    budgetMin: form.budgetMin === '' || form.budgetMin == null ? null : Number(form.budgetMin),
    budgetMax: form.budgetMax === '' || form.budgetMax == null ? null : Number(form.budgetMax),
    additionalInfo: form.additionalInfo || '',
  }
}
