/**
 * chat-image.mjs - M4-10 image message bubble: pure-logic + SFC integrity checks
 * ------------------------------------------------------------------------------
 * Node-runnable (no Vite/Playwright needed). Covers what is verifiable without a
 * browser and defers rendered geometry to the module-lead smoke:
 *
 *   1. M4-09 formatBubbleTime (reused by the image bubble time label): today ->
 *      local "HH:MM" (zero-padded), yesterday -> copy, invalid -> ''. Locking the
 *      real behavior (G2): reverting the HH:MM branch to a raw `getHours()` join
 *      would make the `09:05` assertion go red.
 *   2. SFC-parse ChatImageBubble.vue (compiler-sfc) -> structural integrity.
 *   3. Zero-CJK guard on the component source (contract 6: no CJK in template /
 *      scoped CSS / comments). Reverting an English comment to Chinese would fail.
 *
 * GEOMETRY NOTE (verified by module-lead Playwright smoke, G5):
 *   - Thumbnail `max-width: 70%` of the message area (image never overflows).
 *   - Viewer full image viewport-capped: `max-width: min(80vw, 100%)` +
 *     `max-height: 80vh`, centered in the UiModal.
 *   - Own/peer alignment: `.chat-image--mine` -> flex-end (right), else flex-start.
 *
 * Run: node test/chat-image.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { formatBubbleTime } from '../src/modules/chat/logic/timeFormat.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ============ 1. M4-09 formatBubbleTime behavior ============ */
const now = new Date('2026-08-20T10:33:00').getTime()

ok(
  formatBubbleTime(new Date('2026-08-20T09:05:00').getTime(), now) === '09:05',
  'M4-10 time: today 09:05 -> "09:05"',
)
ok(
  formatBubbleTime(new Date('2026-08-20T00:00:00').getTime(), now) === '00:00',
  'M4-10 time: today midnight -> "00:00" (zero-padded)',
)
ok(
  formatBubbleTime(new Date('2026-08-19T23:59:59').getTime(), now) === '昨天',
  'M4-10 time: yesterday -> "昨天"',
)
ok(
  formatBubbleTime(new Date('2026-08-18T12:00:00').getTime(), now) === '8月18日',
  'M4-10 time: earlier same year -> month/day copy',
)
ok(
  formatBubbleTime('not-a-date', now) === '' &&
    formatBubbleTime(undefined, now) === '',
  'M4-10 time: invalid/missing timestamp -> "" (no label rendered)',
)

/* ============ 2. SFC structural integrity ============ */
const componentPath = fileURLToPath(
  new URL('../src/modules/chat/components/ChatImageBubble.vue', import.meta.url),
)
const source = readFileSync(componentPath, 'utf8')
const { descriptor, errors: sfcErrors } = parse(source, {
  filename: 'ChatImageBubble.vue',
})
if (sfcErrors.length) {
  errors.push(`SFC parse errors: ${sfcErrors.map((e) => e.message).join('; ')}`)
} else {
  ok(Boolean(descriptor.template), 'SFC: template block present')
  ok(Boolean(descriptor.scriptSetup), 'SFC: <script setup> present')
  ok(Boolean(descriptor.styles.length), 'SFC: scoped style block present')
}

/* ============ 3. Contract 6: zero CJK anywhere in the component source ============ */
const cjk = /[一-鿿]/
const cjkHits = source.split('\n')
  .map((line, i) => ({ line: i + 1, text: line }))
  .filter((l) => cjk.test(l.text))
if (cjkHits.length) {
  errors.push(
    `contract 6: CJK found in ChatImageBubble.vue at ${cjkHits
      .map((h) => `L${h.line}`)
      .join(', ')}`,
  )
}
ok(!/\bv-html\s*=/.test(source), 'contract 6: no v-html directive')
ok(!/style=/.test(source), 'contract 6: no inline HTML style= literal')

/* ============ 4. Geometry contract note (locked by module-lead smoke) ============ */
console.log(
  'GEOMETRY NOTE (M4-10, verified by module-lead Playwright smoke G5):\n' +
    '  - thumb max-width 70% of message area (never overflows)\n' +
    '  - viewer full image max-width min(80vw,100%) / max-height 80vh, centered\n' +
    '  - .chat-image--mine -> align right; peer -> align left\n',
)

if (errors.length) {
  console.error(`\nchat-image: ${errors.length} FAILURE(S)`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log('chat-image: all checks passed')
