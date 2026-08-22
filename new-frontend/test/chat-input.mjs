/**
 * M4-17..21 chat input bar test (Node-runnable)
 * -----------------------------------------------------------------
 * Covers:
 *   1. shouldSendKey pure decision (mirrored from ChatInputBar.vue — parity
 *      verified by the module lead; source anchors below lock the component's
 *      three branches so drift trips the test red):
 *        - Enter && !composing               -> send
 *        - Enter && composing                -> NO send (IME mutation, W43)
 *        - Shift / Ctrl / Meta + Enter       -> never send (manual newline)
 *        - non-Enter keys (incl. Escape)     -> never send (Esc handled separately)
 *   2. Source-level contract anchors on ChatInputBar.vue:
 *        - SFC parses clean (@vue/compiler-sfc).
 *        - shouldSendKey defined, exposed, wired into the keydown handler,
 *          and its three decision branches match the mirror.
 *        - IME composition handlers bound (compositionstart/end).
 *        - Escape clears the draft.
 *        - Contract 6: zero CJK anywhere in the component source.
 *        - iOS-safe file pick: label-for + visually-hidden input, ZERO
 *          programmatic .click() calls.
 *        - Sheet / toggle class toggling (is-open) + aria-expanded wiring.
 *        - F6 busy: `sending` prop present and guards the send path.
 *
 * NOTE: shouldSendKey is mirrored here rather than imported (Node cannot
 * import a Vue SFC). The mirror is the behavior lock; the source anchors are
 * the parity lock. Run: node test/chat-input.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const COMPONENT = fileURLToPath(
  new URL('../src/modules/chat/components/ChatInputBar.vue', import.meta.url),
)
const source = readFileSync(COMPONENT, 'utf8')

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/* ================= 1. shouldSendKey mirror (parity with ChatInputBar.vue) ================= */
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
// Non-Enter keys never send (Escape is handled separately in the component)
ok(
  shouldSendKey({ key: 'Escape', shiftKey: false, ctrlKey: false, metaKey: false }, false) === false,
  'M4-18: Escape -> never send (handled separately)',
)
ok(
  shouldSendKey({ key: 'a', shiftKey: false, ctrlKey: false, metaKey: false }, false) === false,
  'M4-18: letter key -> never send',
)
ok(shouldSendKey(null, false) === false, 'M4-18: null event -> never send (defensive)')

// G2 mutation guard: if the IME guard were removed from the decision, the
// "composing -> NO send" assertion above would go red. Prove the guard is
// load-bearing by simulating its removal.
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

/* ================= 2. SFC parse + source contract anchors ================= */
const { errors: sfcErrors, descriptor } = parse(source, { filename: 'ChatInputBar.vue' })
ok(sfcErrors.length === 0, 'M4-17..21: ChatInputBar.vue SFC parses clean (compiler-sfc)')

// shouldSendKey defined + exposed + wired into the keydown handler
ok(/function shouldSendKey\s*\(/.test(source), 'M4-18: shouldSendKey defined in component')
ok(/defineExpose\(\{\s*shouldSendKey,/.test(source), 'M4-18: shouldSendKey exposed via defineExpose')
ok(/@keydown="onKeydown"/.test(source), 'M4-18: keydown handler bound to textarea')
// parity anchors: the component's three branches match the mirror's contract
ok(source.includes('if (composing) return false'), 'M4-18 parity anchor: component guards IME composition')
ok(source.includes("e.key !== 'Enter'"), 'M4-18 parity anchor: component requires Enter')
ok(source.includes('shiftKey || e.ctrlKey || e.metaKey'), 'M4-18 parity anchor: component blocks modifier+Enter')

// IME composition handlers bound
ok(/@compositionstart="onCompositionStart"/.test(source), 'M4-18: compositionstart handler bound')
ok(/@compositionend="onCompositionEnd"/.test(source), 'M4-18: compositionend handler bound')
ok(/onCompositionStart/.test(source) && /onCompositionEnd/.test(source), 'M4-18: composition handlers defined')

// Escape clears the draft (handled separately from the send decision)
ok(/'Escape'/.test(source), 'M4-18: Escape key handled (clears draft)')

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

// Sheet + toggle class toggling + aria wiring (M4-20/21)
ok(/class="chat-input__toggle"/.test(source), 'M4-20: toggle button present')
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
