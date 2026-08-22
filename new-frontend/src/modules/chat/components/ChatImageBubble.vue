<script setup>
import { computed, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import Close from '@/assets/svg/close.svg'
import { CHAT_COPY } from '@/constants/ui.js'
import { formatBubbleTime } from '../logic/timeFormat.js'

/**
 * ChatImageBubble - image message bubble + large-image viewer (M4-10)
 * ---------------------------------------------------------------------
 * - Renders the message thumbnail (I-18 row, kind='image'): source is
 *   `message.thumb` (thumbnail data URL/URL) falling back to `message.body`
 *   (full-size URL), rounded crop (`--radius-img`), capped at 70% of the
 *   message area so the image never overflows. Own/peer alignment matches
 *   the text bubble (mine -> right, peer -> left). A small time label
 *   reuses formatBubbleTime (M4-09) when `created_at` is present.
 * - Clicking the thumbnail opens a UiModal large-image viewer showing the
 *   full-size image (`message.body`), capped to the viewport
 *   (max-width: min(80vw, 100%) / max-height: 80vh) and centered. Esc,
 *   close-on-outside and the top-right close button all dismiss it. The
 *   full image is only mounted once the modal opens (lazy).
 * - Compressed upload dimension caps are NOT this component's job (M4-14
 *   upload.js owns them); this component only renders.
 * - Contract 6: zero CJK in template/scoped CSS/comments, zero inline
 *   HTML event/style attributes, zero v-html, zero <style> injection.
 */

const props = defineProps({
  /** I-18 message row: { id, kind:'image', thumb?, body?, created_at } */
  message: { type: Object, required: true },
  /** true when the message was sent by the current user (align right) */
  mine: { type: Boolean, default: false },
})

const viewerOpen = ref(false)

/** thumbnail source: thumb data URL/URL, falling back to the full body */
const thumbSrc = computed(() => props.message.thumb || props.message.body)
/** full-size source for the viewer (body first, thumb as fallback) */
const fullSrc = computed(() => props.message.body || props.message.thumb)
/** small send-time label ('' when created_at is missing/invalid) */
const timeLabel = computed(() => formatBubbleTime(props.message.created_at))

const alt = CHAT_COPY.IMAGE_BUBBLE_ALT
const viewerTitle = CHAT_COPY.IMAGE_VIEWER_TITLE

function closeViewer() {
  viewerOpen.value = false
}
</script>

<template>
  <div class="chat-image" :class="{ 'chat-image--mine': mine }">
    <button
      type="button"
      class="chat-image__btn"
      :aria-label="alt"
      @click="viewerOpen = true"
    >
      <img class="chat-image__thumb" :src="thumbSrc" :alt="alt" />
    </button>
    <span v-if="timeLabel" class="chat-image__time">{{ timeLabel }}</span>

    <UiModal
      :open="viewerOpen"
      :label="viewerTitle"
      width="auto"
      @close="closeViewer"
      @update:open="(v) => (viewerOpen = v)"
    >
      <div class="chat-image__viewer">
        <img v-if="viewerOpen" class="chat-image__full" :src="fullSrc" :alt="alt" />
        <UiButton
          variant="B"
          circle
          size="sm"
          class="chat-image__viewer-close"
          :aria-label="viewerTitle"
          @click="closeViewer"
        >
          <Close :width="16" :height="16" aria-hidden="true" />
        </UiButton>
      </div>
    </UiModal>
  </div>
</template>

<style scoped>
.chat-image {
  display: flex;
  flex-direction: column;
  align-items: flex-start; /* peer: bubble hugs the left edge */
  gap: var(--space-1);
  max-width: 100%;
}

.chat-image--mine {
  align-items: flex-end; /* own: bubble hugs the right edge */
}

.chat-image__btn {
  display: block;
  max-width: 70%; /* never wider than 70% of the message area */
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
  border-radius: var(--radius-img);
}

.chat-image__thumb {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-img);
  vertical-align: bottom;
}

.chat-image__btn:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.chat-image__time {
  font-size: var(--fs-xs);
  line-height: 1;
  color: var(--gray-50);
}

/* -- large-image viewer -- */
.chat-image__viewer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  /* Minimum footprint so the absolutely-positioned close button is always
     inside the panel even for tiny images (the panel is overflow:hidden and
     shrink-to-fit; without a floor the 40px button is clipped and unclickable). */
  min-width: 200px;
  min-height: 120px;
}

.chat-image__full {
  display: block;
  max-width: min(80vw, 100%);
  max-height: 80vh;
  width: auto;
  height: auto;
  border-radius: var(--radius-md);
  background: var(--gray-10);
}

.chat-image__viewer-close {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: 1;
}
</style>
