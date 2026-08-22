<script setup>
/**
 * ChatInputBar — C2.6 conversation input capsule (M4-17..21)
 * -----------------------------------------------------------------
 * - M4-17 layout: 60px capsule, pill radius, paper fill, gray-50 hairline,
 *   --shadow-input float. The parent input slot pads the 10px bottom gap;
 *   this component renders only the capsule + attachment sheet.
 * - M4-18 send: Enter (no modifier, not composing) commits the trimmed draft;
 *   IME composition is tracked (compositionstart/end) so Enter NEVER sends
 *   mid-composition (candidate insertion only — W43 IME mutation). Shift /
 *   Ctrl / Meta + Enter insert a newline (never send). Escape clears the draft
 *   and closes the sheet if open. The decision is the pure `shouldSendKey`
 *   helper (exposed via defineExpose; mirrored in test/chat-input.mjs).
 * - M4-19 auto-grow: the textarea grows with content up to GROW_MAX_PX then
 *   scrolls internally; height/overflow go through the CSSOM data channel
 *   (--ta-h / --ta-scroll custom properties via setProperty — CSP contract 8
 *   style-src-attr 'none' does NOT govern CSSOM setProperty). The send button
 *   stays bottom-aligned (flex-end) as the capsule grows.
 * - M4-20 plus rotation: the leading toggle rotates the `plus` icon 45deg to a
 *   close glyph when the sheet opens (pure CSS class toggle .is-open, no icon
 *   swap — a rotated plus reads as an ×; plus.svg and close.svg share the same
 *   stroke geometry so the affordance is consistent).
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
import { computed, nextTick, onMounted, ref } from 'vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import { CHAT_COPY } from '@/constants/ui.js'

const props = defineProps({
  /** Parent send in-flight; while true Enter/Send no-op (F6 defensive guard). */
  sending: { type: Boolean, default: false },
})

const emit = defineEmits(['send', 'attach-image', 'attach-file'])

const draft = ref('')
const composing = ref(false)
const sheetOpen = ref(false)
const taRef = ref(null)

/** Auto-grow clamp (max input height, ~3-4 lines). Single source in this component. */
const GROW_MAX_PX = 120

/**
 * Pure send decision (single source). A keydown SHOULD send iff:
 *   - not inside an IME composition (Enter mid-composition inserts the
 *     candidate, never sends — W43), AND
 *   - key is Enter, AND
 *   - no modifier (Shift/Ctrl/Meta+Enter are manual newline).
 * Everything else (Escape, letters, arrows) returns false; Escape is handled
 * separately by the component (clears draft). Exposed via defineExpose and
 * mirrored in test/chat-input.mjs (module lead verifies parity).
 * @param {{ key: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean }} e event-like object
 * @param {boolean} composing IME composition in progress
 * @returns {boolean}
 */
function shouldSendKey(e, composing) {
  if (composing) return false
  if (!e || e.key !== 'Enter') return false
  if (e.shiftKey || e.ctrlKey || e.metaKey) return false
  return true
}

const canSend = computed(() => draft.value.trim().length > 0 && !props.sending)

/** Grow the textarea via the CSSOM data channel (--ta-h / --ta-scroll). */
function autoGrow() {
  const ta = taRef.value
  if (!ta) return
  ta.style.setProperty('--ta-h', 'auto')
  const h = Math.min(ta.scrollHeight, GROW_MAX_PX)
  ta.style.setProperty('--ta-h', `${h}px`)
  ta.style.setProperty('--ta-scroll', ta.scrollHeight > GROW_MAX_PX ? 'auto' : 'hidden')
}

function onInput(e) {
  draft.value = e.target.value
  autoGrow()
}

function onCompositionStart() {
  composing.value = true
}

function onCompositionEnd() {
  composing.value = false
}

/** Commit the draft (trimmed): emit + clear + shrink + refocus. No-op when busy or empty. */
function commitSend() {
  if (props.sending) return
  const text = draft.value.trim()
  if (!text) return
  emit('send', text)
  draft.value = ''
  // Re-measure on next tick so the textarea value has reset before shrinking.
  nextTick(autoGrow)
  taRef.value?.focus()
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    draft.value = ''
    sheetOpen.value = false
    nextTick(autoGrow)
    return
  }
  if (!shouldSendKey(e, composing.value)) return
  // Enter without modifier, not composing -> never inserts a newline.
  e.preventDefault()
  commitSend()
}

function onSendClick() {
  if (!canSend.value) return
  commitSend()
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

onMounted(autoGrow)

defineExpose({
  shouldSendKey,
  focus: () => taRef.value && taRef.value.focus(),
})
</script>

<template>
  <div class="chat-input" :class="{ 'is-sheet-open': sheetOpen }">
    <div class="chat-input__capsule">
      <button
        type="button"
        class="chat-input__toggle"
        :class="{ 'is-open': sheetOpen }"
        :aria-label="CHAT_COPY.ATTACH_TOGGLE_ARIA"
        :aria-expanded="sheetOpen"
        aria-controls="chat-input-sheet"
        @click="toggleSheet"
      >
        <UiIcon name="plus" class="chat-input__toggle-icon" :size="22" />
      </button>

      <textarea
        ref="taRef"
        class="chat-input__ta"
        rows="1"
        :value="draft"
        :placeholder="CHAT_COPY.INPUT_PLACEHOLDER"
        :aria-label="CHAT_COPY.INPUT_PLACEHOLDER"
        @input="onInput"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      ></textarea>

      <button
        type="button"
        class="chat-input__send"
        :disabled="!canSend"
        :aria-label="CHAT_COPY.SEND_BTN_ARIA"
        @click="onSendClick"
      >
        <UiIcon name="paper-plane" class="chat-input__send-icon" :size="22" />
      </button>
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

/* -- M4-20 leading toggle: plus rotates 45deg to a close glyph when open -- */
.chat-input__toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--icon-btn);
  height: var(--icon-btn);
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-sm) var(--ease-out);
}
.chat-input__toggle:hover { background: var(--gray-10); }
.chat-input__toggle:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }

.chat-input__toggle-icon {
  display: block;
  transition: transform var(--dur-base) var(--ease-out);
}
.chat-input__toggle.is-open .chat-input__toggle-icon { transform: rotate(45deg); }

/* -- M4-19 auto-grow textarea (height/overflow via CSSOM data channel) -- */
.chat-input__ta {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  min-height: var(--input-h);
  height: var(--ta-h, var(--input-h));
  padding: var(--input-pad-y) 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: var(--fs-base);
  line-height: var(--input-lh);
  resize: none;
  overflow-y: var(--ta-scroll, hidden);
  scrollbar-width: thin;
}
.chat-input__ta::placeholder { color: var(--gray-30); }

/* -- M4-18 send button (bottom-aligned via flex-end, disabled when empty/sending) -- */
.chat-input__send {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--icon-btn);
  height: var(--icon-btn);
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--gray-90);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background var(--dur-sm) var(--ease-out),
    color var(--dur-sm) var(--ease-out);
}
.chat-input__send:hover:not(:disabled) { background: var(--gray-10); }
.chat-input__send:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--brand); }
.chat-input__send:disabled {
  color: var(--gray-50);
  cursor: default;
  background: transparent;
}

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
  .chat-input__toggle,
  .chat-input__toggle-icon,
  .chat-input__send,
  .chat-input__sheet,
  .chat-input__sheet.is-open,
  .chat-input__attach { transition: none; }
}
</style>
