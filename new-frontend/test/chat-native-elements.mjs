/**
 * chat-native-elements.mjs — business-module native-interactive-element migration guard
 * -------------------------------------------------------------------------------------
 * ADR 0004 §1 (single implementation + variant props) + contract 6: business
 * modules must not hand-write raw HTML interactive elements — they consume the
 * standard component library (UiButton / UiInput / UiCheckButton / ...).
 *
 * This guard walks every .vue file under the audited modules (chat / shell /
 * notifications) and asserts zero native interactive elements, with an explicit
 * boundary allowlist:
 *   - ChatListPane.vue    — compound conversation card (avatar + name + preview +
 *                           time + unread dot). No standard card-button exists;
 *                           marked boundary-acceptable (not an icon/action button).
 *   - ChatImageBubble.vue — image-thumbnail zoom target: a specialized interactive
 *                           element (click-to-open-viewer), not an action button;
 *                           marked boundary-acceptable.
 *   - <input type="file"> — label-for file pickers are legitimate native inputs
 *                           (iOS-safe activation, never programmatic .click()).
 *
 * It also locks the single-source NavTab contract: the shared left-nav tab
 * component (src/components/ui/NavTab.vue) must wrap the core UiButton — the
 * "one button core" rule (coordinator discipline) forbids a second native-button
 * implementation inside the library itself.
 *
 * G2 mutation note: reverting any migrated element (e.g. ChatInputBar's send
 * back to a native <button>, or replacing a NavTab item with a native <button>)
 * makes the matching assertion go red — the guard is load-bearing, not vacuous.
 *
 * Run: node test/chat-native-elements.mjs   (also runs under npm test's chat-* glob)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('../src', import.meta.url))

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

// Component docs legitimately mention `<button>` / `<textarea>` in prose, so strip
// comments before the structural scan (Chinese source scan is unaffected — done
// by smoke-chat-shell.mjs / archtest contract 6).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** files under a module dir (recursive) */
function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectFiles(full, out)
    else if (st.isFile() && name.endsWith('.vue')) out.push(full)
  }
  return out
}

const NATIVE_INTERACTIVE_BOUNDARY = new Set(['ChatListPane.vue', 'ChatImageBubble.vue'])

// Audited modules: chat (original scope) + shell + notifications (ADR 0004 §1
// native-element migration batch). Each module is scanned identically.
const MODULES = ['chat', 'shell', 'notifications']

for (const mod of MODULES) {
  for (const file of collectFiles(join(SRC, 'modules', mod))) {
    const base = file.split(/[\\/]/).pop()
    const src = readFileSync(file, 'utf8')
    const body = stripComments(src)
    const label = file.slice(file.indexOf('modules'))
    if (NATIVE_INTERACTIVE_BOUNDARY.has(base)) continue
    ok(!/<button[\s>]/.test(body), `zero native <button> in ${label} (migrate to UiButton)`)
    ok(!/<textarea[\s>]/.test(body), `zero native <textarea> in ${label} (migrate to UiInput)`)
    ok(!/<input(?![^>]*type=["']file["'])[\s>]/.test(body), `zero native non-file <input> in ${label} (migrate to standard component)`)
  }
}

// Sanity: the boundary allowlist files still exist (avoids silent drift of the allowlist).
for (const b of NATIVE_INTERACTIVE_BOUNDARY) {
  ok(collectFiles(join(SRC, 'modules', 'chat')).some((f) => f.split(/[\\/]/).pop() === b), `boundary file ${b} still present (allowlist live)`)
}

// NavTab single-source contract: the shared left-nav tab must wrap UiButton, not
// hand-roll a second native-button implementation inside the core library.
const navTabSrc = readFileSync(join(SRC, 'components', 'ui', 'NavTab.vue'), 'utf8')
const navTabBody = stripComments(navTabSrc)
ok(/<UiButton[\s>]/.test(navTabBody), 'NavTab.vue must wrap the core UiButton (one button core, no second implementation)')
ok(!/<button[\s>]/.test(navTabBody), 'NavTab.vue must not contain a native <button> element')

// G2 mutation note: prove the guard has teeth — restore a native <button> in the
// ChatInputBar body and the native-button assertion must trip.
const inputSrc = readFileSync(join(SRC, 'modules', 'chat', 'components', 'ChatInputBar.vue'), 'utf8')
const mutated = inputSrc.replace('<UiButton', '<button') // first occurrence only
ok(/<button[\s>]/.test(stripComments(mutated)), 'G2 mutation note: reverting to native <button> WOULD trip the guard')

if (errors.length) {
  console.log('CHAT NATIVE ELEMENTS TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT NATIVE ELEMENTS TEST PASS')
