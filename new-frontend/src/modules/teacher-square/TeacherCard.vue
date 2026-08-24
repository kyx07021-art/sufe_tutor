<script setup>
import { computed } from 'vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import RatingStars from './RatingStars.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'
import { subjectLabel } from '@/modules/my-demands/region.js'

/**
 * TeacherCard - M7-17 teacher card render (four layers, A1.1 business card)
 * -------------------------------------------------------
 * - Shell: M0 UiCard variant A1 (interactive); clicking forwards `click`.
 * - Layer 1 header (AK-N-D2): avatar LEFTMOST (rounded --radius-img; neutral
 *   circle fallback) then identity beside it = bold teacher NAME + a sub-line
 *   with the numeric user id ("ID <teacherId>") + the shared RatingStars row
 *   (rating + reviewCount in gray). Header height is driven by the avatar
 *   diameter; name/id/stars center against the avatar.
 * - Layer 2 bio: gray-75, smaller, wraps; left edge 5% / right edge 10% of card.
 * - Layer 3 price: bold black, built from priceMin/priceMax via
 *   T.PRICE_RANGE / T.PRICE_FROM / T.PRICE_TO / T.PRICE_NA.
 * - Layer 4 subject rows: brand-purple dot + subject name + `score/full` +
 *   optional awards (gray-75), space-separated, line-height 1x font.
 * - Optional top-right badge: T.MATCH_COUNT when the `count` prop > 0.
 * - All text via {{ }} interpolation (Vue auto-escapes); zero v-html, zero raw
 *   CJK in template/comments (copy comes from T only), zero inline style/event.
 */
const props = defineProps({
  teacher: { type: Object, required: true },
  /** match-group count; > 0 renders the "hit N" badge top-right */
  count: { type: Number, default: 0 },
})

const emit = defineEmits(['click'])

const hasAvatar = computed(() => !!props.teacher.avatar)

const ratingText = computed(() => {
  const r = props.teacher.rating
  return typeof r === 'number' && Number.isFinite(r) ? r.toFixed(1) : ''
})

/** Numeric rating for RatingStars (clamped inside the component); null -> 0. */
const ratingNumber = computed(() =>
  typeof props.teacher.rating === 'number' && Number.isFinite(props.teacher.rating)
    ? props.teacher.rating
    : 0,
)

/** "ID <teacherId>" - mirrors DetailLeft's identity label. */
const idText = computed(() => `${T.ID_PREFIX} ${props.teacher.teacherId ?? ''}`.trim())

const showStars = computed(() => ratingText.value !== '' || props.teacher.reviewCount > 0)
const showBadge = computed(() => props.count > 0)

const priceText = computed(() => {
  const min = props.teacher.priceMin
  const max = props.teacher.priceMax
  const hasMin = typeof min === 'number' && Number.isFinite(min)
  const hasMax = typeof max === 'number' && Number.isFinite(max)
  if (hasMin && hasMax) return T.PRICE_RANGE(min, max)
  if (hasMin) return T.PRICE_FROM(min)
  if (hasMax) return T.PRICE_TO(max)
  return T.PRICE_NA
})

const subjectRows = computed(() =>
  (Array.isArray(props.teacher.subjects) ? props.teacher.subjects : [])
    .map((s, i) => {
      const score = s.score
      const full = s.full
      const raw = s.subject ?? s.name ?? ''
      return {
        raw,
        key: raw || i,
        name: subjectLabel(raw), // backend stores English id -> Chinese label
        scoreText: score != null && full != null ? `${score}/${full}` : '',
        // AK-N-D1: normalize an awards ARRAY (e.g. []) to a joined string so an
        // empty array is falsy and never renders as a literal "[]" bracket leak.
        awards: Array.isArray(s.awards) ? s.awards.filter(Boolean).join(' ') : (s.awards ?? ''),
      }
    })
    // AK-N-D1: drop rows that carry no displayable content (empty name/score/
    // awards) so an empty-ish subject entry renders no section and no brackets.
    .filter((row) => row.name || row.scoreText || row.awards),
)

function onClick() {
  emit('click')
}
</script>

<template>
  <UiCard variant="A1" class="teacher-card" @click="onClick">
    <div class="teacher-card__inner">
      <div v-if="showBadge" class="teacher-card__badge">{{ T.MATCH_COUNT(count) }}</div>

      <div class="teacher-card__header">
        <div class="teacher-card__avatar">
          <img
            v-if="hasAvatar"
            class="teacher-card__avatar-img"
            :src="teacher.avatar"
            :alt="teacher.name"
          />
          <span v-else class="teacher-card__avatar-fallback" aria-hidden="true"></span>
        </div>
        <div class="teacher-card__identity">
          <div class="teacher-card__name">{{ teacher.name }}</div>
          <div class="teacher-card__sub">
            <span v-if="idText" class="teacher-card__id">{{ idText }}</span>
            <span v-if="showStars" class="teacher-card__stars">
              <RatingStars
                :score="ratingNumber"
                :size="14"
                class="teacher-card__stars-comp"
              />
              <span v-if="ratingText" class="teacher-card__rating">{{ ratingText }}</span>
              <span v-if="teacher.reviewCount > 0" class="teacher-card__reviews">
                {{ T.RATING_COUNT(teacher.reviewCount) }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <p v-if="teacher.bio" class="teacher-card__bio">{{ teacher.bio }}</p>

      <div class="teacher-card__price">{{ priceText }}</div>

      <ul v-if="subjectRows.length" class="teacher-card__subjects">
        <li v-for="row in subjectRows" :key="row.key" class="teacher-card__subject">
          <UiIcon name="dot" :size="10" class="teacher-card__dot" aria-hidden="true" />
          <span class="teacher-card__subject-name">{{ row.name }}</span>
          <span v-if="row.scoreText" class="teacher-card__subject-score">{{ row.scoreText }}</span>
          <span v-if="row.awards" class="teacher-card__subject-awards">{{ row.awards }}</span>
        </li>
      </ul>
    </div>
  </UiCard>
</template>

<style scoped>
.teacher-card {
  /* avatar diameter driven header height (56px = space-6 + space-4), token-composed */
  --card-avatar-d: calc(var(--space-6) + var(--space-4));
  /* AK-N-D4 special case: a card may be empty but never "flat" - enforce a
     horizontal-A4 minimum 297:210 (height >= 0.707 x width). Deliberate design
     constant from the user's "cards may be empty but never flat" requirement.
     Boundary: aspect-ratio only sets the transferred height FLOOR - content
     taller than 0.707x width grows the card normally (never clipped, never
     capped). Applies to every teacher card via this one class. */
  aspect-ratio: 297 / 210;
}

.teacher-card__inner {
  box-sizing: border-box;
  /* AK-N-D5: first row (header) is the aligned row; everything below is
     free-stacked in a plain flex column - no grid/table forcing any column
     alignment across rows. Blocks (bio / price / subjects) each start at the
     same left edge and flow with a uniform --space-3 gap; text inside a block
     may wrap independently. */
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  /* top reserves the top-right badge; left 5% / right 10% of card width */
  padding: var(--space-5) 10% var(--space-4) 5%;
  min-width: 0;
}

.teacher-card__badge {
  position: absolute;
  top: var(--space-1);
  right: var(--space-2);
  font-size: var(--fs-xs);
  line-height: 1;
  color: var(--gray-60);
  background: var(--gray-10);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}

.teacher-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.teacher-card__identity {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.teacher-card__name {
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
}

/* AK-N-D2: the sub-line right of the avatar = user id + star row, one baseline. */
.teacher-card__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.teacher-card__id {
  color: var(--gray-75);
  font-size: var(--fs-sm);
  line-height: 1;
  white-space: nowrap;
}

.teacher-card__stars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

/* Shared RatingStars at 14px: small enough to sit beside the id on the sub-line
   (--fs-sm scale); the numeric rating + review count follow on the same line.
   Deliberate size choice, token-aligned, not a runtime style injection. */
.teacher-card__stars-comp {
  flex: none;
}

.teacher-card__rating {
  color: var(--ink);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.teacher-card__reviews {
  color: var(--gray-50);
  font-size: var(--fs-sm);
  line-height: 1;
  white-space: nowrap;
}

.teacher-card__avatar {
  flex: none;
  width: var(--card-avatar-d);
  height: var(--card-avatar-d);
}

.teacher-card__avatar-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: var(--radius-img);
}

.teacher-card__avatar-fallback {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-circle);
  background: var(--gray-20);
}

.teacher-card__bio {
  margin: 0;
  color: var(--gray-75);
  font-size: var(--fs-sm);
  line-height: var(--lh-body);
  min-width: 0;
  overflow-wrap: anywhere;
}

.teacher-card__price {
  font-weight: 700;
  color: var(--ink);
  line-height: var(--lh-tight);
}

.teacher-card__subjects {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.teacher-card__subject {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--space-2);
  line-height: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.teacher-card__subject > * {
  min-width: 0;
}

.teacher-card__dot {
  color: var(--brand);
  flex: none;
  align-self: center;
}

.teacher-card__subject-name {
  color: var(--ink);
}

.teacher-card__subject-score {
  color: var(--ink);
  white-space: nowrap;
}

.teacher-card__subject-awards {
  color: var(--gray-75);
}
</style>
