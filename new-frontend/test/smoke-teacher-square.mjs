/**
 * M7 A1 teacher-square smoke (node pure-function + Playwright browser + contract-6 scan)
 * -------------------------------------------------------------------------------------
 * 1. Pure (node asserts): M7-03 sort (mid price / both-null last / mutation),
 *    M7-12 match group (hit-count accumulation + grouping, mutation),
 *    M7-01 I-29 mapping + query builder + fetch stub.
 * 2. Browser (harness-teacher-square.html, Vite dev server self-started unless BASE):
 *    list mapping render, sort tab interaction (mutex selected gray-10), SortBar
 *    geometry, empty/error states, 375 no overflow, zero console/pageerror/CSP.
 * 3. Contract-6 static scan of module source (zero CJK outside copy/data fixture,
 *    zero inline event/style literals, zero <style> injection, zero v-html).
 *
 * Run: node test/smoke-teacher-square.mjs
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { sortTeachers, midPrice, makeTeacherSorter } from '../src/modules/teacher-square/sort.js'
import { matchGroup, computeMatchCount } from '../src/components/shared/useMatchGroup.js'
import { TEACHER_MATCH_DIMENSIONS } from '../src/modules/teacher-square/match-dimensions.js'
import {
  mapTeacherResponse,
  buildTeachersQuery,
  fetchTeachers,
} from '../src/modules/teacher-square/teachers-api.js'
import { MOCK_TEACHER_ITEMS } from '../src/modules/teacher-square/mock-data.js'
import { SUBJECTS, PERSONALITY_TAGS, subjectLabel, tagLabel } from '../src/modules/my-demands/region.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MOD = join(ROOT, 'src', 'modules', 'teacher-square')
const CONSTS = join(ROOT, 'src', 'constants', 'm-teacher-square.js')
const errors = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => errors.push(m)

/* ============================ 1. pure functions ============================ */

function mk(overrides) {
  return {
    teacherId: 1, name: 'A', rating: 4.5, reviewCount: 10,
    priceMin: 100, priceMax: 200, subjects: [], bio: '', region: '',
    experienceYears: 5, matchScore: 80, matchCount: 2, teachingMethod: '',
    timeSlots: [], personalityTags: [], gender: 'male',
    verified: true, chsiVerified: true, ...overrides,
  }
}

// ---- M7-03: mid price + both-null last ----
assert.equal(midPrice({ priceMin: 100, priceMax: 300 }), 200)
assert.equal(midPrice({ priceMin: null, priceMax: 240 }), 240)
assert.equal(midPrice({ priceMin: 200, priceMax: null }), 200)
assert.equal(midPrice({ priceMin: null, priceMax: null }), null)

const A = mk({ name: 'A', priceMin: 100, priceMax: 300 })  // mid 200
const B = mk({ name: 'B', priceMin: 150, priceMax: 160 })  // mid 155
const C = mk({ name: 'C', priceMin: null, priceMax: null }) // null -> last
const D = mk({ name: 'D', priceMin: 200, priceMax: null })  // mid 200 (single side)
const E = mk({ name: 'E', priceMin: null, priceMax: 240 })  // mid 240 (single side)

// Mutation: if midPrice is dropped for raw min, A(min 100) sorts before B(min 150) -> red.
const priceAsc = sortTeachers([A, B, C, D, E], { key: 'price', order: 'asc' })
assert.deepEqual(priceAsc.map((x) => x.name), ['B', 'A', 'D', 'E', 'C'])
// both-null last regardless of order
assert.deepEqual(sortTeachers([A, B, C], { key: 'price', order: 'desc' }).map((x) => x.name), ['A', 'B', 'C'])
ok('sort: mid price (single/double sided) + both-null last (mutation-guarded)')

// ---- M7-12: hit-count accumulation + grouping (mutation targets) ----
// PA-2-F4: fixtures use BACKEND English ids (subjects/personalityTags) — the
// production shape the filter cards now emit (G3).
const X = mk({ name: 'X', subjects: [{ subject: 'math' }], gender: 'male', personalityTags: ['patience'], rating: 2.0 })
const Y = mk({ name: 'Y', subjects: [{ subject: 'english' }], gender: 'female', personalityTags: ['strict'], rating: 5.0 })
const Z = mk({ name: 'Z', subjects: [{ subject: 'physics' }], gender: 'female', personalityTags: [], rating: 4.0, priceMin: 1000, priceMax: 2000 })
const filters = { subjects: ['math'], gender: 'male', personalities: ['patience'], priceMin: 50, priceMax: 400 }

assert.equal(computeMatchCount(X, filters, TEACHER_MATCH_DIMENSIONS), 4) // subjects+gender+personality+price
assert.equal(computeMatchCount(Y, filters, TEACHER_MATCH_DIMENSIONS), 1) // price only
assert.equal(computeMatchCount(Z, filters, TEACHER_MATCH_DIMENSIONS), 0) // nothing hit -> dropped

// Grouping: X (4 hits, rating 2.0) must precede Y (1 hit, rating 5.0) despite Y's
// higher rating. Delete grouping -> sort by rating desc -> [Y, X] (red).
// Delete hit-count accumulation -> all counts equal -> sort by rating desc -> [Y, X] (red).
const groups = matchGroup([X, Y, Z], filters, TEACHER_MATCH_DIMENSIONS, makeTeacherSorter('rating', 'desc'))
assert.deepEqual(groups.map((g) => g.count), [4, 1])
assert.deepEqual(groups.flatMap((g) => g.items).map((i) => i.name), ['X', 'Y'])

// no active filter -> single null-count group sorted by base preference
const none = matchGroup([Y, X], {}, TEACHER_MATCH_DIMENSIONS, makeTeacherSorter('rating', 'desc'))
assert.equal(none.length, 1)
assert.equal(none[0].count, null)
assert.deepEqual(none[0].items.map((i) => i.name), ['Y', 'X'])
ok('match-group: hit-count accumulation + grouping reorder (mutation-guarded)')

// ---- M7-01: I-29 mapping + query builder + fetch stub ----
const raw = {
  teacherId: 42, name: '王老师', rating: 4.8, reviewCount: 23, priceMin: 150, priceMax: 250,
  subjects: [{ subject: 'math' }], bio: 'hi', region: '上海', experienceYears: 7,
  matchScore: 91, matchCount: 3,
}
const mapped = mapTeacherResponse(raw)
assert.equal(mapped.teacherId, 42)
assert.equal(mapped.name, '王老师')
assert.equal(mapped.experienceYears, 7)
assert.equal(mapped.matchScore, 91)
assert.equal(mapped.matchCount, 3)

const q = buildTeachersQuery({
  sort: 'price', order: 'asc',
  filters: { subjects: ['math', 'english'], gender: 'male', personalities: ['patience'], priceMin: 100, priceMax: 300 },
})
assert.ok(q.includes('sort=price'))
assert.ok(q.includes('subjects=' + encodeURIComponent('math,english')))

// ---- PA-2-F4: filter values are BACKEND English ids, labels Chinese ----
// The option pools the filter cards now render (region.js SUBJECTS /
// PERSONALITY_TAGS) must serialize English ids into the I-29 query and hit
// English-id teacher rows in the local match engine (previously Chinese labels
// reached both -> any selection returned zero cards).
assert.ok(SUBJECTS.some((s) => s.value === 'math'), 'region SUBJECTS must carry backend English id math')
assert.ok(PERSONALITY_TAGS.some((t) => t.value === 'patience'), 'region PERSONALITY_TAGS must carry backend English id patience')
assert.equal(subjectLabel('math'), '数学')
assert.equal(tagLabel('patience'), '耐心')
const qF4 = buildTeachersQuery({ filters: { subjects: [SUBJECTS[1].value], personalities: [PERSONALITY_TAGS[0].value] } })
assert.ok(qF4.includes('subjects=math') || qF4.includes('subjects=' + SUBJECTS[1].value), 'subject filter must serialize English id')
assert.ok(qF4.includes('personalities=' + PERSONALITY_TAGS[0].value), 'personality filter must serialize English id')
const hitMath = computeMatchCount(mk({ subjects: [{ subject: 'math' }] }), { subjects: ['math'] }, TEACHER_MATCH_DIMENSIONS)
assert.ok(hitMath > 0, 'local match must hit a math teacher with the English id')
ok('PA-2-F4: subject/personality option pools emit backend English ids (labels Chinese)')

const fr = await fetchTeachers({ fetcher: async () => ({ items: [raw], total: 1 }) })
assert.equal(fr.ok, true)
assert.equal(fr.items.length, 1)
assert.equal(fr.items[0].matchScore, 91)
const frBad = await fetchTeachers({ fetcher: async () => { throw new Error('boom') } })
assert.equal(frBad.ok, false)
const frMalformed = await fetchTeachers({ fetcher: async () => null })
assert.equal(frMalformed.ok, false)
ok('I-29 mapping (matchScore/matchCount/experienceYears) + query builder + fetch stub')

/* ============================ 2. browser render ============================ */

async function browserChecks(base) {
  console.log('— browser render @ ' + base + ' —')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const consoleErrs = []
    page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()))
    page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message))
    const cdp = await page.context().newCDPSession(page)
    const csp = []
    await cdp.send('Log.enable')
    cdp.on('Log.entryAdded', ({ entry }) => /Content Security Policy/i.test(entry.text) && csp.push(entry.text))

    const GOOD = JSON.stringify({ items: MOCK_TEACHER_ITEMS, total: MOCK_TEACHER_ITEMS.length })
    await page.route('**/api/teachers*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: GOOD }))
    await page.route('**/api/reviews*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reviews: [{ id: 1, rating: 5, comment: '非常认真负责，孩子成绩提升明显。', status: 'approved', reviewerName: '小明', created_at: '2026-08-01' }],
          mine: null,
        }),
      }))
    await page.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await page.goto(base + '/test/harness-teacher-square.html', { waitUntil: 'networkidle' })

    // ---- list render (M7-01 mapping -> CardGrid/TeacherCard) ----
    const cards = page.locator('.card-grid .teacher-card')
    await cards.first().waitFor({ timeout: 8000 })
    const cardCount = await cards.count()
    if (cardCount !== 6) fail('expected 6 teacher cards, got ' + cardCount)
    else ok('card grid rendered: 6 cards')

    const firstName = await cards.first().locator('.teacher-card__name').textContent()
    if (firstName !== '李老师') fail('match desc first card should be 李老师, got ' + firstName)
    else ok('match desc default order -> 李老师 first')

    // sort tab interaction (M7-04): click 评分 -> rating desc -> 孙老师 (5.0)
    await page.locator('.sort-bar__tab', { hasText: '评分' }).click()
    await page.waitForTimeout(300)
    const afterRating = await cards.first().locator('.teacher-card__name').textContent()
    if (afterRating !== '孙老师') fail('rating desc first card should be 孙老师, got ' + afterRating)
    else ok('sort tab click re-sorts by rating desc -> 孙老师 first')

    // mutex + gray-10 (10度灰 = --gray-10 #e6e6e6)
    const activeTabs = await page.locator('.sort-bar__tab.is-active').count()
    if (activeTabs !== 1) fail('expected exactly 1 active sort tab, got ' + activeTabs)
    else ok('sort tab mutex: exactly 1 active')
    const activeBg = await page.locator('.sort-bar__tab.is-active').evaluate((el) => getComputedStyle(el).backgroundColor)
    if (activeBg !== 'rgb(230, 230, 230)') fail('active tab bg should be gray-10 rgb(230,230,230), got ' + activeBg)
    else ok('active sort tab gray-10 fill')

    // SortBar geometry: order toggle circular + left of tabs; filter inside viewport
    const orderBox = await page.locator('.order-toggle').boundingBox()
    const firstTabBox = await page.locator('.sort-bar__tab').first().boundingBox()
    const filterBox = await page.locator('.second-bar__filter').boundingBox()
    if (!orderBox || !filterBox) fail('order toggle / filter button missing')
    if (orderBox && firstTabBox && orderBox.x >= firstTabBox.x) fail('order button should be left of tabs')
    if (orderBox && Math.abs(orderBox.width - orderBox.height) > 1) fail('order toggle should be circular')
    if (filterBox && filterBox.x + filterBox.width > 1440) fail('filter button overflows 1440 viewport')
    if (orderBox && firstTabBox && filterBox) ok('SortBar geometry: circle left of tabs, filter in-viewport')

    // ---- filter pipeline (M7-06..11 -> M7-12/13 immediate apply) ----
    await page.locator('.second-bar__filter').click()
    await page.waitForTimeout(400)
    const thirdBar = await page.locator('.tsq__third-bar').count()
    if (thirdBar !== 1) fail('filter button did not open the third top bar')
    else ok('filter button opens the third top bar (FilterReveal + ThirdBar)')

    // ---- AK-C2-F5 (#7 field title single source): four filter card titles
    // unify on .ui-title-sm (8px air, weight 700, ink) ----
    const titleCs = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('.tsq__third-bar .ui-title-sm')]
      return titles.map((el) => {
        const cs = getComputedStyle(el)
        return { marginTop: cs.marginTop, weight: cs.fontWeight, color: cs.color }
      })
    })
    if (titleCs.length < 4) fail('AK-C2-F5: four filter card titles must carry .ui-title-sm, got ' + titleCs.length)
    else {
      const bad = titleCs.filter((t) => t.marginTop !== '8px' || t.weight !== '700' || t.color !== 'rgb(26, 26, 26)')
      if (bad.length) fail('AK-C2-F5: filter titles must unify on ui-title-sm (8px/700/ink), got ' + JSON.stringify(titleCs))
      else ok('AK-C2-F5: four filter card titles unified on .ui-title-sm')
    }

    // ---- AK-N-㉛: four filter triggers share one silhouette (44 / radius-md / --line / fs-sm) ----
    const triggerGeo = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.filter-trigger__btn')]
      return els.map((el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return {
          height: r.height,
          radius: cs.borderTopLeftRadius,
          border: cs.borderTopWidth + ' ' + cs.borderTopColor,
          font: cs.fontSize,
        }
      })
    })
    // 4 dropdown triggers (subject/gender/personality) + price input pair share 44/12/1px gray-50/14
    const dropdowns = triggerGeo.slice(0, 3)
    const badGeo = triggerGeo.filter(
      (g) => Math.abs(g.height - 44) > 1 || g.radius !== '12px' || g.border !== '1px rgb(128, 128, 128)' || g.font !== '14px',
    )
    if (dropdowns.length !== 3) fail('AK-N-㉛: expected 3 dropdown filter triggers, got ' + dropdowns.length)
    else if (badGeo.length) fail('AK-N-㉛: trigger silhouette not unified (44/12px/1px gray-50/14px), got ' + JSON.stringify(triggerGeo))
    else ok('AK-N-㉛: 3 dropdown triggers unified on 44px / radius-md / 1px gray-50 / fs-sm')
    // price inputs: same outer height + radius + border as the dropdown triggers
    // (.price-filter__input is the UiInput root element — class passthrough onto .ui-input)
    const priceGeo = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.price-filter__input')]
      return els.map((el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return { height: r.height, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor }
      })
    })
    if (priceGeo.length !== 2) fail('AK-N-㉛: expected 2 price inputs, got ' + priceGeo.length)
    else {
      const badPrice = priceGeo.filter((g) => Math.abs(g.height - 44) > 1 || g.radius !== '12px' || g.border !== '1px rgb(128, 128, 128)')
      if (badPrice.length) fail('AK-N-㉛: price inputs must match trigger silhouette (44/12px/1px gray-50), got ' + JSON.stringify(priceGeo))
      else ok('AK-N-㉛: price input pair matches the trigger silhouette (44 / radius-md / --line)')
    }

    // ---- PA-2-F4: subject filter emits backend English id, matches English-id rows ----
    await page.locator('.filter-trigger__btn[aria-label="擅长科目"]').click()
    await page.waitForTimeout(300)
    await page.locator('.ui-droppanel[aria-label="擅长科目"] .ui-checkbtn', { hasText: '数学' }).click()
    await page.waitForTimeout(400)
    const mathCards = await page.locator('.card-grid .teacher-card').count()
    if (mathCards !== 2) fail('subject=数学 should keep 2 math teachers (李/赵), got ' + mathCards)
    else ok('subject filter emits English id + local match hits math teachers')
    const subjTrigger = await page.locator('.filter-trigger__btn[aria-label="擅长科目"]').textContent()
    if (!subjTrigger.includes('数学')) fail('subject trigger should show Chinese label 数学, got ' + subjTrigger)
    else ok('subject trigger shows Chinese label (subjectLabel)')
    const cardSubjName = await page.locator('.card-grid .teacher-card__subject-name').first().textContent()
    if (cardSubjName !== '数学') fail('teacher card subject should render Chinese label 数学, got ' + cardSubjName)
    else ok('PA-2-F9: teacher card subject row renders Chinese label (not English id)')
    // clear the subject selection (deselect) -> back to all 6
    await page.locator('.ui-droppanel[aria-label="擅长科目"] .ui-checkbtn', { hasText: '数学' }).click()
    await page.waitForTimeout(400)
    const clearedCount = await page.locator('.card-grid .teacher-card').count()
    if (clearedCount !== 6) fail('deselect subject should restore 6 cards, got ' + clearedCount)
    else ok('subject filter deselect restores full list')

    await page.locator('.filter-trigger__btn[aria-label="教师性别"]').click()
    await page.waitForTimeout(300)
    await page.locator('.ui-droppanel[aria-label="教师性别"] .ui-checkbtn', { hasText: '女' }).click()
    await page.waitForTimeout(300)
    const femaleCount = await page.locator('.card-grid .teacher-card').count()
    if (femaleCount !== 3) fail('gender=女 should keep 3 female teachers, got ' + femaleCount)
    else ok('gender filter immediate-applies (dropZeroHit -> 3 female cards)')
    const genderTrigger = await page.locator('.filter-trigger__btn[aria-label="教师性别"]').textContent()
    if (!genderTrigger.includes('女')) fail('gender trigger should show 女, got ' + genderTrigger)
    else ok('gender trigger reflects the selection')

    // ---- detail modal (M7-18..22) ----
    await cards.first().click()
    await page.waitForTimeout(500)
    const modalCols = await page.locator('.teacher-detail-modal__col').count()
    if (modalCols !== 3) fail('detail modal should render 3 columns, got ' + modalCols)
    else ok('detail modal renders 3 columns')
    const leftColText = await page.locator('.teacher-detail-modal__col').first().textContent()
    if (!leftColText.includes('ID')) fail('detail left column should show teacher id')
    const midColText = await page.locator('.teacher-detail-modal__col').nth(1).textContent()
    if (!midColText.includes('非常认真负责')) fail('featured review not rendered in middle column')
    else ok('detail middle column renders the featured review')
    const sendBtn = page.locator('.dr__send .ui-btn')
    if (await sendBtn.count() !== 1) fail('send-message button missing')
    else ok('send-message button present (student gate)')

    // send-message -> I-23 POST /api/conversations/temp + modal closes
    let tempCalled = false
    await page.route('**/api/conversations/temp', (route) => {
      tempCalled = true
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversationId: 77, status: 'temp', tempStatus: 'init' }) })
    })
    // after send, navigateToConversation mounts ChatPage which marks the opened
    // conversation read via POST /api/conversations/:id/read (G3: mock the real
    // backend endpoint, else the browser logs a 404 and the smoke red-flags it)
    await page.route('**/api/conversations/*/read', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
    await sendBtn.click()
    await page.waitForTimeout(600)
    if (!tempCalled) fail('send-message should POST /api/conversations/temp')
    else ok('send-message POSTs I-23 temp conversation')
    const modalAfterSend = await page.locator('.teacher-detail-modal').count()
    if (modalAfterSend !== 0) fail('detail modal should close after send')
    else ok('detail modal closes after send')

    if (consoleErrs.length) fail('console/pageerror: ' + consoleErrs.join(' | '))
    else ok('zero console/pageerror')
    if (csp.length) fail('CSP violations: ' + csp.join(' | '))
    else ok('zero CSP violations')

    // empty state
    const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const emptyErrs = []
    emptyPage.on('console', (m) => m.type() === 'error' && emptyErrs.push(m.text()))
    emptyPage.on('pageerror', (e) => emptyErrs.push('pageerror: ' + e.message))
    await emptyPage.route('**/api/teachers*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) }))
    await emptyPage.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await emptyPage.goto(base + '/test/harness-teacher-square.html', { waitUntil: 'networkidle' })
    const emptyState = await emptyPage.locator('.tsq__status[data-state="empty"]').count()
    if (emptyState !== 1) fail('empty state missing')
    else ok('empty state renders')
    if (emptyErrs.length) fail('empty page console: ' + emptyErrs.join(' | '))
    await emptyPage.close()

    // error state via 200 + malformed JSON (api() returns null -> error state, no console error)
    const errPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errErrs = []
    errPage.on('console', (m) => m.type() === 'error' && errErrs.push(m.text()))
    errPage.on('pageerror', (e) => errErrs.push('pageerror: ' + e.message))
    await errPage.route('**/api/teachers*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }))
    await errPage.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await errPage.goto(base + '/test/harness-teacher-square.html', { waitUntil: 'networkidle' })
    const errState = await errPage.locator('.tsq__status[data-state="error"]').count()
    if (errState !== 1) fail('error state missing')
    const retry = await errPage.locator('.tsq__retry').count()
    if (retry !== 1) fail('retry button missing')
    else ok('error state + retry button render')
    if (errErrs.length) fail('error page console: ' + errErrs.join(' | '))
    await errPage.close()

    // mobile 375 geometry (G5 dual-viewport)
    const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
    const mobileErrs = []
    mobile.on('console', (m) => m.type() === 'error' && mobileErrs.push(m.text()))
    mobile.on('pageerror', (e) => mobileErrs.push('pageerror: ' + e.message))
    await mobile.route('**/api/teachers*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: GOOD }))
    await mobile.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await mobile.goto(base + '/test/harness-teacher-square.html', { waitUntil: 'networkidle' })
    await mobile.locator('.card-grid .teacher-card').first().waitFor({ timeout: 8000 })
    const mobileCards = await mobile.locator('.card-grid .teacher-card').count()
    if (mobileCards !== 6) fail('mobile expected 6 cards, got ' + mobileCards)
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (overflow) fail('mobile 375 horizontal overflow')
    else ok('mobile 375 no page overflow')
    if (mobileErrs.length) fail('mobile console: ' + mobileErrs.join(' | '))
    else ok('mobile zero console')
    await mobile.close()

    await page.screenshot({ path: 'test/smoke-teacher-square.png', fullPage: true })
    await page.close()
  } finally {
    await browser.close()
  }
}

/* ============================ 3. contract-6 static scan ============================ */

function contractChecks() {
  console.log('— contract 6 static scan —')
  const targets = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(js|vue)$/.test(name)) targets.push(p)
    }
  }
  walk(MOD)

  const cjk = /[一-鿿]/
  const inlineEvent = /\b(?:onclick|onload|onchange|onmouseover|onerror)\s*=/
  const styleAttr = /(?<!:)style\s*=\s*["']/
  // usage-only scans: "zero v-html" / "createElement('style')" in compliance
  // comments must not be false-positives.
  const styleInjection = /document\.createElement\(\s*['"]style['"]\s*\)/
  const vhtml = /\bv-html\s*=/

  let bad = 0
  for (const file of targets) {
    const base = file.split(/[\\/]/).pop()
    const src = readFileSync(file, 'utf8')
    // mock-data.js is a data fixture (teacher names/bios) - not UI copy; allowed.
    if (file !== CONSTS && base !== 'mock-data.js' && cjk.test(src)) { fail('CJK in ' + file); bad++ }
    if (inlineEvent.test(src)) { fail('inline event attr in ' + file); bad++ }
    if (styleAttr.test(src)) { fail('literal style= attr in ' + file); bad++ }
    if (styleInjection.test(src)) { fail('<style> injection in ' + file); bad++ }
    if (vhtml.test(src)) { fail('v-html in ' + file); bad++ }
  }
  if (bad === 0) ok('module source clean: zero CJK (outside copy/mock data), zero inline event/style literals, zero <style> injection, zero v-html')
  else fail('contract 6 violations: ' + bad)
}

/* ============================ main ============================ */

let server = null
let base = process.env.BASE
if (!base) {
  server = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}

try {
  console.log('— pure checks —')
  await browserChecks(base)
  contractChecks()
} finally {
  if (server) await server.close()
}

if (errors.length) {
  console.log('TEACHER-SQUARE SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('TEACHER-SQUARE SMOKE PASS')
}
