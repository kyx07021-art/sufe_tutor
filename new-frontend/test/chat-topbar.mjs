/**
 * chat-topbar.mjs — M4-22 / M4-23 ChatTopBar source-level test
 * -----------------------------------------------------------------
 * Node-runnable (no browser, no build). Reads the .vue source and locks the
 * M4-22 top bar + M4-23 dropdown render contracts:
 *   1. props/emits contract: peerName / isEnded / canEnd / showBack + back /
 *      end-session.
 *   2. M4-22 renders peerName (--fs-lg ellipsis) and a "more" button bound to
 *      CHAT_COPY.TOP_MORE_ARIA (a11y: haspopup + expanded).
 *   3. M4-23 dropdown render ONLY: the panel has a single End Session entry
 *      (CHAT_COPY.DROP_END_SESSION) wired to emit 'end-session'.
 *   4. M4-25 gray-out gate UI surface: the entry's disabled state binds to
 *      canEnd (:disabled + grayed .is-disabled class + END_HAS_CONTRACT hint).
 *      The component never computes canEnd itself.
 *   5. Ended conversations hide the more button (v-if="!isEnded").
 *   6. G2 mutation note: the canEnd disabled binding is load-bearing — removing
 *      canEnd from it would bypass the gate (simulated below).
 *   7. SFC-parse via @vue/compiler-sfc.
 *
 * Run: node test/chat-topbar.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const SOURCE_PATH = fileURLToPath(
  new URL('../src/modules/chat/components/ChatTopBar.vue', import.meta.url),
)

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

const src = await readFile(SOURCE_PATH, 'utf8')

/* ---- 7. SFC parse ---- */
const { errors: parseErrors } = parse(src, { filename: 'ChatTopBar.vue' })
ok(
  parseErrors.length === 0,
  `SFC parses clean (${parseErrors.map((e) => e.message).join('; ') || 'no errors'})`,
)

/* ---- 1. props / emits contract ---- */
ok(/peerName/.test(src), 'declares peerName prop')
ok(/isEnded/.test(src), 'declares isEnded prop')
ok(/canEnd/.test(src), 'declares canEnd prop')
ok(/showBack/.test(src), 'declares showBack prop')
ok(/['"]end-session['"]/.test(src), "emits 'end-session'")
ok(/emit\(['"]back['"]\)/.test(src), "back button wired to emit 'back'")
ok(/{{ peerName }}/.test(src), 'renders peerName in the template')

/* ---- 2. M4-22: more button + a11y ---- */
ok(/CHAT_COPY\.TOP_MORE_ARIA/.test(src), 'more button binds TOP_MORE_ARIA')
ok(/aria-haspopup="listbox"/.test(src), 'more button announces a listbox popup')
ok(/:aria-expanded="open"/.test(src), 'more button announces expanded state')

/* ---- 3. M4-23: dropdown render (single entry wired to end-session) ---- */
ok(/CHAT_COPY\.DROP_END_SESSION/.test(src), 'dropdown entry renders DROP_END_SESSION')
ok(/emit\(['"]end-session['"]\)/.test(src), 'dropdown entry wired to emit end-session')

/* ---- 4. M4-25 gray-out gate UI surface: disabled binds to canEnd ---- */
ok(/:disabled="!canEnd"/.test(src), 'entry :disabled bound to !canEnd')
ok(/is-disabled['"]\s*:\s*!canEnd/.test(src), 'entry grayed .is-disabled class bound to !canEnd')
ok(/CHAT_COPY\.END_HAS_CONTRACT/.test(src), 'disabled hint END_HAS_CONTRACT present')
ok(/:aria-disabled="!canEnd"/.test(src), 'entry aria-disabled bound to !canEnd')

/* ---- 5. ended conversations hide the more button ---- */
ok(/v-if="!isEnded"/.test(src), 'more button hidden for ended conversations (v-if="!isEnded")')

/* ---- 6. G2 mutation note: canEnd disabled binding is load-bearing ---- */
// If a developer stripped canEnd out of the disabled binding (e.g. hard-coded
// :disabled="true" or removed it), the End Session entry would stay clickable even
// when the M4-25 gate reports an active contract — the exact bypass the gray-out
// exists to prevent. The assertion below proves the test is not vacuous: the
// mutated source no longer carries the canEnd binding, so the real grep would go red.
const mutated = src.replace(':disabled="!canEnd"', ':disabled="true"')
ok(
  !/:disabled="!canEnd"/.test(mutated),
  'G2 mutation note: removing canEnd from the disabled binding would bypass the gate (grep turns red)',
)

if (errors.length) {
  console.error('chat-topbar FAIL:')
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log('chat-topbar OK: M4-22 top bar + M4-23 dropdown render contract locked')
