/**
 * divider-token.test.mjs - divider token single-source lock (AK-N-㉘)
 * ---------------------------------------------------------------------
 * User directive (2026-08-24 ㉘): "all divider lines become 20-degree gray"
 * (revised from 30-degree before sleep — "too gray"). tokens.css gains
 * --divider: var(--gray-20); every CONTENT divider (section separator / row
 * separator / panel separator / decorative underline) consumes var(--divider);
 * CONTROL borders (input frames, triggers, overlay panel boundaries, card
 * strokes) stay var(--line) = gray-50.
 *
 * Mutation guard: revert any divider below to var(--line) (gray-50) -> its
 * assertion turns red. Re-flipping a control border to var(--divider) -> its
 * assertion turns red.
 *
 * Run: node --test test/divider-token.test.mjs  (from new-frontend/)
 *      node --test new-frontend/test/divider-token.test.mjs  (from repo root)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function readSource(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

test('tokens.css defines --divider as 20-degree gray, distinct from control-border --line', () => {
  const tokens = readSource('styles/tokens.css')
  assert.match(tokens, /--divider:\s*var\(--gray-20\)/, 'tokens.css defines --divider = var(--gray-20)')
  assert.match(tokens, /--line:\s*var\(--gray-50\)/, 'tokens.css keeps --line = var(--gray-50)')
  const lineIdx = tokens.indexOf('--line:')
  const dividerIdx = tokens.indexOf('--divider:')
  assert.ok(dividerIdx > lineIdx, '--divider declared after --line in the Borders block')
})

test('content dividers consume var(--divider); reverting to var(--line) turns red', () => {
  const cases = [
    ['components/preview/PreviewPage.vue', /\.pv__h\s*\{[^}]*border-bottom:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'preview section header underline'],
    ['components/ui/UiInput.vue', /height:\s*1px;\s*background:\s*var\(--divider\)/, 'input focus underline (AK-A5)'],
    ['modules/teacher-square/DetailMiddle.vue', /\.dm-divider\s*\{[^}]*border-top:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'teacher detail middle divider'],
    ['modules/teacher-square/DetailLeft.vue', /\.detail-left__divider\s*\{[^}]*border-top:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'teacher detail left divider'],
    ['modules/teacher-square/DetailRight.vue', /\.dr__divider\s*\{[^}]*border-top:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'teacher detail right divider'],
    ['modules/auth/AuthPreview.vue', /\.auth-preview__h\s*\{[^}]*border-bottom:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'auth preview section underline'],
    ['modules/teacher-square/TeacherDetailModal.vue', /\.teacher-detail-modal__col\s*\+\s*\.teacher-detail-modal__col\s*\{\s*border-left:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'teacher modal desktop column divider'],
    ['modules/notifications/SettingsPanel.vue', /\.st-divider\s*\{[^}]*background:\s*var\(--divider\)/, 'settings two-column center divider'],
    ['modules/notifications/FeedbackModal.vue', /\.fb-divider\s*\{[^}]*background:\s*var\(--divider\)/, 'feedback two-column center divider'],
    ['views/landing/LandingFooter.vue', /border-top:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'landing footer top line'],
    ['modules/notifications/NotificationsModal.vue', /\.nt-divider\s*\{[^}]*background:\s*var\(--divider\)/, 'notifications inset list divider'],
    ['modules/chat/ChatPage.vue', /border-right:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'chat list/conversation pane divider'],
    ['modules/chat/components/ChatHintText.vue', /\.chat-hint::before,\s*\.chat-hint::after\s*\{[^}]*border-top:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'chat hint side lines'],
    ['modules/chat/components/ChatListPane.vue', /\.chat-card\s*\{[^}]*border-bottom:\s*var\(--border-w\)\s+solid\s+var\(--divider\)/, 'chat conversation card row divider'],
  ]
  for (const [rel, re, label] of cases) {
    const src = readSource(rel)
    assert.match(src, re, `${rel}: ${label} uses var(--divider)`)
    // mutation demonstration: flip the first divider occurrence back to var(--line); the guard must catch it
    const reverted = src.replace('var(--divider)', 'var(--line)')
    assert.ok(!re.test(reverted), `${rel}: ${label} mutation back to var(--line) is caught`)
  }
  // teacher modal mobile stacking divider (second var(--divider) in the same file)
  const modal = readSource('modules/teacher-square/TeacherDetailModal.vue')
  assert.equal(
    (modal.match(/var\(--divider\)/g) || []).length,
    2,
    'teacher modal has exactly two dividers (desktop border-left + mobile border-top)',
  )
  assert.ok(!/var\(--line\)/.test(modal), 'teacher modal contains no control border (all lines are dividers)')
})

test('control borders stay var(--line) = gray-50; flipping to var(--divider) turns red', () => {
  const cases = [
    ['components/ui/UiCard.vue', /\.ui-card\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'card stroke'],
    ['components/ui/UiCheckbox.vue', /\.ui-checkbox__box\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'checkbox box frame'],
    ['components/ui/UiDropdownPanel.vue', /\.ui-droppanel--b\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'dropdown panel boundary'],
    ['components/ui/UiToast.vue', /\.ui-toast\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'toast pill boundary'],
    ['modules/chat/components/ChatFileBubble.vue', /\.chat-file-bubble\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'file bubble card stroke'],
    ['modules/chat/components/ChatTopBar.vue', /\.chat-more-panel\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'chat more dropdown boundary'],
    ['modules/teacher-side/B2/ProfileEditCard.vue', /\.profile-edit__card\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'profile edit card stroke'],
    ['components/preview/PreviewPage.vue', /\.pv__icon-cell\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'preview icon cell frame'],
  ]
  for (const [rel, re, label] of cases) {
    const src = readSource(rel)
    assert.match(src, re, `${rel}: ${label} keeps var(--line)`)
    // mutation demonstration: flip that control border to var(--divider); the guard must catch it
    const flipped = src.replace(re, (m) => m.replace('var(--line)', 'var(--divider)'))
    assert.ok(!re.test(flipped), `${rel}: ${label} mutation to var(--divider) is caught`)
  }
  // the shared filter trigger (AK-N-㉛) has BOTH a button frame and a panel boundary
  // (>= 2 var(--line) control borders); the three filter cards consume it unchanged.
  // Guarded by existsSync: FilterTrigger.vue lands in a sibling AK-N-㉛ commit, so this
  // lock is dormant at the divider commit and activates once the shared component is in.
  const triggerRel = 'components/shared/FilterTrigger.vue'
  const triggerPath = join(ROOT, triggerRel)
  if (existsSync(triggerPath)) {
    const trigger = readFileSync(triggerPath, 'utf8')
    assert.match(trigger, /\.filter-trigger__btn\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'filter trigger button keeps control border')
    assert.match(trigger, /\.filter-trigger__panel\s*\{[^}]*border:\s*var\(--border-w\)\s+solid\s+var\(--line\)/, 'filter trigger panel keeps control border')
    assert.ok((trigger.match(/var\(--line\)/g) || []).length >= 2, 'filter trigger keeps >= 2 var(--line) control borders')
  }
})
