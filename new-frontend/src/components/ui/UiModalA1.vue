<script setup>
import { ref } from 'vue'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import { useScrollFade } from '@/composables/useScrollFade'
import { UI_COPY } from '@/constants/ui.js'
import Close from '@/assets/svg/close.svg'

/**
 * UiModalA1 - Modal A1 (plan "modal styles - modal A1")
 * -------------------------------------------------------
 * - Otherwise same as modal A; top bar white no border: left title (black slightly bold, left-aligned, inset from the edge), right SVG X exit button B.
 * - When scrollable: below the top bar + at the bottom edge upward, generate the same white fade masks as the chat area; none when not scrollable.
 */
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  closeOnOutside: { type: Boolean, default: true },
  closeOnEsc: { type: Boolean, default: true },
  label: { type: String, default: '' },
  width: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:open'])
const bodyRef = ref(null)
const fade = useScrollFade(bodyRef)

function close() {
  emit('close')
  emit('update:open', false)
}
</script>

<template>
  <UiModal
    :open="open"
    :label="label || title"
    :width="width"
    :close-on-outside="closeOnOutside"
    :close-on-esc="closeOnEsc"
    @close="close"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="ui-modala1">
      <header class="ui-modala1__bar">
        <h2 class="ui-modala1__title">{{ title }}</h2>
        <UiButton variant="B" circle size="sm" class="ui-modala1__close" :aria-label="UI_COPY.CLOSE" @click="close">
          <Close :width="16" :height="16" aria-hidden="true" />
        </UiButton>
      </header>

      <div ref="bodyRef" class="ui-modala1__body">
        <slot />
      </div>

      <div v-if="fade.scrollable.value && !fade.atTop.value" class="ui-modala1__mask ui-modala1__mask--top" aria-hidden="true"></div>
      <div v-if="fade.scrollable.value && !fade.atBottom.value" class="ui-modala1__mask ui-modala1__mask--bottom" aria-hidden="true"></div>
    </div>
  </UiModal>
</template>

<style scoped>
.ui-modala1 {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: 82vh;
}

/* top bar: white no border, title left / X right, both inset from the edges */
.ui-modala1__bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: var(--modala1-bar-h, 52px);
  box-sizing: border-box;
  padding: 0 var(--space-5);
  background: var(--paper-raised);
}
.ui-modala1__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ui-modala1__close { flex: none; }

/* body: scrollable */
.ui-modala1__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* same white fade masks as the chat area */
.ui-modala1__mask {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--modal-mask-h);
  pointer-events: none;
  z-index: 3;
}
.ui-modala1 { position: relative; }
.ui-modala1__mask--top {
  top: var(--modala1-bar-h, 52px);
  background: linear-gradient(to bottom, var(--paper-raised), transparent);
}
.ui-modala1__mask--bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--paper-raised), transparent);
}
</style>
