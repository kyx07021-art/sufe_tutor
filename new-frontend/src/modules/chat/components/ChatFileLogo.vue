<script setup>
import { computed } from 'vue'
import { UiIcon, iconRegistry } from '@/components/ui/index.js'
import { CHAT_COPY } from '@/constants/ui.js'

/**
 * ChatFileLogo - file-type logo adapter (M4-12)
 * -----------------------------------------------------------------
 * - Square file-type logo for the file bubble's left 30% zone.
 * - Known extensions (ppt/doc/pdf/txt/mp3/mp4) render the matching
 *   registry icon (file-<ext>, gray-70); everything else renders a
 *   gray-20 box with a bold gray-10 "?" glyph.
 * - `size` (px) drives the square box and the "?" glyph size (0.55x).
 * - Zero inline HTML style literals / v-html / <style> injection / CJK.
 *   Dynamic sizing goes through the CSS-variable data channel
 *   (Vue :style + scoped vars), the same pattern as UiButton/UiInput.
 */

/** known extension -> registry icon name mapping (single source here) */
const KNOWN_TYPES = ['ppt', 'doc', 'pdf', 'txt', 'mp3', 'mp4']

const props = defineProps({
  /** file extension, e.g. "pdf", ".PDF", "TXT"; empty/unknown -> unknown logo */
  type: { type: String, default: '' },
  /** logo edge length in pixels (square) */
  size: { type: Number, default: 32 },
})

/** normalized extension: trimmed, lowercased, single leading dot stripped */
const ext = computed(() =>
  String(props.type ?? '').trim().toLowerCase().replace(/^\./, ''),
)

const iconName = computed(() => `file-${ext.value}`)

/** known when the extension is mapped AND its icon is actually registered */
const isKnown = computed(
  () => KNOWN_TYPES.includes(ext.value) && Boolean(iconRegistry[iconName.value]),
)

const ariaLabel = computed(() =>
  isKnown.value ? CHAT_COPY.FILE_ICON_ALT : CHAT_COPY.FILE_UNKNOWN_ALT,
)

/** CSS-variable data channel: box size + "?" glyph size (size * 0.55) */
const logoStyle = computed(() => ({
  '--logo-size': `${props.size}px`,
  '--logo-q': `${Math.round(props.size * 0.55)}px`,
}))
</script>

<template>
  <span
    class="chat-file-logo"
    :class="{ 'chat-file-logo--unknown': !isKnown }"
    :style="logoStyle"
    role="img"
    :aria-label="ariaLabel"
  >
    <UiIcon v-if="isKnown" :name="iconName" :size="size" />
    <span v-else class="chat-file-logo__q" aria-hidden="true">?</span>
  </span>
</template>

<style scoped>
.chat-file-logo {
  --logo-size: 32px;
  --logo-q: 18px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  box-sizing: border-box;
  width: var(--logo-size);
  height: var(--logo-size);
  border-radius: var(--radius-sm);
  color: var(--gray-70);
}

.chat-file-logo--unknown {
  background: var(--gray-20);
  color: var(--gray-10);
}

.chat-file-logo__q {
  font-size: var(--logo-q);
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
</style>
