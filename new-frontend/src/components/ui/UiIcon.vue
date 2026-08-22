<script setup>
import { computed } from 'vue'
import { iconRegistry } from './icons.js'

const props = defineProps({
  /** icon name = assets/svg filename (without .svg), see icons.js registry */
  name: { type: String, required: true },
  /** pixel size (width and height equal) */
  size: { type: [Number, String], default: 20 },
})

const comp = computed(() => iconRegistry[props.name] || null)
</script>

<template>
  <component
    :is="comp"
    v-if="comp"
    class="ui-icon"
    :width="size"
    :height="size"
    aria-hidden="true"
  />
</template>

<style scoped>
.ui-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
}
</style>
