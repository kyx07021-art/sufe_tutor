<script setup>
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { MY_DEMANDS_COPY } from '@/constants/m-my-demands.js'

/**
 * DemandPlusSlot - A2 plus fill slot (M8-03)
 * -------------------------------------------------------
 * - Occupies the next empty card slot: always the grid's last child, so DemandGrid's
 *   nth-child placement auto-locates it to the next free cell (row-major fill).
 * - Root fills the grid cell (height:100%); a large rounded-square plus button (variant C)
 *   sits centered inside — sized like a card embryo rather than a small control.
 * - Button = UiButton variant C (rounded rectangle, not capsule) containing UiIcon "plus".
 *   Size via scoped :deep override of --btn-w/--btn-h/--btn-pad/--btn-radius (CSS variable
 *   data channel; zero inline style attributes). Zero-pad so the centered icon is not clipped.
 * - Click emits 'create' (parent M8-06 DemandEditorModal opens the create flow).
 * - a11y: aria-label from MY_DEMANDS_COPY (single source; template holds zero Chinese).
 */
const PLUS_ICON_SIZE = 48

const createLabel = MY_DEMANDS_COPY.CREATE_TITLE
const emit = defineEmits(['create'])

function onClick() {
  emit('create')
}
</script>

<template>
  <div class="demand-plus-slot">
    <UiButton variant="C" :aria-label="createLabel" @click="onClick">
      <UiIcon name="plus" :size="PLUS_ICON_SIZE" />
    </UiButton>
  </div>
</template>

<style scoped>
.demand-plus-slot {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Card-embryo plus button: rounded square (matches UiCard radius), icon centered (zero pad). */
.demand-plus-slot :deep(.ui-btn) {
  --btn-w: 120px;
  --btn-h: 120px;
  --btn-pad: 0;
  --btn-radius: var(--radius-md);
}
</style>
