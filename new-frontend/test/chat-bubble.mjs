/**
 * chat-bubble.mjs — M4-08 / M4-09 / M4-31 pure-guard test (Node-runnable, zero browser)
 * -----------------------------------------------------------------------------
 * Coverage:
 *   1. M4-08 brandSoftFilter: returns #rrggbb and stays in the pale brand
 *      family (same hue, lightness raised, saturation lowered).
 *   2. M4-09 formatBubbleTime: today -> "HH:MM"; yesterday -> TIME_YESTERDAY;
 *      invalid timestamp -> empty string.
 *   3. SFC parse of ChatBubble.vue (@vue/compiler-sfc): zero compile errors,
 *      template + <script setup> + one scoped style block present.
 *   4. ChatBubble.vue contract guards (contract 6 + single-source tokens):
 *      - zero CJK characters anywhere in the file;
 *      - zero v-html / inline style / inline event HTML attributes;
 *      - own bubble fill consumes `--brand-soft`, peer fill `--gray-10`;
 *      - geometry `max-width: 70%` present (G5, plan L412);
 *      - M4-31: `animate-in` class + `@keyframes chat-bubble-in` +
 *        `prefers-reduced-motion` guard present;
 *      - M4-09: `formatBubbleTime` wired via the relative logic import.
 *
 * Run: node test/chat-bubble.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { brandSoftFilter, hexToHsl } from '../src/modules/chat/logic/colorFilter.js'
import { formatBubbleTime } from '../src/modules/chat/logic/timeFormat.js'
import { CHAT_COPY } from '../src/constants/m-chat.js'

const BUBBLE_PATH = fileURLToPath(new URL('../src/modules/chat/components/ChatBubble.vue', import.meta.url))

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ============ 1. M4-08 brand purple filter ============ */
const soft = brandSoftFilter('#6c5ce7')
ok(/^#[0-9a-f]{6}$/.test(soft), `M4-08: filter returns #rrggbb (got ${soft})`)

const inHsl = hexToHsl('#6c5ce7')
const outHsl = hexToHsl(soft)
ok(inHsl && outHsl, 'M4-08: input and output both parse to HSL')
ok(Math.abs(outHsl[0] - inHsl[0]) <= 6, `M4-08: same hue kept (in ${inHsl[0].toFixed(1)} -> out ${outHsl[0].toFixed(1)})`)
ok(outHsl[2] > inHsl[2], `M4-08: lightness raised (in ${inHsl[2].toFixed(3)} -> out ${outHsl[2].toFixed(3)})`)
ok(outHsl[1] < inHsl[1], `M4-08: saturation lowered (in ${inHsl[1].toFixed(3)} -> out ${outHsl[1].toFixed(3)})`)
// G2 mutation: an un-paled passthrough would fail the family assertions.
ok(brandSoftFilter('#6c5ce7') !== '#6c5ce7', 'M4-08 mutation guard: filter is load-bearing (not identity)')

/* ============ 2. M4-09 bubble send time ============ */
const now = new Date('2026-08-22T12:00:00').getTime()
ok(
  formatBubbleTime(new Date('2026-08-22T09:05:00').getTime(), now) === '09:05',
  'M4-09: today -> HH:MM',
)
ok(
  formatBubbleTime(new Date('2026-08-21T23:59:00').getTime(), now) === CHAT_COPY.TIME_YESTERDAY,
  'M4-09: yesterday -> TIME_YESTERDAY',
)
ok(
  formatBubbleTime(new Date('2026-08-22T09:05:00').getTime(), now).length === 5,
  'M4-09: HH:MM is exactly 5 chars',
)
ok(formatBubbleTime('not-a-date') === '', 'M4-09: invalid timestamp -> empty label')

/* ============ 3. SFC parse of ChatBubble.vue ============ */
const src = readFileSync(BUBBLE_PATH, 'utf8')
const sfc = await import('@vue/compiler-sfc')
const parsed = sfc.parse(src, { filename: 'ChatBubble.vue' })
ok(parsed.errors.length === 0, 'SFC: zero compile errors')
ok(!!parsed.descriptor.template?.content, 'SFC: template block present')
ok(!!parsed.descriptor.scriptSetup?.content, 'SFC: <script setup> present')
ok(parsed.descriptor.styles.length === 1, 'SFC: one style block present')
ok(parsed.descriptor.styles[0].scoped === true, 'SFC: style block is scoped')

/* ============ 4. ChatBubble.vue contract guards ============ */
const template = parsed.descriptor.template.content
const cjk = /[一-鿿]/
ok(!cjk.test(src), 'contract 6: zero CJK in ChatBubble.vue')
ok(!/v-html/.test(template), 'contract 6: zero v-html in template')
ok(!/<[^>]*\bstyle\s*=/.test(template), 'contract 6: zero inline style attrs')
ok(!/<[^>]*\bon(click|change|load|input|keyup|keydown|focus|blur|submit)\s*=/.test(template), 'contract 6: zero inline event attrs')
ok(!/<style\b[^>]*>\s*<\/style>/.test(src), 'contract 6: no empty <style> (zero style injection pattern)')

// M4-08 single-source tokens + geometry (G5).
ok(src.includes('var(--brand-soft)'), 'M4-08: own bubble fill consumes --brand-soft token')
ok(src.includes('var(--gray-10)'), 'M4-08: peer bubble fill consumes --gray-10 token')
ok(src.includes('max-width: 70%'), 'M4-08: bubble box max-width 70% (G5, plan L412)')
ok(src.includes('var(--radius-md)'), 'M4-08: bubble radius uses the radius token')

// M4-09 wiring.
ok(src.includes("from '../logic/timeFormat.js'"), 'M4-09: formatBubbleTime relative import present')
ok(src.includes('formatBubbleTime(props.message.created_at)'), 'M4-09: formatBubbleTime wired to created_at')
ok(src.includes('CHAT_COPY.BUBBLE_MINE_ALT') && src.includes('CHAT_COPY.BUBBLE_PEER_ALT'), 'M4-08/09: aria labels come from CHAT_COPY')

// M4-31 entrance animation.
ok(src.includes('animate-in'), 'M4-31: animate-in class present')
ok(src.includes('@keyframes chat-bubble-in'), 'M4-31: entrance keyframes present')
ok(src.includes('prefers-reduced-motion'), 'M4-31: reduced-motion guard present')
ok(src.includes('translateY(12px)'), 'M4-31: slide-up offset present')

if (errors.length) {
  console.log('CHAT BUBBLE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT BUBBLE PASS')
