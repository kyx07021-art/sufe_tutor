<script setup>
/**
 * RelationCard — M3-08 relation card (hangs on the midpoint of a dashed edge)
 * --------------------------------------------------------------------------
 * - One card per session edge: the whole card is a UiButton variant C1
 *   (rounded rectangle + right arrow). Clicking jumps to the conversation
 *   (emits `open` with the conversation id).
 * - `layout="float"` (default): card CENTER is placed at the dashed curve
 *   midpoint — position comes from CSS variables fed through the Vue :style
 *   data channel (CSSOM, safe under CSP style-src-attr 'none' — no literal
 *   style= in the template).
 * - `layout="list"`: card is a static block used in the vertical list below the
 *   board; x/y are ignored. The other user's NAME label renders above the
 *   button because a list card has no avatar proximity to disambiguate it.
 * - Ended session: fill becomes gray-10 and label/arrow gray-60 (copy:
 *   CARD_ENDED), but the button REMAINS clickable (not `disabled`).
 * - Zero raw Chinese in markup / comments (copy comes from m-relations.js).
 */
import { computed } from 'vue'
import { UiButton } from '@/components/ui/index.js'
import { RELATIONS_COPY, RELATIONS_GEOMETRY } from '@/constants/m-relations.js'

const props = defineProps({
  /** M3-01 session Edge { conversationId, status: 'active'|'closed', tempStatus, last, other } */
  edge: { type: Object, required: true },
  /** Card CENTER x (dashed-curve midpoint, px). Float layout only; ignored in `list`. */
  x: { type: Number, default: 0 },
  /** Card CENTER y (dashed-curve midpoint, px). Float layout only; ignored in `list`. */
  y: { type: Number, default: 0 },
  /** Card width px (module geometry single source) */
  width: { type: Number, default: RELATIONS_GEOMETRY.CARD_W },
  /** 'float' (absolute, centered on x/y) | 'list' (static block in the card list) */
  layout: {
    type: String,
    default: 'float',
    validator: (v) => ['float', 'list'].includes(v),
  },
})

const emit = defineEmits(['open'])

/** Copy single source (module-level). */
const COPY = RELATIONS_COPY

/** Ended session = closed edge. */
const isEnded = computed(() => props.edge.status === 'closed')

/** Center positioning via CSS variables (CSSOM data channel). In `list` layout
 *  x/y are ignored by the stylesheet (position static), so no CSS vars are set. */
const pos = computed(() => ({
  '--card-x': `${props.x}px`,
  '--card-y': `${props.y}px`,
  '--card-w': `${props.width}px`,
}))

/** Emit conversation id so the page can jump to the conversation. */
function open() {
  emit('open', { conversationId: props.edge.conversationId })
}
</script>

<template>
  <div
    class="rel-card"
    :class="{ 'rel-card--ended': isEnded, 'rel-card--list': layout === 'list' }"
    :style="layout === 'float' ? pos : undefined"
  >
    <template v-if="layout === 'list'">
      <span class="rel-card__name">{{ edge.other.name }}</span>
    </template>
    <UiButton
      variant="C1"
      :width="width + 'px'"
      class="rel-card__btn"
      :class="{ 'rel-card__btn--ended': isEnded }"
      @click="open"
    >
      {{ isEnded ? COPY.CARD_ENDED : COPY.CARD_ACTIVE }}
    </UiButton>
  </div>
</template>

<style scoped>
/* -- Positioning: card CENTER sits on the dashed-curve midpoint (float). -- */
.rel-card {
  position: absolute;
  left: var(--card-x);
  top: var(--card-y);
  width: var(--card-w);
  transform: translate(-50%, -50%);
}

/* -- List layout (card list below the board): static block, x/y ignored. -- */
.rel-card--list {
  position: static;
  transform: none;
  width: auto;
}

/* -- List-card name label (disambiguates the session without an avatar). -- */
.rel-card__name {
  display: block;
  font-size: var(--fs-sm);
  color: var(--gray-60);
  margin-bottom: 4px;
}

/* -- Ended session: grayed but STILL clickable (no `disabled`). --
   `.rel-card__btn--ended.ui-btn` targets the UiButton ROOT element directly:
   the parent class lands on the child root, which carries the parent scope
   attribute, so the compound selector matches it with higher specificity than
   UiButton's own `.ui-btn--c1[data-v-...]`. A `:deep(.ui-btn)` DESCENDANT
   selector would never match because .ui-btn IS the root, not a descendant. */
.rel-card__btn--ended.ui-btn {
  background: var(--gray-10);
  border-color: var(--gray-10);
}

.rel-card__btn--ended :deep(.ui-btn__label),
.rel-card__btn--ended :deep(.ui-btn__arrow) {
  color: var(--gray-60);
}

/* Neutralize the hover micro-lift and keep label/arrow gray-60 on hover. */
.rel-card__btn--ended.ui-btn:hover {
  transform: none;
}

.rel-card__btn--ended:hover :deep(.ui-btn__label),
.rel-card__btn--ended:hover :deep(.ui-btn__arrow) {
  color: var(--gray-60);
}
</style>
