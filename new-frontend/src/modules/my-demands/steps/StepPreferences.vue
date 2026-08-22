<script setup>
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import { PERSONALITY_TAGS, PERSONALITY_TAGS_MAX } from '../region.js'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * StepPreferences - step 4c + 5: personality tags + gender + budget + intro (M8-10c / M8-11)
 * -------------------------------------------------------
 * - Personality tags: toggle set clamped to PERSONALITY_TAGS_MAX (excess rejected).
 * - Gender: single-select male/female radio.
 * - Budget: min/max digits (I-35 budgetMin/budgetMax, required).
 * - Intro: auto-grow textarea (Enter inserts newline), <= 200 chars (counter via UiInput maxLength).
 */
const props = defineProps({
  form: { type: Object, required: true },
})

function toggleTag(value) {
  const cur = Array.isArray(props.form.preferredTags) ? props.form.preferredTags.slice() : []
  if (cur.includes(value)) {
    props.form.preferredTags = cur.filter((t) => t !== value)
    return
  }
  if (cur.length >= PERSONALITY_TAGS_MAX) return // clamped
  props.form.preferredTags = [...cur, value]
}

function setGender(value) {
  props.form.preferredGender = props.form.preferredGender === value ? '' : value
}
</script>

<template>
  <div class="step-pref">
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_PERSONALITY" :filled="(form.preferredTags || []).length > 0">
      <div class="step-pref__tags">
        <UiCheckButton
          v-for="t in PERSONALITY_TAGS"
          :key="t.value"
          :model-value="(form.preferredTags || []).includes(t.value)"
          :label="t.label"
          variant="B"
          @click="toggleTag(t.value)"
        />
      </div>
    </UiFieldInput>

    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_GENDER" :filled="!!form.preferredGender">
      <div class="step-pref__genders">
        <UiCheckButton
          :model-value="form.preferredGender === 'male'"
          :label="MY_DEMANDS_COPY.GENDER_MALE"
          variant="B"
          @click="setGender('male')"
        />
        <UiCheckButton
          :model-value="form.preferredGender === 'female'"
          :label="MY_DEMANDS_COPY.GENDER_FEMALE"
          variant="B"
          @click="setGender('female')"
        />
      </div>
    </UiFieldInput>

    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_BUDGET_MIN" required :filled="!!form.budgetMin">
      <UiInput v-model="form.budgetMin" :placeholder="MY_DEMANDS_COPY.PH_BUDGET" filter="digits" :max-length="6" width="160px" />
    </UiFieldInput>
    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_BUDGET_MAX" required :filled="!!form.budgetMax">
      <UiInput v-model="form.budgetMax" :placeholder="MY_DEMANDS_COPY.PH_BUDGET" filter="digits" :max-length="6" width="160px" />
    </UiFieldInput>

    <UiFieldInput :title="MY_DEMANDS_COPY.FIELD_INTRO" :filled="!!form.additionalInfo">
      <UiInput
        v-model="form.additionalInfo"
        :placeholder="MY_DEMANDS_COPY.PH_INTRO"
        :max-length="200"
        :send-on-enter="false"
      />
    </UiFieldInput>
  </div>
</template>

<style scoped>
.step-pref {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.step-pref__tags,
.step-pref__genders {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.step-pref__tags :deep(.ui-checkbtn),
.step-pref__genders :deep(.ui-checkbtn) {
  --btn-w: 120px;
}
</style>
