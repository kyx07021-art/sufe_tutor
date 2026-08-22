/**
 * M4-15 ChatSpecialBubble — source-level + SFC parse checks (Node-runnable)
 * ---------------------------------------------------------------------------
 * M4-15 special bubble is a VISUAL SHELL by design (F4: data-cap placeholder,
 * ZERO handlers). Contract / signing content (I-44..46) is CAP this round; the
 * assembly injects the real content into the named slot `content` later.
 *
 * Checks (no browser — reads the .vue source + SFC parse via @vue/compiler-sfc):
 *   1. Root carries data-cap="I-44..46" (F4 audit marker).
 *   2. Template has ZERO handlers: no @click / v-on:click / onclick= / <button>
 *      / <a href>.
 *   3. SPECIAL_CAP_PLACEHOLDER referenced (cap placeholder fallback copy).
 *   4. SFC parse is clean (template content extracted from the descriptor).
 *   5. Contract-6 hardening: no v-html, no inline style attribute in template.
 *
 * Run: node test/chat-special.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

const FILE = fileURLToPath(
  new URL('../src/modules/chat/components/ChatSpecialBubble.vue', import.meta.url),
)
const src = readFileSync(FILE, 'utf8')

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/* --- SFC parse (@vue/compiler-sfc) + extract template --- */
const parsed = parse(src, { filename: 'ChatSpecialBubble.vue' })
ok(
  parsed.errors.length === 0,
  `M4-15: SFC parse clean (${parsed.errors.map((e) => e.message || e).join('; ')})`,
)

let tpl = ''
if (parsed.errors.length === 0 && parsed.descriptor.template) {
  tpl = parsed.descriptor.template.content
}

/* --- 1. data-cap F4 audit marker on the root --- */
ok(/data-cap="I-44\.\.46"/.test(tpl), 'M4-15: root carries data-cap="I-44..46" (F4 audit marker)')

/* --- 2. zero handlers in the template (visual shell) --- */
ok(!/@click\b/.test(tpl), 'M4-15: no @click handler')
ok(!/v-on:click\b/.test(tpl), 'M4-15: no v-on:click handler')
ok(!/\bonclick\s*=/.test(tpl), 'M4-15: no onclick= HTML attr')
ok(!/<\s*button\b/.test(tpl), 'M4-15: no <button> element')
ok(!/<\s*a\s+[^>]*href\s*=/.test(tpl), 'M4-15: no <a href> link')

/* --- 3. cap placeholder copy referenced (single source m-chat.js) --- */
ok(/SPECIAL_CAP_PLACEHOLDER/.test(src), 'M4-15: SPECIAL_CAP_PLACEHOLDER referenced')

/* --- 4/5. contract-6 hardening --- */
ok(!/v-html\b/.test(tpl), 'M4-15: no v-html')
ok(!/(^|\s):?style\s*=/.test(tpl), 'M4-15: no inline style attribute')

if (errors.length) {
  console.log('CHAT SPECIAL FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT SPECIAL PASS')
