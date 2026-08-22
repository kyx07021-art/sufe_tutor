<script setup>
import { ref, onMounted } from 'vue'
import MyDemandsPage from './MyDemandsPage.vue'
import DemandCard from './DemandCard.vue'
import UiToast from '@/components/ui/UiToast.vue'
import { dhGet, dhInvalidate } from '@/core/datahub.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * MyDemandsPreview - M8 dev preview harness (dev-only, not assembled in production)
 * -------------------------------------------------------
 * - Student mode: real MyDemandsPage (I-33 data chain; smoke test mocks routes via Playwright).
 * - Teacher mode: static fixture renders DemandCard mode="teacher" to show the M9 B1 reuse shape.
 * - Mounts UiToast so submit/delete toasts are visible in the harness.
 * - Exposes window.__myDemandsDebug (dev-only) for the smoke test to drive cache/invalidate/reload.
 */
const pageRef = ref(null)

function reload(force = false) {
  pageRef.value && pageRef.value.load(force)
}

const teacherFixture = {
  id: 7,
  user_id: 3,
  subject: '数学',
  grade: '初中二年级',
  province: '上海',
  teachingMethod: 'both',
  currentScore: 92,
  currentScoreFull: 100,
  addressArea: '杨浦区·五角场街道',
  expectedTime: '每周日下午2点到4点',
  preferredTags: ['幽默', '有耐心'],
  preferredGender: 'female',
  additionalInfo: '基础偏弱，希望系统梳理初一初二知识框架。',
  studentName: '小舟',
  studentAvatar: '',
  matchScore: 86,
  matchCount: 3,
}

onMounted(() => {
  window.__myDemandsDebug = {
    dhGet,
    dhInvalidate,
    reload: () => reload(false),
    forceReload: () => reload(true),
  }
})
</script>

<template>
  <main class="md-preview">
    <h1 class="md-preview__h">{{ MY_DEMANDS_COPY.PREVIEW_TITLE }}</h1>
    <p class="md-preview__sub">{{ MY_DEMANDS_COPY.PREVIEW_SUBTITLE }}</p>

    <h2 class="md-preview__h2">{{ MY_DEMANDS_COPY.PREVIEW_STUDENT_SECTION }}</h2>
    <MyDemandsPage ref="pageRef" />

    <h2 class="md-preview__h2">{{ MY_DEMANDS_COPY.PREVIEW_TEACHER_SECTION }}</h2>
    <div class="md-preview__teacher">
      <DemandCard :demand="teacherFixture" mode="teacher" />
    </div>

    <UiToast />
  </main>
</template>

<style scoped>
.md-preview {
  background: var(--paper);
  min-height: 100vh;
  padding: var(--space-6) 0 var(--space-8);
}
.md-preview__h {
  padding: 0 5%;
  font-size: var(--fs-xl);
  font-weight: 700;
}
.md-preview__sub {
  padding: var(--space-2) 5%;
  color: var(--gray-60);
}
.md-preview__h2 {
  padding: var(--space-6) 5% var(--space-3);
  font-size: var(--fs-lg);
  font-weight: 600;
}
.md-preview__teacher {
  padding: 0 5%;
}
.md-preview__teacher .demand-card {
  width: 28.33%;
}
</style>
