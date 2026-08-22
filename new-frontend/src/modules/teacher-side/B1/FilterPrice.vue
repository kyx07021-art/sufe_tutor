<script setup>
/**
 * FilterPrice - B1-5c price range filter card (min / max numeric inputs)
 * -------------------------------------------------------
 * - Two digit-only inputs (lowest / highest price), labels from TEACHER_COPY.
 * - v-model: modelValue = { priceMin: number|null, priceMax: number|null }.
 * - Digits are filtered on input (UiInput filter="digits"); each change emits a
 *   fresh { priceMin, priceMax } object with empty fields normalized to null.
 */
import { ref, watch } from 'vue'
import { TEACHER_COPY } from '@/constants/ui.js'
import { UiInput } from '@/components/ui/index.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ priceMin: null, priceMax: null }) },
})

const emit = defineEmits(['update:modelValue'])

const minText = ref(props.modelValue.priceMin == null ? '' : String(props.modelValue.priceMin))
const maxText = ref(props.modelValue.priceMax == null ? '' : String(props.modelValue.priceMax))

function parsePrice(text) {
  const digits = String(text).replace(/\D/g, '')
  return digits === '' ? null : Number(digits)
}

function emitRange() {
  emit('update:modelValue', {
    priceMin: parsePrice(minText.value),
    priceMax: parsePrice(maxText.value),
  })
}

function onMinInput(value) {
  minText.value = value
  emitRange()
}
function onMaxInput(value) {
  maxText.value = value
  emitRange()
}

watch(
  () => props.modelValue,
  (nv) => {
    minText.value = nv.priceMin == null ? '' : String(nv.priceMin)
    maxText.value = nv.priceMax == null ? '' : String(nv.priceMax)
  },
)
</script>

<template>
  <div class="filter-price">
    <div class="filter-price__field">
      <span class="filter-price__label">{{ TEACHER_COPY.B1_PRICE_MIN }}</span>
      <UiInput
        :model-value="minText"
        filter="digits"
        width="120px"
        :aria-label="TEACHER_COPY.B1_PRICE_MIN"
        @update:model-value="onMinInput"
      />
    </div>
    <div class="filter-price__field">
      <span class="filter-price__label">{{ TEACHER_COPY.B1_PRICE_MAX }}</span>
      <UiInput
        :model-value="maxText"
        filter="digits"
        width="120px"
        :aria-label="TEACHER_COPY.B1_PRICE_MAX"
        @update:model-value="onMaxInput"
      />
    </div>
  </div>
</template>

<style scoped>
.filter-price {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.filter-price__field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.filter-price__label {
  flex: none;
  color: var(--ink);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
</style>
