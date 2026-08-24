<script setup>
/**
 * ChatInputBar — C2.6 conversation input capsule (M4-17..21)
 * -----------------------------------------------------------------
 * - M4-17 layout: 60px capsule, pill radius, paper fill, gray-50 hairline,
 *   --shadow-input float. The parent input slot pads the 10px bottom gap;
 *   this component renders only the capsule + attachment sheet.
 * - M4-18 send: the IME decision (Enter mid-composition NEVER sends — W43),
 *   modifier newline (Shift/Ctrl/Meta+Enter) and Enter-to-send are owned by the
 *   standard UiInput (sendOnEnter). This layer only trims, guards empty/busy,
 *   refocuses after commit, and handles Escape (clears the draft + closes the
 *   sheet — UiInput does not own Escape).
 * - M4-19 auto-grow: UiInput owns autoResize (CSSOM inline height). The
 *   textarea is clamped here to GROW_MAX_PX (max-height + overflow) so a long
 *   draft scrolls internally instead of growing past the capsule. The send
 *   button stays bottom-aligned (flex-end) as the capsule grows.
 * - M4-20 plus rotation: the leading toggle rotates the `plus` icon 45deg to a
 *   close glyph when the sheet opens (pure CSS class toggle .is-open on the
 *   UiButton, no icon swap). The toggle is a standard UiButton circle B.
 * - M4-21 attachment sheet: slides up under the capsule; two label-for file
 *   inputs (iOS-safe — label activation, never a programmatic file-input
 *   click). Picking an image/file emits attach-image / attach-file; the input
 *   value resets so the same file can be chosen again.
 * - F6 busy: while `sending` is true the send path is a no-op (defensive
 *   in-component guard; the real optimistic busy lock lives in the parent
 *   send module, M4-30).
 *
 * Props:
 *   sending: Boolean  — parent send in-flight; Enter / Send button no-op.
 * Emits:
 *   send(text: string)          — committed message (trimmed).
 *   attach-image(file: File)    — image picked from the attachment sheet.
 *   attach-file(file: File)     — file picked from the attachment sheet.
 */
import { computed, nextTick, ref } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { CHAT_COPY } from '@/constants/ui.js'

const props = defineProps({
  /** Parent send in-flight; while true Enter/Send no-op (F6 defensive guard). */
  sending: { type: Boolean, default: false },
})

const emit = defineEmits(['send', 'attach-image', 'attach-file'])

const draft = ref('')
const sheetOpen = ref(false)
const inputRef = ref(null)

/** Auto-grow clamp (max input height, ~3-4 lines). Single source in this component. */
const GROW_MAX_PX = 120

const canSend = computed(() => draft.value.trim().length > 0 && !props.sending)

/**
 * Commit a draft (trimmed): emit + clear + refocus. No-op when busy or empty.
 * Both the Enter path (UiInput @send) and the Send-button path call this, so
 * the trim / empty / busy guard is a single point (F6).
 * @param {string} text raw draft value from UiInput
 */
function commitSend(text) {
  if (props.sending) return
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  emit('send', trimmed)
  draft.value = ''
  // Re-measure + refocus on next tick so the draft reset lands before focus.
  nextTick(() => inputRef.value && inputRef.value.focus())
}

/** UiInput Enter-send handler (M4-18). UiInput owns the IME guard (W43) + the
 *  modifier-newline decision; this layer only applies the trim/empty/busy gate. */
function onUiSend(text) {
  commitSend(text)
}

/** Escape clears the draft and closes the sheet (wrapper-level keydown;
 *  UiInput owns Enter only, Escape is not part of its contract). */
function onWrapKeydown(e) {
  if (e.key === 'Escape') {
    draft.value = ''
    sheetOpen.value = false
  }
}

function onSendClick() {
  if (!canSend.value) return
  commitSend(draft.value)
}

function toggleSheet() {
  sheetOpen.value = !sheetOpen.value
}

function onImagePick(e) {
  const file = e.target.files && e.target.files[0]
  if (file) emit('attach-image', file)
  e.target.value = '' // allow re-picking the same file
}

function onFilePick(e) {
  const file = e.target.files && e.target.files[0]
  if (file) emit('attach-file', file)
  e.target.value = '' // allow re-picking the same file
}

defineExpose({
  focus: () => inputRef.value && inputRef.value.focus(),
})
</script>

<template>
  <div class="chat-input" :class="{ 'is-sheet-open': sheetOpen }">
    <div class="chat-input__capsule">
      <UiButton
        variant="B"
        circle
        size="sm"
        class="chat-input__toggle"
        :class="{ 'is-open': sheetOpen }"
        :aria-label="CHAT_COPY.ATTACH_TOGGLE_ARIA"
        :aria-expanded="sheetOpen"
        aria-controls="chat-input-sheet"
        @click="toggleSheet"
      >
        <UiIcon name="plus" class="chat-input__toggle-icon" :size="22" />
      </UiButton>

      <UiInput
        ref="inputRef"
        v-model="draft"
        class="chat-input__field"
        :placeholder="CHAT_COPY.INPUT_PLACEHOLDER"
        :aria-label="CHAT_COPY.INPUT_PLACEHOLDER"
        fill="bare"
        send-on-enter
        @send="onUiSend"
        @keydown="onWrapKeydown"
      />

      <UiButton
        variant="B"
        circle
        size="sm"
        class="chat-input__send"
        :disabled="!canSend"
        :aria-label="CHAT_COPY.SEND_BTN_ARIA"
        @click="onSendClick"
      >
        <UiIcon name="paper-plane" :size="22" />
      </UiButton>
    </div>

    <div
      id="chat-input-sheet"
      class="chat-input__sheet"
      :class="{ 'is-open': sheetOpen }"
      role="group"
      :aria-label="CHAT_COPY.ATTACH_SHEET_TITLE"
    >
      <p class="chat-input__sheet-title">{{ CHAT_COPY.ATTACH_SHEET_TITLE }}</p>
      <div class="chat-input__sheet-actions">
        <label class="chat-input__attach" for="chat-input-img">
          <span>{{ CHAT_COPY.ATTACH_IMAGE }}</span>
        </label>
        <input
          id="chat-input-img"
          class="chat-input__file"
          type="file"
          accept="image/*"
          @change="onImagePick"
        />
        <label class="chat-input__attach" for="chat-input-file">
          <span>{{ CHAT_COPY.ATTACH_FILE }}</span>
        </label>
        <input
          id="chat-input-file"
          class="chat-input__file"
          type="file"
          @change="onFilePick"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* -- component tokens (single source for this capsule) -- */
.chat-input {
  --capsule-h: 60px;
  --icon-btn: 40px;
  --attach-min-w: 96px;

  position: relative;
  width: 100%;
}

/* -- M4-17 capsule: 60px, pill radius, paper fill, gray-50 hairline, float -- */
.chat-input__capsule {
  display: flex;
  align-items: flex-end; /* send + toggle stay bottom-aligned as the capsule grows (M4-19) */
  gap: var(--space-2);
  box-sizing: border-box;
  min-height: var(--capsule-h);
  padding: var(--space-2);
  border: var(--border-w) solid var(--gray-50);
  border-radius: var(--radius-pill);
  background: var(--paper);
  box-shadow: var(--shadow-input);
  transition: box-shadow var(--dur-sm) var(--ease-out);
}
.chat-input__capsule:focus-within {
  box-shadow: 0 0 0 2px var(--brand), var(--shadow-input);
}

/* -- M4-20 leading toggle: a standard UiButton circle B. The plus icon rotates
     45deg to a close glyph when open (hover/focus ripple is UiButton's). -- */
.chat-input__toggle :deep(.chat-input__toggle-icon) {
  transition: transform var(--dur-base) var(--ease-out);
}
.chat-input__toggle.is-open :deep(.chat-input__toggle-icon) {
  transform: rotate(45deg);
}

/* -- input field: fill the capsule. UiInput owns the textarea visuals; this
     scope only clamps auto-growth to GROW_MAX_PX so a long draft scrolls
     internally instead of pushing the capsule past the page (M4-19). -- */
.chat-input__field {
  flex: 1;
  min-width: 0;
  --input-w: 100%;
}
.chat-input .chat-input__field :deep(.ui-input__ta) {
  max-height: 120px;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* -- M4-18 send button: a standard UiButton circle B. Disabled (empty /
     sending) state is UiButton's is-disabled (grayed). -- */

/* -- M4-21 attachment sheet: slides up under the capsule (class toggled) -- */
.chat-input__sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + var(--space-2));
  box-sizing: border-box;
  padding: var(--space-4);
  background: var(--paper-raised);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float-sm);
  opacity: 0;
  visibility: hidden;
  transform: translateY(var(--space-2));
  pointer-events: none;
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out),
    visibility 0s linear var(--dur-base);
  z-index: 5;
}
.chat-input__sheet.is-open {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  pointer-events: auto;
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.chat-input__sheet-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-sm);
  color: var(--gray-50);
  line-height: 1.2;
}

.chat-input__sheet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* -- attach buttons are <label for> (iOS-safe file activation) -- */
.chat-input__attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--attach-min-w);
  padding: 10px var(--space-5);
  border: var(--border-w) solid var(--gray-50);
  border-radius: var(--radius-pill);
  background: var(--paper);
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: 1.2;
  cursor: pointer;
  user-select: none;
  transition: background var(--dur-sm) var(--ease-out);
}
.chat-input__attach:hover { background: var(--gray-10); }
.chat-input__attach:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }

/* visually-hidden file input (sr-only clip; label-for activates it, no display:none quirk) */
.chat-input__file {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .chat-input__capsule,
  .chat-input__toggle :deep(.chat-input__toggle-icon),
  .chat-input__sheet,
  .chat-input__sheet.is-open,
  .chat-input__attach { transition: none; }
}
</style>
