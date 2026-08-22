/**
 * M9 teacher-side smoke test
 * ------------------------------------------------------------------
 * Covers: page registration gate (pure) / I-34 mapping (matchScore + matchCount
 * explicit read, empty + error states) / crop tool pure functions / match-group
 * pure functions / grid geometry (4col desktop, 2col mobile, no overflow) /
 * zero console + zero CSP violations.
 *
 * Run: node test/smoke-teacher-side.mjs  (spins up its own Vite dev server)
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, URL } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const ROOT_URL = new URL('../', import.meta.url)
const ROOT = fileURLToPath(ROOT_URL)
const VITE_CONFIG = fileURLToPath(new URL('./vite.config.js', ROOT_URL))
const BASE_PORT = 5317

/* ================= pure: page registration gate (B1-1a / B2-1a) ================= */
test('page registration meta registers B1/B2/B3 with teacher role gate', async () => {
  const { TEACHER_PAGES_META } = await import(
    '../src/modules/teacher-side/pages-meta.js'
  )
  assert.equal(TEACHER_PAGES_META.length, 3)
  const names = TEACHER_PAGES_META.map((p) => p.name)
  assert.deepEqual(names.sort(), ['B1', 'B2', 'B3'])
  for (const p of TEACHER_PAGES_META) {
    assert.ok(p.path.startsWith('/teacher/'), `path ${p.name}`)
    assert.ok(Array.isArray(p.roles), `roles array ${p.name}`)
    assert.ok(p.roles.includes('teacher'), `teacher gate ${p.name}`)
  }
})

/* ================= pure: I-34 mapping (B1-2a) ================= */
test('I-34 mapping reads matchScore/matchCount explicitly + normalizes missing fields', async () => {
  const { mapDemandItem, mapDemandList } = await import(
    '../src/modules/teacher-side/B1/demands-model.js'
  )
  const item = mapDemandItem({
    id: 7,
    subject: '数学',
    grade: '高二',
    teachingMethod: 'offline',
    currentScore: 80,
    preferredGender: 'male',
    budgetMin: 200,
    budgetMax: 300,
    studentName: '学生甲',
    matchScore: 92,
    matchCount: 3,
  })
  assert.equal(item.matchScore, 92, 'matchScore explicitly read')
  assert.equal(item.matchCount, 3, 'matchCount explicitly read')
  assert.equal(item.subject, '数学')
  assert.equal(item.budgetMin, 200)

  // missing fields -> safe defaults (C3)
  const sparse = mapDemandItem({ id: 1 })
  assert.equal(sparse.matchScore, 0)
  assert.equal(sparse.matchCount, 0)
  assert.equal(sparse.subject, '')
  assert.equal(sparse.budgetMin, null)
  assert.deepEqual(sparse.preferredTags, [])
  assert.equal(sparse.teachingMethod, 'online')
})

test('I-34 mapping: empty list -> [], non-array -> []', async () => {
  const { mapDemandList } = await import(
    '../src/modules/teacher-side/B1/demands-model.js'
  )
  assert.deepEqual(mapDemandList([]), [])
  assert.deepEqual(mapDemandList(null), [])
  assert.deepEqual(mapDemandList(undefined), [])
})

test('price sort uses mid price and puts nulls last', async () => {
  const { compareBySort, midPrice } = await import(
    '../src/modules/teacher-side/B1/demands-model.js'
  )
  assert.equal(midPrice({ budgetMin: 100, budgetMax: 200 }), 150)
  assert.equal(midPrice({ budgetMin: null, budgetMax: 200 }), 200)
  assert.equal(midPrice({ budgetMin: null, budgetMax: null }), null)

  const a = { budgetMin: 100, budgetMax: 200 }
  const b = { budgetMin: 300, budgetMax: 400 }
  const c = { budgetMin: null, budgetMax: null }
  assert.ok(compareBySort('price', 'asc')(a, b) < 0, 'asc low first')
  assert.ok(compareBySort('price', 'desc')(a, b) > 0, 'desc high first')
  assert.ok(compareBySort('price', 'desc')(c, a) > 0, 'null last desc')
  assert.ok(compareBySort('price', 'asc')(c, a) > 0, 'null last asc')

  const m1 = { matchScore: 90 }
  const m2 = { matchScore: 60 }
  assert.ok(compareBySort('match', 'desc')(m1, m2) < 0, 'match desc')
  assert.ok(compareBySort('match', 'asc')(m1, m2) > 0, 'match asc')
})

/* ================= pure: avatar crop geometry (shared) ================= */
test('avatar crop: max inscribed circle + center square geometry', async () => {
  const { maxInscribedCircle, centerCropRect, scaleToFit } = await import(
    '../src/components/shared/useAvatarCrop.js'
  )
  const c = maxInscribedCircle(800, 600)
  assert.deepEqual(c, { cx: 400, cy: 300, r: 300 })
  const sq = centerCropRect(800, 600)
  assert.deepEqual(sq, { x: 100, y: 0, side: 600 })
  assert.equal(scaleToFit(600, 512), 512 / 600)
  // square image -> inscribed circle is half the side
  const cs = maxInscribedCircle(512, 512)
  assert.equal(cs.r, 256)
  assert.equal(cs.cx, 256)
})

/* ================= pure: sort preference persistence (B1-3a, 中等-6) ================= */
test('B1-3a sort preference persists and validates (mutation: delete persist -> refresh loses order)', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const { loadSortState, saveSortState, SORT_STATE_KEY } = await import(
    '../src/modules/teacher-side/B1/sort-state.js'
  )
  try {
    saveSortState({ sort: 'price', order: 'asc' })
    assert.deepEqual(loadSortState(), { sort: 'price', order: 'asc' }, 'persisted round-trip')
    // corrupt JSON -> fallback
    store.set(SORT_STATE_KEY, '{bad json')
    assert.deepEqual(loadSortState(), { sort: 'match', order: 'desc' }, 'corrupt fallback')
    // illegal values -> per-key fallback
    store.set(SORT_STATE_KEY, JSON.stringify({ sort: 'bogus', order: 'asc' }))
    assert.deepEqual(loadSortState(), { sort: 'match', order: 'asc' }, 'illegal value fallback')
  } finally {
    delete globalThis.localStorage
  }
})

/* ================= pure: contract-6 zero Chinese literals (audit finding) ================= */
test('contract 6: zero Chinese literals in teacher-side module source', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const root = fileURLToPath(new URL('../src/modules/teacher-side', import.meta.url))
  const dirs = ['B1', 'B2', 'B3']
  const hits = []
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d))) {
      if (!/\.(vue|js)$/.test(f)) continue
      const full = join(root, d, f)
      if (f === 'CONTRACT.md') continue
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/[一-鿿]/.test(line)) hits.push(`${d}/${f}:${i + 1}`)
        })
    }
  }
  // pages.js / pages-meta.js at module root
  for (const f of ['pages.js', 'pages-meta.js']) {
    const full = join(root, f)
    if (statSync(full).isFile()) {
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/[一-鿿]/.test(line)) hits.push(`${f}:${i + 1}`)
        })
    }
  }
  assert.deepEqual(hits, [], 'zero Chinese literals across teacher-side module (contract 6)')
})

/* ================= pure: match grouping (B1-5d1) ================= */
test('matchGroup groups by matchCount desc and hides zero-hit items when filters active', async () => {
  const { matchGroup, computeMatchCount, filterItems } = await import(
    '../src/components/shared/useMatchGroup.js'
  )
  const dims = [
    { key: 's', active: (f) => !!f.subjects?.length, matches: (it, f) => f.subjects.includes(it.subject) },
    { key: 'g', active: (f) => !!f.gender, matches: (it, f) => it.gender === f.gender },
  ]
  const items = [
    { id: 1, subject: '数学', gender: 'male' },
    { id: 2, subject: '数学', gender: 'female' },
    { id: 3, subject: '英语', gender: 'male' },
    { id: 4, subject: '英语', gender: 'female' },
  ]
  const filters = { subjects: ['数学'], gender: 'male' }
  assert.equal(computeMatchCount(items[0], filters, dims), 2)
  assert.equal(computeMatchCount(items[1], filters, dims), 1)
  assert.equal(computeMatchCount(items[3], filters, dims), 0)
  const groups = matchGroup(items, filters, dims, (a, b) => a.id - b.id)
  assert.equal(groups[0].count, 2)
  assert.equal(groups[0].items[0].id, 1)
  assert.equal(groups[1].count, 1)
  // items 2 (subject hit) and 3 (gender hit) both land in count-1 group
  assert.deepEqual(groups[1].items.map((i) => i.id), [2, 3])
  // item 4 hits zero dims -> excluded
  assert.ok(!groups.some((g) => g.items.some((i) => i.id === 4)))
  // no filters -> single group, all items
  const all = matchGroup(items, {}, dims, (a, b) => a.id - b.id)
  assert.equal(all.length, 1)
  assert.equal(all[0].count, null)
  assert.equal(all[0].items.length, 4)
  assert.equal(filterItems(items, { subjects: ['英语'] }, dims).length, 2)
})

/* ================= browser: grid geometry + zero console/CSP ================= */
let server
let browser
let page

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: VITE_CONFIG,
    logLevel: 'error',
    server: { port: BASE_PORT, host: '127.0.0.1', strictPort: true },
  })
  await server.listen()
  browser = await chromium.launch()
})

after(async () => {
  if (browser) await browser.close()
  if (server) await server.close()
})

async function mockDemands(pageOrCtx, items, status = 200) {
  await pageOrCtx.route('**/api/demands*', (route) => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 200 ? JSON.stringify({ items, total: items.length }) : JSON.stringify({ message: 'boom' }),
    })
  })
}

const DEMANDS = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  subject: i % 2 ? '数学' : '英语',
  grade: '高二',
  teachingMethod: 'offline',
  currentScore: 70 + i,
  addressArea: '上海',
  expectedTime: '周六',
  preferredGender: i % 2 ? 'male' : 'female',
  budgetMin: 100 + i * 20,
  budgetMax: 200 + i * 20,
  studentName: `学生${i + 1}`,
  matchScore: 95 - i,
  matchCount: 3 - (i % 4),
}))

test('browser: B1 grid renders 4 columns desktop / 2 columns mobile, no overflow, zero console', async () => {
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await mockDemands(ctx, DEMANDS)
  await p.goto(`http://127.0.0.1:${BASE_PORT}/test/teacher-side-harness.html`, {
    waitUntil: 'networkidle',
  })

  // page title + cards rendered
  const title = await p.textContent('.b1__title')
  assert.ok(title && title.includes('需求广场'), 'title')
  const cardCount = await p.locator('.b1-card').count()
  assert.equal(cardCount, 8, '8 cards rendered')

  // match badges: score badge always; count badge hidden until filters are active
  const scoreBadge = await p.locator('.b1-card__badge--score').first().textContent()
  assert.ok(scoreBadge.includes('95'), 'matchScore badge')
  assert.equal(
    await p.locator('.b1-card__badge--count').count(),
    0,
    'matchCount badge hidden without active filters',
  )

  // desktop: 4 columns
  const cols = await p.evaluate(() => {
    const grid = document.querySelector('.td-grid')
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length
  })
  assert.equal(cols, 4, 'desktop 4 columns')

  // no horizontal overflow (G5)
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert.equal(overflow, false, 'no desktop overflow')

  // card click -> cap toast (B1-7 seam)
  await p.locator('.b1-card').first().click()
  await p.waitForTimeout(200)
  const toast = await p.locator('.ui-toast').count()
  assert.ok(toast >= 1, 'session cap toast on card click')

  // contract 6 / CSP: zero inline event-handler attributes and zero injected <style>
  // elements in the rendered module DOM. (CSSOM setProperty style data is allowed by
  // contract 8 and does serialize into the style attr; it is not a CSP violation.)
  const inlineEvents = await p.evaluate(() =>
    document.querySelectorAll('#app [onclick], #app [onload], #app [onchange], #app [onfocus], #app [onkeydown]').length,
  )
  assert.equal(inlineEvents, 0, 'zero inline event attributes (contract 6)')
  const injectedStyles = await p.evaluate(() => document.querySelectorAll('#app style').length)
  assert.equal(injectedStyles, 0, 'zero injected <style> elements (contract 6)')

  // zero console / pageerror
  assert.deepEqual(errors, [])

  await ctx.close()
})

test('browser: 375px viewport grid is 2 columns with no overflow', async () => {
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 } })
  const p = await ctx.newPage()
  p.on('console', (m) => m.type() === 'error' && errors.push('mobile console: ' + m.text()))
  p.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))
  await mockDemands(ctx, DEMANDS)
  await p.goto(`http://127.0.0.1:${BASE_PORT}/test/teacher-side-harness.html`, {
    waitUntil: 'networkidle',
  })
  const cols = await p.evaluate(() => {
    const grid = document.querySelector('.td-grid')
    return getComputedStyle(grid).gridTemplateColumns.split(' ').length
  })
  assert.equal(cols, 2, 'mobile 2 columns')
  const overflow = await p.evaluate(() => {
    const vw = window.innerWidth
    return [...document.querySelectorAll('.b1-card')].some((el) => {
      const r = el.getBoundingClientRect()
      return r.right > vw + 1 || r.left < -1
    })
  })
  assert.equal(overflow, false, 'no mobile overflow')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('browser: filter immediate apply (B1-5a/5d2) updates the grid without console errors', async () => {
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await mockDemands(ctx, DEMANDS)
  await p.goto(`http://127.0.0.1:${BASE_PORT}/test/teacher-side-harness.html`, {
    waitUntil: 'networkidle',
  })

  // open the filter reveal
  await p.locator('.filter-reveal__btn').click()
  await p.waitForTimeout(400)
  const panelVisible = await p.locator('.filter-reveal__panel').isVisible()
  assert.equal(panelVisible, true, 'filter panel opens')

  // B1-4 mask: tapping the card area (outside the panel) dismisses the filter
  await p.locator('.b1__body').click({ position: { x: 300, y: 300 } })
  await p.waitForTimeout(400)
  assert.equal(
    await p.locator('.filter-reveal__panel').isVisible(),
    false,
    'B1-4 mask tap dismisses the filter panel',
  )
  await p.locator('.filter-reveal__btn').click()
  await p.waitForTimeout(400)

  // select 数学 (half of the 8 mock items are 数学) -> 4 cards, all with 数学
  await p.locator('.filter-subject__item', { hasText: '数学' }).click()
  await p.waitForTimeout(500)
  const cards = await p.locator('.b1-card').count()
  assert.equal(cards, 4, 'subject filter keeps only 数学 items')
  const subjects = await p.locator('.demand-card__title').allTextContents()
  assert.ok(subjects.every((s) => s.includes('数学')), 'all remaining cards are 数学')
  // matchCount badge now appears (client-computed active-dim hits) and matches the group header
  const countBadge = await p.locator('.b1-card__badge--count').first().textContent()
  assert.ok(countBadge.includes('1'), 'matchCount badge shows active-dim hits after filter')

  // reset -> 8 cards back
  await p.locator('.b1__reset').click()
  await p.waitForTimeout(500)
  assert.equal(await p.locator('.b1-card').count(), 8, 'reset restores all cards')

  assert.deepEqual(errors, [])
  await ctx.close()
})

test('browser: empty state and error state render cleanly', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))

  // empty
  await mockDemands(ctx, [])
  await p.goto(`http://127.0.0.1:${BASE_PORT}/test/teacher-side-harness.html`, {
    waitUntil: 'networkidle',
  })
  const emptyText = await p.locator('.b1__state').first().textContent()
  assert.ok(emptyText.includes('暂无匹配的需求'), 'empty state')

  // error
  await mockDemands(ctx, [], 500)
  await p.goto(`http://127.0.0.1:${BASE_PORT}/test/teacher-side-harness.html`, {
    waitUntil: 'networkidle',
  })
  const errText = await p.locator('.b1__state--error').first().textContent()
  assert.ok(errText.includes('加载失败'), 'error state')
  assert.deepEqual(errs, [])
  await ctx.close()
})

/* ================= browser: B2 my-info (verify gate four states + edit card) ================= */
const B2_URL = `http://127.0.0.1:${BASE_PORT}/test/teacher-b2-harness.html`

async function mockVerify(ctx, { status, provider }) {
  await ctx.route('**/api/teacher/verify-status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status, provider }),
    }),
  )
}

const PROFILE = {
  teacher_name: '王老师',
  bio: '十年一线教学',
  region: '上海',
  priceMin: 200,
  priceMax: 400,
  experience_years: 10,
  gender: '男',
  graduation: '华东师大',
  timeSlots: ['周一', '周三'],
  personalityTags: ['耐心', '严谨'],
  subjects: [{ subject: '数学', score: 145, full: 150, awards: ['市一等奖'] }],
  philosophy: '因材施教',
  avatar: '',
}

async function mockProfile(ctx, profile = PROFILE) {
  let putBody = null
  let getCount = 0
  await ctx.route('**/api/teacher/profile', (route) => {
    if (route.request().method() === 'PUT') {
      putBody = route.request().postDataJSON()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
    getCount += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) })
  })
  return () => ({ putBody, getCount })
}

test('browser: B2 verify gate renders four states cleanly', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  // none -> both channels
  await mockVerify(ctx, { status: 'none' })
  await p.goto(B2_URL, { waitUntil: 'networkidle' })
  assert.ok((await p.locator('.verify-chsi').count()) >= 1, 'chsi channel in none state')
  assert.ok((await p.locator('.verify-admission').count()) >= 1, 'admission channel in none state')

  // pending -> pending hint
  await mockVerify(ctx, { status: 'pending', provider: 'chsi' })
  await p.goto(B2_URL, { waitUntil: 'networkidle' })
  const pendingText = await p.locator('.verify-gate__hint').first().textContent()
  assert.ok(pendingText.includes('审核中'), 'pending state')

  // rejected -> re-submit channels
  await mockVerify(ctx, { status: 'rejected' })
  await p.goto(B2_URL, { waitUntil: 'networkidle' })
  assert.ok((await p.locator('.verify-chsi').count()) >= 1, 'chsi re-submit in rejected')
  assert.ok((await p.locator('.verify-admission').count()) >= 1, 'admission re-submit in rejected')

  assert.deepEqual(errors, [])
  await ctx.close()
})

test('browser: B2 approved state renders edit card, save posts I-40, validation blocks empty teacherName', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

  await mockVerify(ctx, { status: 'approved' })
  const getPutBody = await mockProfile(ctx)
  await p.goto(B2_URL, { waitUntil: 'networkidle' })

  // edit card rendered + prefilled from I-39
  const card = await p.locator('.profile-edit__card').count()
  assert.equal(card, 1, 'edit card renders in approved state')
  const nameVal = await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().inputValue()
  assert.equal(nameVal, '王老师', 'teacherName prefilled (D3 teacher name)')
  const getCountBefore = getPutBody().getCount

  // mutation guard: empty teacherName -> validation blocks, no PUT
  await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().fill('')
  await p.locator('.profile-edit__actions .ui-btn').first().click()
  await p.waitForTimeout(300)
  const errText = await p.locator('.profile-edit__error').count()
  assert.ok(errText >= 1, 'validation error shown for empty teacherName')
  assert.equal(getPutBody().putBody, null, 'no PUT when validation fails')

  // fill name + save -> PUT posts the edit payload + read-back refresh (F7 mutation guard)
  await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().fill('王老师')
  await p.locator('.profile-edit__actions .ui-btn').first().click()
  await p.waitForTimeout(500)
  const body = getPutBody().putBody
  assert.ok(body, 'PUT /api/teacher/profile fired')
  // I-40 contract field names (snake_case), not camelCase
  assert.equal(body.teacher_name, '王老师', 'I-40 teacher_name field')
  assert.equal(body.experience_years, 10, 'I-40 experience_years field')
  assert.equal(body.priceMin, 200)
  assert.ok(Array.isArray(body.subjects), 'subjects array in payload')
  assert.equal('avatar' in body, false, 'avatar not part of I-40 payload (I-11 separate)')
  assert.ok(getPutBody().getCount > getCountBefore, 'read-back refresh after save (F7)')

  // zero console errors
  assert.deepEqual(errors, [])
  await ctx.close()
})
