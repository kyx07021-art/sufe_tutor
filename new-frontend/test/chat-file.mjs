/**
 * M4-11 ChatFileBubble - Node-runnable source-level + pure-logic checks
 * ---------------------------------------------------------------------------
 * No browser needed: reads the .vue source, SFC-parses it (@vue/compiler-sfc)
 * and runs pure assertions:
 *   1. M4-13 filename truncation (real import of fileName.js): keeps the
 *      extension, stays within maxChars, degenerate fallback keeps the name
 *      unchanged.
 *   2. The extension extraction the logo uses ("report.FINAL.PDF" -> "pdf").
 *      The rule is mirrored here AND coupled to the real component via a
 *      source-contract lock: the same behavior markers (.trim / .toLowerCase /
 *      .lastIndexOf('.')) must exist in ChatFileBubble.vue's `extFromName`, so
 *      any mutation that drops one of them goes red (G2-style).
 *   3. The 30/70 geometry (plan C2.1 L414-419): grid 30% / 70% + max-width 70%
 *      + fixed width + unified line frame are locked in the scoped style.
 *   4. SFC parse is clean + contract-6 hardening (no v-html / inline style /
 *      inline handlers) + FILE_BUBBLE_ALT single source referenced.
 *
 * Run: node test/chat-file.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { truncateFileName } from '../src/modules/chat/logic/fileName.js'

const FILE = fileURLToPath(
  new URL('../src/modules/chat/components/ChatFileBubble.vue', import.meta.url),
)
const src = readFileSync(FILE, 'utf8')

const errors = []
const ok = (cond, msg) => {
  if (!cond) errors.push(msg)
}

/* --- SFC parse + extract script / template / styles --- */
const parsed = parse(src, { filename: 'ChatFileBubble.vue' })
ok(
  parsed.errors.length === 0,
  `M4-11: SFC parse clean (${parsed.errors.map((e) => e.message || e).join('; ')})`,
)

const script = parsed.descriptor.scriptSetup
  ? parsed.descriptor.scriptSetup.content
  : parsed.descriptor.script
    ? parsed.descriptor.script.content
    : ''
const tpl = parsed.descriptor.template ? parsed.descriptor.template.content : ''
const styles = parsed.descriptor.styles.map((s) => s.content).join('\n')

/* --- 1. M4-13 filename truncation (real imported logic) --- */
ok(
  truncateFileName('verylongdocumentname.pdf', 12).length <= 12,
  'M4-11: truncated name stays <= maxChars',
)
ok(
  truncateFileName('verylongdocumentname.pdf', 12).endsWith('.pdf'),
  'M4-11: truncated name keeps the extension',
)
ok(truncateFileName('abc.pdf', 20) === 'abc.pdf', 'M4-11: short name unchanged')
ok(truncateFileName('a.pdf', 3) === 'a.pdf', 'M4-11: degenerate fallback keeps name unchanged')

/* --- 2. logo extension extraction ("report.FINAL.PDF" -> "pdf") ---
   Mirror of ChatFileBubble.vue `extFromName`. The source-contract lock below
   keeps this mirror honest: it must match the helper the component actually
   uses, otherwise a mutation in the component goes undetected (G2). */
function extFromName(name) {
  const s = String(name ?? '').trim().toLowerCase()
  const i = s.lastIndexOf('.')
  return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : ''
}
ok(extFromName('report.FINAL.PDF') === 'pdf', 'M4-11: "report.FINAL.PDF" -> "pdf"')
ok(extFromName('report.final.pdf') === 'pdf', 'M4-11: lowercased multi-dot ext -> "pdf"')
ok(extFromName('noext') === '', 'M4-11: no dot -> empty ext')
ok(extFromName('report.') === '', 'M4-11: trailing dot -> empty ext')
ok(extFromName(null) === '', 'M4-11: null name -> empty ext')

/* source-contract lock: the real component helper must carry the same rule */
ok(/const extFromName = \(name\) => \{/.test(script), 'M4-11: ChatFileBubble.vue declares extFromName')
ok(/\.trim\(\)/.test(script), 'M4-11: component helper trims (contract lock)')
ok(/\.toLowerCase\(\)/.test(script), 'M4-11: component helper lowercases (contract lock)')
ok(/\.lastIndexOf\('\.'\)/.test(script), 'M4-11: component helper splits on last dot (contract lock)')
ok(/\.slice\(/.test(script), 'M4-11: component helper slices the extension (contract lock)')

/* --- 3. 30/70 geometry (plan C2.1 L414-419) locked in the scoped style --- */
ok(
  /grid-template-columns:\s*30%\s+70%/.test(styles),
  'M4-11: left 30% / right 70% grid geometry present',
)
ok(/max-width:\s*70%/.test(styles), 'M4-11: card max-width 70% of the message area')
ok(/\bwidth:\s*260px/.test(styles), 'M4-11: fixed card width (plan: fixed-width rounded rect)')
ok(
  /\bborder:\s*var\(--border-w\)\s+solid\s+var\(--line\)/.test(styles),
  'M4-11: line frame uses unified border token',
)

/* --- 4. contract-6 hardening + copy single source --- */
ok(!/v-html\b/.test(tpl), 'M4-11: no v-html')
ok(!/(^|\s):?style\s*=/.test(tpl), 'M4-11: no inline style attribute in template')
ok(!/@click\b/.test(tpl) && !/\bonclick\s*=/.test(tpl), 'M4-11: zero inline event handlers in template')
ok(/FILE_BUBBLE_ALT/.test(src), 'M4-11: FILE_BUBBLE_ALT referenced (CHAT_COPY single source)')
ok(/ChatFileLogo/.test(src), 'M4-11: file-type logo (M4-12) consumed')

if (errors.length) {
  console.log('CHAT FILE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT FILE PASS')
