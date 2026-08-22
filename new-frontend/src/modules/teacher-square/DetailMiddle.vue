<script setup>
import { computed } from 'vue'
import RatingStars from './RatingStars.vue'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

/**
 * DetailMiddle - M7-20 detail modal middle column (subjects + featured review)
 * -----------------------------------------------------------------------------
 * - Props: teacher (mapped I-29 teacher), reviews (I-31 review list, may be empty).
 * - Layout top->bottom:
 *   1. two standard font-heights of top whitespace (root padding)
 *   2. one subject component per teacher.subjects[]: a title row (subject name in
 *      large bold + " score/full " + two-space separated awards, all baselines
 *      aligned) followed by the teaching-philosophy body (gray-75, right edge
 *      capped at 10%); between components one title-row character height gap
 *   3. a horizontal divider in normal flow, its position pushed by the content
 *      below it (margins)
 *   4. rating block: RatingStars (score) + black-bold rating number + gray
 *      parenthetical review count (T.RATING_COUNT)
 *   5. featured review = first review's comment + right-aligned signature line,
 *      or the centered gray empty state (T.NO_TOP_REVIEW) with a shorter area
 * - Contract 6: zero raw CJK in markup/script/comments (all copy via T); zero
 *   inline event/style attrs; zero unescaped-HTML interpolation; zero runtime
 *   style injection; tokens only.
 */
const props = defineProps({
  teacher: { type: Object, required: true },
  reviews: { type: Array, default: () => [] },
})

/** Normalize subject blocks; each subject carries its own awards[] list. */
const subjects = computed(() =>
  (Array.isArray(props.teacher.subjects) ? props.teacher.subjects : []).map((s) => ({
    name: s.subject ?? '',
    score: s.score,
    full: s.full,
    awards: Array.isArray(s.awards) ? s.awards.filter(Boolean) : [],
  })),
)

/**
 * Meta text for one subject title row: "  score/full  award1  award2".
 * The leading and inner two-space separators are preserved by the
 * .dm-subject__meta white-space rule (design: items separated by two spaces).
 */
function subjectMeta(s) {
  const parts = []
  if (s.score != null && s.full != null) parts.push(`${s.score}/${s.full}`)
  if (s.awards.length) parts.push(s.awards.join('  '))
  return parts.length ? '  ' + parts.join('  ') : ''
}

/** First review is the featured one (I-31 returns the picked/approved list). */
const featured = computed(() =>
  Array.isArray(props.reviews) && props.reviews.length ? props.reviews[0] : null,
)

/** Rating number; '–' when the teacher has no rating yet (defensive). */
const ratingNum = computed(() =>
  props.teacher.rating != null ? String(props.teacher.rating) : '–',
)
</script>

<template>
  <div class="dm-middle">
    <!-- Subject components (one per teacher subject) -->
    <div v-for="(s, i) in subjects" :key="`${s.name}-${i}`" class="dm-subject">
      <div class="dm-subject__title">
        <span class="dm-subject__name">{{ s.name }}</span><span v-if="subjectMeta(s)" class="dm-subject__meta">{{ subjectMeta(s) }}</span>
      </div>
      <p v-if="teacher.bio" class="dm-subject__body">{{ teacher.bio }}</p>
    </div>

    <!-- Divider: normal flow; its vertical position follows the content below -->
    <div class="dm-divider" aria-hidden="true"></div>

    <!-- Rating block: stars + black-bold number + gray parenthetical count -->
    <div class="dm-rating">
      <RatingStars :score="teacher.rating ?? 0" />
      <span class="dm-rating__score"><span class="dm-rating__num">{{ ratingNum }}</span> <span class="dm-rating__count">{{ T.RATING_COUNT(teacher.reviewCount ?? 0) }}</span></span>
    </div>

    <!-- Featured review (first review) or the centered empty state -->
    <div v-if="featured" class="dm-review">
      <p v-if="featured.comment" class="dm-review__body">{{ featured.comment }}</p>
      <p class="dm-review__sign">{{ T.REVIEW_SIGN }}{{ featured.reviewerName }}</p>
    </div>
    <p v-else class="dm-review__empty">{{ T.NO_TOP_REVIEW }}</p>
  </div>
</template>

<style scoped>
.dm-middle {
  min-width: 0;
  padding: calc(var(--fs-base) * 2) 5% calc(var(--fs-base) * 2);
  overflow-wrap: break-word;
}

/* between subject components: one title-row large-bold character height */
.dm-subject + .dm-subject {
  margin-top: var(--fs-lg);
}

.dm-subject__title {
  min-width: 0;
}

.dm-subject__name {
  color: var(--ink);
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: var(--lh-tight);
}

.dm-subject__meta {
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  white-space: pre-wrap; /* keeps the two-space item separators */
  overflow-wrap: break-word;
}

/* body: left edge at 5% (root padding), right edge capped at 10% */
.dm-subject__body {
  margin-top: calc(var(--lh-body) * 1em);
  padding-right: 5%;
  color: var(--gray-75);
  font-size: var(--fs-base);
  line-height: var(--lh-body);
  overflow-wrap: break-word;
  word-break: break-word;
}

.dm-divider {
  margin: var(--space-5) 0;
  border-top: var(--border-w) solid var(--line);
}

.dm-rating {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dm-rating__score {
  min-width: 0;
}

.dm-rating__num {
  color: var(--ink);
  font-weight: 700;
}

.dm-rating__count {
  color: var(--gray-75);
}

.dm-review {
  margin-top: var(--space-5);
}

.dm-review__body {
  padding-right: 5%;
  color: var(--gray-75);
  line-height: var(--lh-body);
  overflow-wrap: break-word;
  word-break: break-word;
}

.dm-review__sign {
  margin-top: var(--space-2);
  color: var(--gray-75);
  text-align: right;
}

.dm-review__empty {
  margin-top: var(--space-5);
  color: var(--gray-75);
  text-align: center;
}
</style>
