<script setup>
import { computed } from 'vue'
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiInput from '@/components/ui/UiInput.vue'
import TimeSlotEditor from './TimeSlotEditor.vue'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * StepAddress - step 4a + 4b: address (conditional) + time slots
 * -------------------------------------------------------
 * - Address input is shown ONLY when teachingMethod is offline/both (M8-10a decision:
 *   address is collected only for offline / offline+online; absent for out-of-province online). Since only Shanghai permits
 *   offline, this effectively means Shanghai + offline/both. Structured Shanghai
 *   district/street picker is pending S3 region contract; free-text for now.
 * - Time slots via TimeSlotEditor (M8-10b).
 */
const props = defineProps({
  form: { type: Object, required: true },
})

const needsAddress = computed(
  () => props.form.teachingMethod === 'offline' || props.form.teachingMethod === 'both',
)
</script>

<template>
  <div class="step-addr">
    <UiFieldInput
      v-if="needsAddress"
      :title="MY_DEMANDS_COPY.FIELD_ADDRESS"
      required
      :filled="!!form.addressArea"
    >
      <UiInput v-model="form.addressArea" :placeholder="MY_DEMANDS_COPY.PH_ADDRESS" :max-length="40" />
    </UiFieldInput>

    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_TIME" :filled="(form.expectedTime || []).length > 0">
      <TimeSlotEditor v-model="form.expectedTime" />
    </UiFieldInput>
  </div>
</template>

<style scoped>
.step-addr {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
