/**
 * M4-24 end-session confirm modal - source contract test (node-runnable)
 * -----------------------------------------------------------------
 * - No dev server needed: reads ChatEndConfirmModal.vue source and asserts the
 *   M4-24 contract (G2 - mutation-guarded where noted).
 * - Run: node test/chat-endmodal.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parse } from '@vue/compiler-sfc'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.join(here, '..', 'src', 'modules', 'chat', 'components', 'ChatEndConfirmModal.vue')
const src = readFileSync(srcPath, 'utf8')

const failures = []
function check(name, ok) {
  if (ok) console.log('  ok - ' + name)
  else failures.push(name)
}

// ---- 1. SFC parses cleanly ----
const { errors } = parse(src, { filename: 'ChatEndConfirmModal.vue' })
check('SFC parses cleanly (@vue/compiler-sfc)', errors.length === 0)
check('has <script setup>', /<script setup>/.test(src))
check('has <template>', /<template>/.test(src))
check('exactly one <style> block (SFC scoped, no runtime injection)', (src.match(/<style[\s>]/g) || []).length === 1)

// ---- 2. emits contract: confirm + cancel only ----
check("defineEmits declares 'confirm'", /defineEmits\(\s*\[[^\]]*'confirm'/.test(src))
check("defineEmits declares 'cancel'", /defineEmits\(\s*\[[^\]]*'cancel'/.test(src))

// ---- 3. confirm button emits 'confirm' ----
check('confirm button click bound to onConfirm', /@click="onConfirm"/.test(src))
check('onConfirm emits confirm', /emit\('confirm'\)/.test(src))
check('confirm button is danger-filled', /fill="danger"/.test(src))
check('confirm button copy uses END_OK / END_BUSY', /CHAT_COPY\.END_OK/.test(src) && /CHAT_COPY\.END_BUSY/.test(src))

// ---- 4. cancel emits 'cancel' ----
check('cancel button click bound to onCancel', /@click="onCancel"/.test(src))
check('onCancel emits cancel', /emit\('cancel'\)/.test(src))
check('cancel button copy uses UI_COPY.ALERT_CANCEL', /UI_COPY\.ALERT_CANCEL/.test(src))

// ---- 5. F6: busy disables both buttons (G2: if removed, double-confirm fires) ----
const busyDisables = (src.match(/:disabled="busy"/g) || []).length
check('both buttons bind :disabled="busy" (F6 busy lock)', busyDisables >= 2)
check('onConfirm has a busy re-entry guard', /function onConfirm\(\)\s*\{[\s\S]*?props\.busy[\s\S]*?}/.test(src))

// ---- 6. close-on-outside / close-on-esc false while busy ----
check('UiModal close-on-outside bound to !busy', /:close-on-outside="!busy"/.test(src))
check('UiModal close-on-esc bound to !busy', /:close-on-esc="!busy"/.test(src))

// ---- 7. re-auth hint references the module copy key (module lead adds it to m-chat.js) ----
check('re-auth hint references CHAT_COPY.END_REAUTH_HINT', /CHAT_COPY\.END_REAUTH_HINT/.test(src))

// ---- 8. contract 6: zero Chinese / v-html / inline event + style attrs ----
check('zero Chinese in the component (contract 6)', !/[一-鿿]/.test(src))
check('zero v-html', !/v-html/.test(src))
check('zero inline HTML event attributes', !/\s(?:on[a-z]+)=/.test(src))
check('zero inline HTML style attributes', !/\sstyle\s*=/.test(src))

console.log('')
if (failures.length) {
  console.log('CHAT END MODAL TEST FAIL (' + failures.length + ')')
  failures.forEach((f) => console.log(' - ' + f))
  process.exit(1)
} else {
  console.log('CHAT END MODAL TEST PASS')
}
