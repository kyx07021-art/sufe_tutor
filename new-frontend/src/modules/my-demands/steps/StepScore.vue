<script setup>
import { ref, computed, watch } from 'vue'
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiDropdown from '@/components/ui/UiDropdown.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { SUBJECT_FULL_SCORE, BAND_SCORES, regionPolicy } from '../region.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * StepScore - step 3: score component, region-policy aware (M8-09)
 * -------------------------------------------------------
 * - Two entry modes: raw (score + full) / band (A-E -> band scoring).
 * - Default mode follows the province policy: 3+3 provinces start in band mode,
 *   others in raw mode (policy branch; user can switch freely).
 * - Raw mode clamps to [0, currentFull||subjectDefault]; the full defaults to the
 *   subject's main-score full (chinese/math/english 150, others 100) and is editable.
 * - Band mode maps A-E to BAND_SCORES (standard5 approximation), full fixed at 100.
 * - Collect: form.currentScore + form.currentScoreFull (I-35 row echo; the submit
 *   payload omits currentScoreFull - the backend derives it from subject).
 */
const props = defineProps({
  form: { type: Object, required: true },
})

const scoreMode = ref('raw')
const band = ref('')

const BAND_OPTIONS = ['A', 'B', 'C', 'D', 'E'].map((k) => ({
  value: k,
  label: MY_DEMANDS_COPY['BAND_' + k],
}))

const defaultFull = computed(() => SUBJECT_FULL_SCORE[props.form.subject] || 100)

const fullScore = computed({
  get: () => (props.form.currentScoreFull ? String(props.form.currentScoreFull) : String(defaultFull.value)),
  set: (v) => {
    props.form.currentScoreFull = v
  },
})

const rawScore = computed({
  get: () => (props.form.currentScore == null ? '' : String(props.form.currentScore)),
  set: (v) => {
    if (v === '') {
      props.form.currentScore = ''
      return
    }
    const n = Number(v)
    const max = Number(props.form.currentScoreFull) || Number(defaultFull.value)
    props.form.currentScore = String(Math.min(Number.isNaN(n) ? 0 : n, max))
  },
})

// Echo from edit prefill: if full == 100 and the score matches a band value, show band mode.
watch(
  [() => props.form.currentScore, () => props.form.currentScoreFull, () => props.form.province],
  ([sc, full]) => {
    const policy = regionPolicy(props.form.province)
    if (String(full) === '100' && sc != null && sc !== '' && Object.values(BAND_SCORES).includes(Number(sc))) {
      scoreMode.value = 'band'
      band.value = Object.keys(BAND_SCORES).find((k) => BAND_SCORES[k] === Number(sc)) || ''
      return
    }
    if (!sc && !full) {
      scoreMode.value = policy.policy === '3+3' ? 'band' : 'raw'
    }
  },
  { immediate: true },
)

function setBand(b) {
  band.value = b
  props.form.currentScore = String(BAND_SCORES[b])
  props.form.currentScoreFull = '100'
}
</script>

<template>
  <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_SCORE" :filled="!!form.currentScore">
    <div class="step-score__tabs">
      <UiCheckButton
        :model-value="scoreMode === 'raw'"
        :label="MY_DEMANDS_COPY.SCORE_RAW"
        variant="B"
        @click="scoreMode = 'raw'"
      />
      <UiCheckButton
        :model-value="scoreMode === 'band'"
        :label="MY_DEMANDS_COPY.SCORE_BAND"
        variant="B"
        @click="scoreMode = 'band'"
      />
    </div>

    <div v-if="scoreMode === 'raw'" class="step-score__raw">
      <UiInput v-model="rawScore" :placeholder="MY_DEMANDS_COPY.PH_SCORE" filter="digits" :max-length="3" />
      <span class="step-score__sep">/</span>
      <UiInput v-model="fullScore" :placeholder="MY_DEMANDS_COPY.PH_FULL" filter="digits" :max-length="3" width="80px" />
      <span class="step-score__unit">{{ MY_DEMANDS_COPY.FIELD_SCORE_FULL }}</span>
    </div>

    <div v-else class="step-score__band">
      <UiDropdown v-model="band" variant="B" :options="BAND_OPTIONS" :placeholder="MY_DEMANDS_COPY.SCORE_BAND" @select="setBand" />
    </div>
  </UiFieldInput>
</template>

<style scoped>
.step-score__tabs {
  display: flex;
  gap: var(--space-3);
}
.step-score__tabs :deep(.ui-checkbtn) {
  --btn-w: 110px;
}
.step-score__raw {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.step-score__sep {
  color: var(--gray-50);
}
.step-score__unit {
  color: var(--gray-75);
  font-size: var(--fs-sm);
}
.step-score__band {
  max-width: 220px;
}
</style>
