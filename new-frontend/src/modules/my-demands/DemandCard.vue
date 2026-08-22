<script setup>
import { computed } from 'vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import ArrowRight from '@/assets/svg/arrow-right.svg'
import {
  MY_DEMANDS_COPY,
  DEMAND_SCORE_TEMPLATE,
  DEMAND_METHOD_LABEL,
  DEMAND_GENDER_LABEL,
} from '@/constants/m-my-demands.js'
import { displayTimeSlots } from './demandForm.js'
import { provinceLabel, gradeLabel, tagLabel } from './region.js'

/**
 * DemandCard - A2.1 demand card (domain renderer, reused by M9 B1 teacher plaza)
 * -------------------------------------------------------
 * - Card A1 (interactive, click emits select). Upper-left title+score+intro / upper-right info area (SVG title) /
 *   lower avatar+user id+CTA.
 * - mode: 'student' (own demands, CTA=edit demand) / 'teacher' (demand plaza, CTA=contact for trial, consumed by M9).
 * - Data shape = I-33/34/38 rows (single-subject new model). The address info item renders only when method ∈ offline/both
 *   (M8-10a decision; out-of-province online rows have no such item).
 * - M9 passes I-34 rows (incl. studentName/studentAvatar/matchScore).
 */
const props = defineProps({
  demand: { type: Object, required: true },
  mode: { type: String, default: 'student', validator: (v) => ['student', 'teacher'].includes(v) },
})

const emit = defineEmits(['select'])

const methodLabel = (m) => DEMAND_METHOD_LABEL[m] || m || ''
const genderLabel = (g) => DEMAND_GENDER_LABEL[g] || g || ''

/** title = subject + '·' + grade */
const title = computed(() => {
  const s = props.demand.subject || ''
  const g = gradeLabel(props.demand.grade)
  return [s, g].filter(Boolean).join('·')
})

/** Score line: current score vs full score when full is present */
const scoreLine = computed(() => {
  const d = props.demand
  const score = d.currentScore
  const full = d.currentScoreFull
  if (score == null || score === '') return ''
  return full != null && full !== '' ? DEMAND_SCORE_TEMPLATE.full(score, full) : DEMAND_SCORE_TEMPLATE.only(score)
})

const intro = computed(() => props.demand.additionalInfo || '')

const provinceMethod = computed(() => {
  const p = provinceLabel(props.demand.province)
  const m = methodLabel(props.demand.teachingMethod)
  return [p, m].filter(Boolean).join('·')
})

/** Upper-right info area: province/address/time/personality/gender (with SVG title) */
const infoItems = computed(() => {
  const d = props.demand
  const items = []
  items.push({ icon: 'globe', label: MY_DEMANDS_COPY.INFO_PROVINCE, value: provinceMethod.value })
  if (d.teachingMethod === 'offline' || d.teachingMethod === 'both') {
    if (d.addressArea) items.push({ icon: 'map-pin', label: MY_DEMANDS_COPY.INFO_ADDRESS, value: d.addressArea })
  }
  if (d.expectedTime) items.push({ icon: 'clock', label: MY_DEMANDS_COPY.INFO_TIME, value: displayTimeSlots(d.expectedTime) })
  const tags = Array.isArray(d.preferredTags) ? d.preferredTags.filter(Boolean) : []
  if (tags.length) items.push({ icon: 'smile', label: MY_DEMANDS_COPY.INFO_PERSONALITY, value: tags.map(tagLabel).join('·') })
  if (d.preferredGender) items.push({ icon: 'user', label: MY_DEMANDS_COPY.INFO_GENDER, value: genderLabel(d.preferredGender) })
  return items
})

/** User id: teacher plaza rows take studentName, own-demand rows take user_id */
const uid = computed(() => {
  const d = props.demand
  if (d.studentName) return d.studentName
  if (d.user_id != null && d.user_id !== '') return String(d.user_id)
  return ''
})

const ctaText = computed(() => (props.mode === 'teacher' ? MY_DEMANDS_COPY.CTA_CONTACT : MY_DEMANDS_COPY.CTA_EDIT))

function onSelect(e) {
  emit('select', e)
}
</script>

<template>
  <UiCard variant="A1" class="demand-card" @click="onSelect">
    <div class="demand-card__upper">
      <div class="demand-card__title">{{ title }}</div>
      <div class="demand-card__body">
        <div class="demand-card__left">
          <div v-if="scoreLine" class="demand-card__score">{{ scoreLine }}</div>
          <div v-if="intro" class="demand-card__intro">{{ intro }}</div>
        </div>
        <div class="demand-card__right">
          <div class="demand-info">
            <div v-for="(it, i) in infoItems" :key="i" class="demand-info__item">
              <span class="demand-info__label">
                <UiIcon :name="it.icon" :size="12" class="demand-info__icon" aria-hidden="true" />
                {{ it.label }}
              </span>
              <span class="demand-info__value">{{ it.value }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="demand-card__lower">
      <div class="demand-card__avatar">
        <img v-if="demand.studentAvatar" :src="demand.studentAvatar" alt="" />
        <UiIcon v-else name="user" :size="16" aria-hidden="true" />
      </div>
      <span v-if="uid" class="demand-card__uid">{{ uid }}</span>

      <span class="demand-card__cta">
        <span class="demand-card__cta-text">{{ ctaText }}</span>
        <ArrowRight class="demand-card__cta-arrow" aria-hidden="true" />
      </span>
    </div>
  </UiCard>
</template>

<style scoped>
.demand-card {
  display: flex;
  flex-direction: column;
  height: var(--demand-card-h, 240px);
  box-sizing: border-box;
  text-align: left;
}

/* ===== Upper section (flex 1, split vertically: title row + body row) ===== */
.demand-card__upper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 5% 5% 0;
}

.demand-card__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--ink);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.demand-card__body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--space-2);
  padding-top: var(--space-2);
}

.demand-card__left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.demand-card__score {
  color: var(--gray-75);
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.demand-card__intro {
  color: var(--gray-75);
  font-size: var(--fs-sm);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

/* ===== Upper-right: info area (SVG title + value, compact variant) ===== */
.demand-card__right {
  width: 44%;
  min-width: 0;
  flex: none;
}

.demand-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.demand-info__item {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  min-width: 0;
}

.demand-info__label {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 700;
  color: var(--ink);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.demand-info__icon {
  color: var(--gray-50);
}

.demand-info__value {
  min-width: 0;
  color: var(--gray-75);
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== Lower section (flat row: avatar + id + CTA) ===== */
.demand-card__lower {
  height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 5%;
}

.demand-card__avatar {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  background: var(--gray-10);
  color: var(--gray-50);
  display: flex;
  align-items: center;
  justify-content: center;
}
.demand-card__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.demand-card__uid {
  margin-left: var(--space-2);
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.demand-card__cta {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--ink);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.demand-card__cta-arrow {
  width: 1em;
  height: 1em;
  transition: transform var(--dur-sm) var(--ease-out);
}
.demand-card:hover .demand-card__cta-arrow,
.demand-card:focus-visible .demand-card__cta-arrow {
  transform: translateX(var(--btn-arrow-shift, 4px));
}
</style>
