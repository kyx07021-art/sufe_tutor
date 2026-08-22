<script setup>
/**
 * RelationAvatar — M3-05 avatar + id renderer for the C1 relations board.
 * -----------------------------------------------------
 * - One floating avatar per node (or the center self avatar). The avatar is
 *   positioned on the board by its center coordinate (x, y) using a CSSOM
 *   data channel (Vue :style binding), which is allowed under CSP
 *   style-src-attr 'none' (no literal style= attribute in the template).
 * - Circle ring of `diameter` px with a thin gray-70 frame; the avatar image
 *   fills the ring, or a user icon fallback is shown centered in gray-70.
 * - Below the ring, the id text in ink (self -> "me" copy, other -> node.name).
 * - Interactive: role="button" + tabindex 0; Enter / Space re-trigger the
 *   click emit (the page wires the profile panel later). Hover darkens the
 *   ring frame.
 * - English only: zero raw Chinese in markup / script / comments (contract 6).
 */
import { computed } from 'vue'
import { UiIcon } from '@/components/ui/index.js'
import { RELATIONS_COPY } from '@/constants/m-relations.js'

const props = defineProps({
  /** M3-01 node shape: { userId, role, name, avatar, status, edgeCount, ... } */
  node: { type: Object, required: true },
  /** Board px, avatar CENTER x (M3-03 layout position). */
  x: { type: Number, required: true },
  /** Board px, avatar CENTER y (M3-03 layout position). */
  y: { type: Number, required: true },
  /** Ring diameter px (150 self / 100 other; the page decides). */
  diameter: { type: Number, required: true },
  /** Center (self) avatar flag. */
  isSelf: { type: Boolean, default: false },
})

const emit = defineEmits(['click'])

/** Id label below the ring: self uses the copy constant, others use node.name. */
const idText = computed(() =>
  props.isSelf ? RELATIONS_COPY.SELF_NAME : props.node.name || ''
)

/** Board position via CSSOM data channel: CSS vars drive the ring + anchor. */
const pos = computed(() => ({
  '--av-x': `${props.x}px`,
  '--av-y': `${props.y}px`,
  '--av-d': `${props.diameter}px`,
}))

function emitClick() {
  emit('click')
}

/** Keyboard activation: Enter / Space act like a click (button semantics). */
function onKey(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('click')
  }
}
</script>

<template>
  <div
    class="rel-avatar"
    :class="{ 'rel-avatar--self': isSelf }"
    :style="pos"
    role="button"
    tabindex="0"
    @click="emitClick"
    @keydown="onKey"
  >
    <span class="rel-avatar__ring">
      <img v-if="node.avatar" :src="node.avatar" class="rel-avatar__img" alt="" />
      <UiIcon v-else class="rel-avatar__icon" name="user" aria-hidden="true" />
    </span>
    <span class="rel-avatar__id">{{ idText }}</span>
  </div>
</template>

<style scoped>
/* -- Floating avatar block: absolutely anchored so its center sits on (x, y). -- */
.rel-avatar {
  position: absolute;
  left: var(--av-x);
  top: var(--av-y);
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

/* -- Circular frame that holds the avatar image (or the fallback icon). -- */
.rel-avatar__ring {
  width: var(--av-d);
  height: var(--av-d);
  box-sizing: border-box;
  border-radius: var(--radius-circle);
  border: var(--border-w) solid var(--gray-70);
  background: var(--paper);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--dur-sm) ease;
}

/* -- Avatar image fills the ring; object-fit keeps the crop centered. -- */
.rel-avatar__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* -- Fallback user icon: centered, sized to a fraction of the ring. -- */
.rel-avatar__icon {
  width: 45%;
  height: 45%;
  color: var(--gray-70);
}

/* -- Id text below the ring: ink, small, centered, capped at ring width. -- */
.rel-avatar__id {
  margin-top: 6px;
  max-width: var(--av-d);
  font-size: var(--fs-sm);
  line-height: var(--lh-tight);
  color: var(--ink);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* -- Hover: frame subtly darkens to signal interactivity. -- */
.rel-avatar:hover .rel-avatar__ring {
  border-color: var(--gray-60);
}

/* -- Keyboard focus ring (button semantics). -- */
.rel-avatar:focus-visible .rel-avatar__ring {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}

/* -- Self avatar: thicker frame + a paper halo that lifts it off the lines. -- */
.rel-avatar--self .rel-avatar__ring {
  border-width: var(--border-w-thick);
  box-shadow: 0 0 0 3px var(--paper);
}

/* -- reduced-motion: frame color fade is fine, but the hover/outline still
     appear instantly for users who disable motion. -- */
@media (prefers-reduced-motion: reduce) {
  .rel-avatar__ring {
    transition: none;
  }
}
</style>
