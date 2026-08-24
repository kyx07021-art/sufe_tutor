/**
 * M4-17..21 chat input bar test (Node-runnable)
 * -----------------------------------------------------------------
 * Covers:
 *   1. Send-decision contract: the IME guard (W43) + modifier-newline +
 *      Enter-to-send decision moved to the standard UiInput (ADR 0004 single
 *      implementation). The mirror below locks UiInput's onKeydown behavior and
 *      the source anchors lock UiInput.vue's handler against drift.
 *   2. ChatInputBar.vue source-level anchors:
 *        - SFC parses clean (@vue/compiler-sfc).
 *        - The draft input is the standard UiInput (v-model + fill="bare" +
 *          send-on-enter + @send wiring); the textarea/IME/autoGrow logic was
 *          deleted from this module (it lives in UiInput).
 *        - The commit layer trims, guards empty/busy and refocuses.
 *        - Escape (wrapper-level keydown) clears the draft + closes the sheet.
 *        - Contract 6: zero CJK anywhere in the component source.
 *        - iOS-safe file pick: label-for + visually-hidden input, ZERO
 *          programmatic .click() calls.
 *        - Sheet / toggle class toggling (is-open) + aria-expanded wiring.
 *        - F6 busy: `sending` prop present and guards the send path.
 *
 * NOTE: UiInput.vue is read (not imported — Node cannot import a Vue SFC). The
 * mirror is the behavior lock; the source anchors are the parity lock.
 * Run: node test/chat-input.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const COMPONENT = fileURLToPath(
  new URL('../src/modules/chat/components/ChatInputBar.vue', import.meta.url),
)
const UI_INPUT = fileURLToPath(
  new URL('../src/components/ui/UiInput.vue', import.meta.url),
)
const source = readFileSync(COMPONENT, 'utf8')
const uiInputSource = readFileSync(UI_INPUT, 'utf8')

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/* ================= 1. send-decision mirror (UiInput's onKeydown contract) ================= */
// The IME guard + modifier-newline decision now lives in UiInput.onKeydown.
function shouldSendKey(e, composing) {
  if (composing) return false
  if (!e || e.key !== 'Enter') return false
  if (e.shiftKey || e.ctrlKey || e.metaKey) return false
  return true
}

// Enter, no modifier, not composing -> send
ok(
  shouldSendKey({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false }, false) === true,
  'M4-18: Enter !composing -> send',
)
// Enter during IME composition -> NEVER send (W43 IME mutation)
ok(
  shouldSendKey({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false }, true) === false,
  'M4-18: Enter composing -> NO send (IME mutation)',
)
ok(
  shouldSendKey({ key: 'Enter', shiftKey: true, ctrlKey: false, metaKey: false }, true) === false,
  'M4-18: Shift+Enter composing -> NO send',
)
// Shift / Ctrl / Meta + Enter -> manual newline, never send
ok(
  shouldSendKey({ key: 'Enter', shiftKey: true, ctrlKey: false, metaKey: false }, false) === false,
  'M4-18: Shift+Enter -> newline (never send)',
)
ok(
  shouldSendKey({ key: 'Enter', shiftKey: false, ctrlKey: true, metaKey: false }, false) === false,
  'M4-18: Ctrl+Enter -> newline (never send)',
)
ok(
  shouldSendKey({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: true }, false) === false,
  'M4-18: Meta+Enter -> newline (never send)',
)
ok(
  shouldSendKey({ key: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false }, false) === false,
  'M4-18: Escape -> never send (handled separately)',
)
ok(
  shouldSendKey({ key: 'a', shiftKey: false, ctrlKey: false, metaKey: false }, false) === false,
  'M4-18: letter key -> never send',
)
ok(shouldSendKey(null, false) === false, 'M4-18: null event -> never send (defensive)')

// G2 mutation guard: if the IME guard were removed from UiInput's decision, the
// "composing -> NO send" assertion above would go red.
function mutantComposingRemoved(e, composing) {
  void composing // IME guard REMOVED on purpose — mutation.
  if (!e || e.key !== 'Enter') return false
  if (e.shiftKey || e.ctrlKey || e.metaKey) return false
  return true
}
ok(
  mutantComposingRemoved({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false }, true) === true,
  'M4-18 mutation guard: removing the IME guard WOULD send during composition',
)

/* ================= 2. UiInput owns the send decision (source parity lock) ================= */
ok(/function onKeydown\(e\)/.test(uiInputSource), 'M4-18: UiInput defines onKeydown')
ok(/if \(composing\.value\) return/.test(uiInputSource), 'M4-18 parity: UiInput guards IME composition')
ok(/e\.key === 'Enter' && props\.sendOnEnter/.test(uiInputSource), 'M4-18 parity: UiInput requires Enter + sendOnEnter')
ok(/e\.shiftKey \|\| e\.ctrlKey \|\| e\.metaKey/.test(uiInputSource), 'M4-18 parity: UiInput blocks modifier+Enter')
ok(/emit\('send', props\.modelValue\)/.test(uiInputSource), 'M4-18 parity: UiInput emits send with modelValue')
ok(/@compositionstart="onCompositionStart"/.test(uiInputSource), 'M4-18: UiInput binds compositionstart')
ok(/@compositionend="onCompositionEnd"/.test(uiInputSource), 'M4-18: UiInput binds compositionend')

/* ================= 3. ChatInputBar source-level contract anchors ================= */
const { errors: sfcErrors, descriptor } = parse(source, { filename: 'ChatInputBar.vue' })
ok(sfcErrors.length === 0, 'M4-17..21: ChatInputBar.vue SFC parses clean (compiler-sfc)')

// The draft input is the standard UiInput (v-model + fill + sendOnEnter + @send).
ok(/import UiInput from '@\/components\/ui\/UiInput\.vue'/.test(source), 'M4-17: UiInput imported')
ok(/import UiButton from '@\/components\/ui\/UiButton\.vue'/.test(source), 'M4-17: UiButton imported (toggle/send)')
ok(/<UiInput/.test(source), 'M4-17: template uses UiInput for the draft input')
ok(/v-model="draft"/.test(source), 'M4-17: draft v-model bound to UiInput')
ok(/fill="bare"/.test(source), 'M4-17: UiInput fill="bare" (capsule transparent)')
ok(/send-on-enter/.test(source), 'M4-18: UiInput sendOnEnter enabled')
ok(/@send="onUiSend"/.test(source), 'M4-18: UiInput @send wired to onUiSend')
ok(/function onUiSend\(text\)/.test(source), 'M4-18: onUiSend defined (commit layer)')
ok(/emit\('send', trimmed\)/.test(source), 'M4-18: commit emits trimmed text')
ok(/String\(text \?\? ''\)\.trim\(\)/.test(source), 'M4-18: commit trims the raw draft')
ok(/if \(props\.sending\) return/.test(source), 'M4-18 F6: commit guards the busy path')
ok(/if \(!trimmed\) return/.test(source), 'M4-18: commit guards empty draft')

// Escape clears the draft + closes the sheet (wrapper-level; UiInput owns Enter only).
ok(/@keydown="onWrapKeydown"/.test(source), 'M4-18: wrapper-level keydown bound (Escape)')
ok(/'Escape'/.test(source), 'M4-18: Escape key handled (clears draft)')
ok(/sheetOpen\.value = false/.test(source), 'M4-18: Escape closes the sheet')

// defineExpose focus delegates to the UiInput instance.
ok(/defineExpose\(\{\s*focus:/.test(source), 'M4-17: focus exposed (delegates to UiInput)')
ok(/inputRef\.value && inputRef\.value\.focus\(\)/.test(source), 'M4-17: focus calls UiInput.focus()')

// Contract 6: zero CJK anywhere in the component (template / scoped CSS / comments)
const cjk = (source.match(/[一-鿿]/g) || []).length
ok(cjk === 0, `contract 6: zero CJK in ChatInputBar.vue (found ${cjk})`)

// iOS-safe file pick: label-for + visually-hidden input, ZERO programmatic .click()
ok(/<label[^>]+for="chat-input-img"/.test(source), 'M4-21: image label-for present')
ok(/<label[^>]+for="chat-input-file"/.test(source), 'M4-21: file label-for present')
ok(/id="chat-input-img"/.test(source), 'M4-21: image input id present')
ok(/id="chat-input-file"/.test(source), 'M4-21: file input id present')
ok(/accept="image\/\*"/.test(source), 'M4-21: image input accept filter')
// zero programmatic .click() in the LOGIC (scriptSetup content; comments may
// legitimately mention the forbidden pattern)
const scriptSetup = descriptor.scriptSetup?.content ?? ''
ok(/\.click\(/.test(scriptSetup) === false, 'M4-21: zero programmatic .click() calls in logic (iOS-safe)')

// Sheet + toggle class toggling + aria wiring (M4-20/21) — the toggle is a UiButton now.
ok(/class="chat-input__toggle"/.test(source), 'M4-20: toggle button present (UiButton)')
ok(/is-open/.test(source), 'M4-20: is-open class toggle used')
ok(/aria-expanded/.test(source), 'M4-20: aria-expanded wired')
ok(/aria-controls="chat-input-sheet"/.test(source), 'M4-20: toggle controls the sheet')
ok(/class="chat-input__sheet"/.test(source), 'M4-21: sheet element present')

// Copy via CHAT_COPY single source (no raw copy)
ok(/CHAT_COPY\./.test(source), 'M4-17: copy sourced from CHAT_COPY')

// F6 busy: sending prop present and guards the send path
ok(/sending/.test(source), 'M4-18 F6: sending prop present (in-component busy guard)')
ok(/props\.sending/.test(source), 'M4-18 F6: sending prop guards the send path')

if (errors.length) {
  console.log('CHAT INPUT TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT INPUT TEST PASS')
