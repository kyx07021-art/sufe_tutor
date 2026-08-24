<script setup>
import { ref } from 'vue'
import UiDropdown from '../src/components/ui/UiDropdown.vue'

const menuVal = ref('')
const widthVal = ref('')
const menuOptions = ['Option one', 'Option two', 'Option three', 'Option four']
const widthOptions = ['One', 'Two', 'Three']
</script>

<template>
  <div class="zh">
    <div class="zh__corner">
      <UiDropdown
        v-model="menuVal"
        align="down"
        align-x="right"
        :options="menuOptions"
        placeholder="Right menu"
        class="zh-trigger zh-trigger--right"
      />
    </div>
    <div class="zh__mid">
      <UiDropdown
        v-model="widthVal"
        align="down"
        align-x="left"
        :options="widthOptions"
        placeholder="Match width"
        class="zh-trigger zh-trigger--match"
      />
    </div>
  </div>
</template>
