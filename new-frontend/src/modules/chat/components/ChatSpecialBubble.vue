<script setup>
/**
 * ChatSpecialBubble — C2 special-content bubble: breathing frame + content slot (M4-15)
 * -------------------------------------------------------------------------------------
 * - VISUAL SHELL by design (F4: data-cap placeholder, ZERO handlers). Contract /
 *   signing content (I-44..46) is CAP this round; the assembly will inject the real
 *   content into the named slot `content` once those endpoints land.
 * - Visually distinct from normal text bubbles: a centered system card (max-width 70%)
 *   whose border + soft shadow breathe on a ~3s cycle (CSS @keyframes), signalling
 *   "special content". Animation is disabled under prefers-reduced-motion.
 * - Copy: CHAT_COPY.SPECIAL_CAP_PLACEHOLDER renders as the slot fallback this round
 *   (single source in src/constants/m-chat.js via @/constants/ui.js).
 * - Contract 6: zero CJK in template/scoped CSS/comments, zero inline event/style
 *   attrs, zero v-html, zero <style> injection. JS only defines props; animation is
 *   CSS-only (no class toggling needed — the frame breathes on its own).
 */
import { CHAT_COPY } from '@/constants/ui.js'

defineProps({
  /** I-18 message row (kind 'contract' this round); surfaced as data-kind for the F4 audit */
  message: { type: Object, default: null },
})
</script>

<template>
  <div
    class="chat-special"
    data-cap="I-44..46"
    :data-kind="message?.kind || null"
  >
    <slot name="content">{{ CHAT_COPY.SPECIAL_CAP_PLACEHOLDER }}</slot>
  </div>
</template>

<style scoped>
/* Breathing frame: resting border = soft brand, peak = bright brand; a gentle
   border-color + box-shadow pulse on a ~3s cycle (special-content signal). */
.chat-special {
  max-width: 70%;
  margin: var(--space-3) auto; /* centered system card (not peer-aligned) */
  box-sizing: border-box;
  padding: var(--space-4) var(--space-5);
  border: var(--border-w-thick) solid var(--brand-soft);
  border-radius: var(--radius-md);
  background: var(--paper-raised);
  color: var(--gray-75); /* informational display text */
  font-size: var(--fs-sm);
  line-height: var(--lh-body);
  text-align: center;
  overflow-wrap: break-word;
  animation: chat-special-breathe 3s var(--ease-soft) infinite;
}

@keyframes chat-special-breathe {
  0%,
  100% {
    border-color: var(--brand-soft);
    box-shadow: var(--shadow-input);
  }
  50% {
    border-color: var(--brand-bright);
    box-shadow: var(--shadow-float-sm);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-special {
    animation: none;
  }
}
</style>
