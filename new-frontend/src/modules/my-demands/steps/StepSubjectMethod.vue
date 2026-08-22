<script setup>
import { computed } from 'vue'
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiDropdown from '@/components/ui/UiDropdown.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { SUBJECTS, allowsOffline } from '../region.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * StepSubjectMethod - step 2: subject (single-select) + teaching method (M8-08)
 * -------------------------------------------------------
 * - Subject is single-choice (single-subject single-select): a dropdown over SUBJECTS (one value).
 * - Method: offline / both are only available when the province permits offline
 *   (allowsOffline, currently Shanghai only). Non-offline provinces force online.
 */
const props = defineProps({
  form: { type: Object, required: true },
})

const offlineAllowed = computed(() => allowsOffline(props.form.province))

const methodOptions = computed(() => {
  const base = [
    { value: 'online', label: MY_DEMANDS_COPY.METHOD_ONLINE },
    { value: 'offline', label: MY_DEMANDS_COPY.METHOD_OFFLINE },
    { value: 'both', label: MY_DEMANDS_COPY.METHOD_BOTH },
  ]
  return offlineAllowed.value ? base : base.filter((o) => o.value === 'online')
})

function selectMethod(value) {
  if (value === 'online' || offlineAllowed.value) {
    props.form.teachingMethod = value
  }
}
</script>

<template>
  <div class="step-sm">
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_SUBJECT" required :filled="!!form.subject">
      <UiDropdown
        v-model="form.subject"
        variant="B"
        :options="SUBJECTS"
        :placeholder="MY_DEMANDS_COPY.PH_SUBJECT"
      />
    </UiFieldInput>
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_METHOD" required :filled="!!form.teachingMethod">
      <div class="step-sm__methods">
        <UiCheckButton
          v-for="o in methodOptions"
          :key="o.value"
          :model-value="form.teachingMethod === o.value"
          :label="o.label"
          variant="B"
          @click="selectMethod(o.value)"
        />
      </div>
    </UiFieldInput>
  </div>
</template>

<style scoped>
.step-sm {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.step-sm__methods {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.step-sm__methods :deep(.ui-checkbtn) {
  --btn-w: 130px;
}
</style>
