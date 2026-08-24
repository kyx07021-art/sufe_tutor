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
    subject: 'math',
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
  assert.equal(item.subject, 'math')
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

/* ================= pure: PA-1d-F4 profile model (I-39 edit shape / I-40 save body) ================= */
test('PA-1d-F4: normalizeProfile maps I-39 row to edit shape (region = province id, graduationYear rename)', async () => {
  const { normalizeProfile } = await import(
    '../src/modules/teacher-side/B2/profile-model.js'
  )
  const n = normalizeProfile(PROFILE)
  assert.equal(n.teacherName, '王老师')
  assert.equal(n.bio, '十年一线教学')
  assert.equal(n.region, 'shanghai', 'region = province pinyin id (I-40 province source)')
  assert.equal(n.addressArea, '上海市杨浦区')
  assert.equal(n.teachingMethod, 'offline')
  assert.equal(n.experienceYears, 10)
  assert.equal(n.graduationYear, 2015, 'graduation_year -> graduationYear')
  assert.equal(n.gender, '男')
  assert.deepEqual(n.timeSlots, ['周一', '周三'])
  assert.deepEqual(n.personalityTags, ['耐心', '严谨'])
  assert.deepEqual(n.subjects, [{ subject: 'math', score: 145, full: 150, awards: ['市一等奖'] }])

  // C3: missing/null fields -> safe defaults (no throw)
  const sparse = normalizeProfile(null)
  assert.equal(sparse.teacherName, '')
  assert.equal(sparse.region, '')
  assert.equal(sparse.graduationYear, '')
  assert.equal(sparse.experienceYears, 0)
  assert.deepEqual(sparse.subjects, [])
  const sparse2 = normalizeProfile({ teacher_name: '李老师', province: 'zhejiang', graduation_year: 2020 })
  assert.equal(sparse2.teacherName, '李老师')
  assert.equal(sparse2.region, 'zhejiang')
  assert.equal(sparse2.graduationYear, 2020)
})

test('PA-1d-F4: buildSaveBody sends camelCase I-40 field set with province required (mutation: drop province -> red)', async () => {
  const { buildSaveBody } = await import(
    '../src/modules/teacher-side/B2/profile-model.js'
  )
  const body = buildSaveBody({
    teacherName: '王老师',
    bio: '十年一线教学',
    region: 'shanghai',
    addressArea: '上海市杨浦区',
    teachingMethod: 'offline',
    priceMin: 200,
    priceMax: 400,
    experienceYears: 10,
    gender: '男',
    graduationYear: '2015',
    timeSlots: ['周一', '周三'],
    personalityTags: ['耐心', '严谨'],
    subjects: [{ subject: 'math', score: 145, full: 150, awards: ['市一等奖'] }],
    philosophy: '因材施教',
  })
  assert.ok(body.profile, 'wrapped in { profile } (I-40)')
  const p = body.profile
  assert.equal(p.province, 'shanghai', 'province mapped from region (required)')
  assert.equal(p.teacherName, '王老师')
  assert.equal(p.bio, '十年一线教学')
  assert.equal(p.addressArea, '上海市杨浦区')
  assert.equal(p.teachingMethod, 'offline')
  assert.equal(p.priceMin, 200)
  assert.equal(p.priceMax, 400)
  assert.equal(p.experienceYears, 10)
  assert.equal(p.gender, '男')
  assert.equal(p.graduationYear, '2015', 'graduationYear field name (not graduation)')
  assert.deepEqual(p.timeSlots, ['周一', '周三'])
  assert.deepEqual(p.personalityTags, ['耐心', '严谨'])
  assert.deepEqual(p.subjects, [{ subject: 'math', score: 145 }], 'subjects collapsed to { subject, score }')
  assert.equal(p.philosophy, '因材施教')
  assert.equal('avatar' in p, false, 'avatar not part of I-40 payload (I-11 separate)')

  // C3: empty/absent subjects -> [] (no throw)
  const empty = buildSaveBody({ region: 'shanghai', subjects: null })
  assert.deepEqual(empty.profile.subjects, [])
})

test('PA-1d-F4: formatTimeSlots renders structured rows as readable text, save keeps object rows', async () => {
  const { formatTimeSlots } = await import('../src/modules/teacher-side/B2/profile-model.js')
  const rows = [
    { type: 'week', dow: 1, start: '18:00', end: '20:00' },
    { type: 'week', dow: 3, start: '09:00', end: '11:00' },
  ]
  assert.equal(formatTimeSlots(rows), '周一 18:00-20:00、周三 09:00-11:00')
  assert.equal(formatTimeSlots([]), '')
  assert.equal(formatTimeSlots(null), '')
  // malformed rows are skipped, never thrown
  assert.equal(formatTimeSlots([{ dow: 9, start: 'a' }, 'x', null]), '')
  // structured rows survive the round-trip (never collapsed to free text)
  const { buildSaveBody } = await import('../src/modules/teacher-side/B2/profile-model.js')
  const body = buildSaveBody({ region: 'shanghai', timeSlots: rows })
  assert.deepEqual(body.profile.timeSlots, rows, 'save body keeps structured object rows')
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
    { id: 1, subject: 'math', gender: 'male' },
    { id: 2, subject: 'math', gender: 'female' },
    { id: 3, subject: 'english', gender: 'male' },
    { id: 4, subject: 'english', gender: 'female' },
  ]
  const filters = { subjects: ['math'], gender: 'male' }
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
  assert.equal(filterItems(items, { subjects: ['english'] }, dims).length, 2)
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
  subject: i % 2 ? 'math' : 'english',
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

  // AK-C2-F3 (#2 black-is-black): sort tab hover keeps ink (no gray-out)
  const tab = p.locator('.sort-bar__tab').first()
  const tabInkBefore = await tab.evaluate((el) => getComputedStyle(el).color)
  await tab.hover()
  await p.waitForTimeout(250)
  const tabInkAfter = await tab.evaluate((el) => getComputedStyle(el).color)
  assert.equal(tabInkAfter, tabInkBefore, 'sort tab hover must keep ink, got ' + tabInkAfter)

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

// Real I-39 shape: handleGetProfile wraps the profile row in `{ profile: {...} }`, and
// mapTeacherProfileRow emits camelCase new-model fields (bio/priceMin/priceMax/timeSlots/
// personalityTags/teachingMethod) alongside snake_case (teacher_name/experience_years/
// province/address/graduation_year). PA-1d-F4: `region` edit field = province pinyin id;
// the save body sends camelCase I-40 with `province` required.
const PROFILE = {
  teacher_name: '王老师',
  bio: '十年一线教学',
  province: 'shanghai',
  address: '上海市杨浦区',
  teaching_method: 'offline',
  priceMin: 200,
  priceMax: 400,
  experience_years: 10,
  gender: '男',
  timeSlots: ['周一', '周三'],
  personalityTags: ['耐心', '严谨'],
  graduation_year: 2015,
  subjects: [{ subject: 'math', score: 145, full: 150, awards: ['市一等奖'] }],
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
    // G3: match the real I-39 response envelope { profile } (was flat -> masked the bug)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) })
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

  // edit card rendered + prefilled from I-39 wrapped { profile } shape
  const card = await p.locator('.profile-edit__card').count()
  assert.equal(card, 1, 'edit card renders in approved state')
  const nameVal = await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().inputValue()
  assert.equal(nameVal, '王老师', 'teacherName prefilled (D3 teacher name)')
  const bioVal = await p.locator('input[aria-label="简介"], textarea[aria-label="简介"]').first().inputValue()
  assert.equal(bioVal, '十年一线教学', 'bio prefilled from wrapped I-39')
  const priceMinVal = await p.locator('input[aria-label="最低价"], textarea[aria-label="最低价"]').first().inputValue()
  assert.equal(priceMinVal, '200', 'priceMin prefilled from wrapped I-39')
  // UiInput derives the input aria-label from `placeholder`; the region/graduation fields
  // have none, so target them by their field label block.
  const regionVal = await p
    .locator('.profile-edit__field', { hasText: '地址' })
    .locator('.ui-input textarea')
    .first()
    .inputValue()
  assert.equal(regionVal, 'shanghai', 'region prefill = province pinyin id (PA-1d-F4)')
  const gradVal = await p
    .locator('.profile-edit__field', { hasText: '毕业院校' })
    .locator('.ui-input textarea')
    .first()
    .inputValue()
  assert.equal(gradVal, '2015', 'graduationYear prefill (PA-1d-F4 rename)')
  const getCountBefore = getPutBody().getCount

  // mutation guard: empty teacherName -> validation blocks, no PUT
  await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().fill('')
  await p.locator('.profile-edit__actions .ui-btn').first().click()
  await p.waitForTimeout(300)
  const errText = await p.locator('.profile-edit__error').count()
  assert.ok(errText >= 1, 'validation error shown for empty teacherName')
  assert.equal(getPutBody().putBody, null, 'no PUT when validation fails')
  // PA-2-F15: the message names the missing field (not a vague "fill required").
  const errMsg = (await p.locator('.profile-edit__error').first().innerText()).trim()
  assert.ok(errMsg.includes('教师名'), 'teacherName gap named in the error: ' + errMsg)

  // mutation guard: empty region (province) -> validation blocks, no PUT (I-40 province required)
  await p.locator('#profile-edit-name input, #profile-edit-name textarea').first().fill('王老师')
  await p
    .locator('.profile-edit__field', { hasText: '地址' })
    .locator('.ui-input textarea')
    .first()
    .fill('')
  await p.locator('.profile-edit__actions .ui-btn').first().click()
  await p.waitForTimeout(300)
  assert.equal(getPutBody().putBody, null, 'no PUT when province (region) empty')
  await p
    .locator('.profile-edit__field', { hasText: '地址' })
    .locator('.ui-input textarea')
    .first()
    .fill('shanghai')

  // fill name + save -> PUT posts the I-40 camelCase payload + read-back refresh (F7 mutation guard)
  await p.locator('.profile-edit__actions .ui-btn').first().click()
  await p.waitForTimeout(500)
  const raw = getPutBody().putBody
  assert.ok(raw && typeof raw === 'object' && raw.profile, 'PUT body wrapped in { profile } (I-40)')
  const body = raw.profile
  // I-40 contract field names (camelCase), not snake_case
  assert.equal(body.province, 'shanghai', 'I-40 province required (from region)')
  assert.equal(body.teacherName, '王老师', 'I-40 teacherName field')
  assert.equal(body.experienceYears, 10, 'I-40 experienceYears field')
  assert.equal(body.priceMin, 200)
  assert.equal(body.addressArea, '上海市杨浦区', 'I-40 addressArea passthrough')
  assert.equal(body.teachingMethod, 'offline', 'I-40 teachingMethod passthrough')
  assert.equal(body.graduationYear, '2015', 'I-40 graduationYear field (renamed from graduation)')
  assert.deepEqual(body.subjects, [{ subject: 'math', score: 145 }], 'subjects collapsed to { subject, score }')
  assert.equal('avatar' in body, false, 'avatar not part of I-40 payload (I-11 separate)')
  assert.ok(getPutBody().getCount > getCountBefore, 'read-back refresh after save (F7)')

  // zero console errors
  assert.deepEqual(errors, [])
  await ctx.close()
})
