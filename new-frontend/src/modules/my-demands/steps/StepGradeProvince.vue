<script setup>
import { computed, watch } from 'vue'
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiDropdown from '@/components/ui/UiDropdown.vue'
import { GRADES, PREP_GRADE, PROVINCES, allowsOffline } from '../region.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * StepGradeProvince - step 1: grade + province (M8-07)
 * -------------------------------------------------------
 * - Grade list follows the province school system: Shanghai uses the 5-4 system where
 *   primary-6 (p6) is replaced by the prep grade (prep class). Other provinces use p1..p6.
 * - Switching to a non-offline province resets an offline/both teaching method to online
 *   (M8-08 forced-online linkage lives here because this step owns the province field).
 */
const props = defineProps({
  form: { type: Object, required: true },
})

const gradeOptions = computed(() => {
  if (props.form.province === 'shanghai') {
    // 5-4 system: replace primary-6 with the prep grade in place.
    return GRADES.flatMap((g) => (g.value === 'p6' ? [PREP_GRADE] : [g]))
  }
  return GRADES
})

watch(
  () => props.form.province,
  (prov) => {
    if (!prov) return
    const opts = gradeOptions.value
    if (props.form.grade && !opts.some((o) => o.value === props.form.grade)) {
      props.form.grade = ''
    }
    if (!allowsOffline(prov) && (props.form.teachingMethod === 'offline' || props.form.teachingMethod === 'both')) {
      props.form.teachingMethod = 'online'
    }
  },
)
</script>

<template>
  <div class="step-gp">
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_GRADE" required :filled="!!form.grade">
      <UiDropdown
        v-model="form.grade"
        variant="B"
        :options="gradeOptions"
        :placeholder="MY_DEMANDS_COPY.PH_GRADE"
        columns="2"
      />
    </UiFieldInput>
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_PROVINCE" required :filled="!!form.province">
      <UiDropdown
        v-model="form.province"
        variant="B"
        :options="PROVINCES"
        :placeholder="MY_DEMANDS_COPY.PH_PROVINCE"
        columns="2"
      />
    </UiFieldInput>
  </div>
</template>

<style scoped>
.step-gp {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
