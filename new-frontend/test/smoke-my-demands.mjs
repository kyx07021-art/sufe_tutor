/**
 * M8 A2 我的需求 smoke test（dev server + Playwright + node 单元）
 * -------------------------------------------------------
 * - Node 单元：datahub 缓存语义（dhGet/dhSet/dhHas/dhInvalidate/dhFetch）。
 * - Node 单元：region 数据形状（PROVINCES/GRADES/PREP_GRADE/allowsOffline）+ pages.js 数组注册（M8-15 F-1 锁）。
 * - Playwright（dev server :5199）：
 *   ① 网格几何（桌面 1440 + 移动 375，无横向溢出，槽宽 28.33%/左右 5%/卡间 2.5%）
 *   ② >3 卡片网格几何（4 卡 + 加号槽，桌面列定位 2/4/6/2/4，移动全部在视口内）
 *   ③ I-33 数据接入：X-Auth-Token 注入 / 缓存命中不重拉 / invalidate 后重拉 / 401 清 token + auth:dead
 *   ④ 卡片 A2.1 结构（成绩/省份+方式/地址/时间/偏好/性别/简介/CTA）+ M9 教师模式复用 shape
 *   ⑤ 上海预备班：省份=上海 时年级下拉含「预备班」且不含「小学六年级」
 *   ⑥ 步进浮窗 create/edit/delete（I-35 提交 body：grade id / expectedTime JSON 串 / 数字预算 / currentScore 字符串往返 / 无 currentScoreFull）
 *   ⑦ 零 console/pageerror/requestfailed
 *   ⑧ currentScore 字符串往返（PA-1d-F2 守护）：等第 'B+' / 数字 '140' 直传字符串，不 Number 强转
 * 运行：node test/smoke-my-demands.mjs（需 dev server 于 :5199；BASE 可覆盖）
 */
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { dhGet, dhSet, dhHas, dhInvalidate, dhFetch, dhClearAll } from '../src/core/datahub.js'
import {
  MY_DEMANDS_COPY,
  DEMAND_SCORE_TEMPLATE,
  DEMAND_METHOD_LABEL,
} from '../src/constants/m-my-demands.js'
import {
  PROVINCES,
  GRADES,
  PREP_GRADE,
  PERSONALITY_TAGS,
  allowsOffline,
  gradeLabel,
  tagLabel,
} from '../src/modules/my-demands/region.js'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
function check(cond, msg) {
  if (!cond) errors.push(msg)
}

/* ---- display helpers (mirror demandForm.displayTimeSlots contract; grade/tag maps are single-sourced from region.js) ---- */
const WEEKDAY_CHARS = '一二三四五六日'
/** displayTimeSlots contract output: "每周三 18:00-20:00"（dow 1=周一..7=周日） */
const timeLine = (dow, start, end) => `每周${WEEKDAY_CHARS[dow - 1]} ${start}-${end}`

/**
 * I-33 行形状 fixture（对齐真实后端契约：grade=后端 id 串 / expectedTime=JSON wire 串 /
 * preferredTags=后端 tag id 数组 / teachingMethod 三态；province 保留显示标签以维持既有几何与方式断言）
 */
const FIXTURES = [
  {
    id: 1, user_id: 10, subject: 'chinese', grade: 'p3', // p3 = 小学三年级
    province: '上海', teachingMethod: 'both', currentScore: 130, currentScoreFull: 150,
    addressArea: '杨浦区·五角场街道',
    expectedTime: JSON.stringify([{ type: 'week', dow: 7, start: '14:00', end: '16:00' }]),
    preferredTags: ['humorous', 'patience'], preferredGender: 'female',
    additionalInfo: '需要夯实基础，侧重阅读与背诵。',
  },
  {
    id: 2, user_id: 10, subject: 'math', grade: 'junior1', // junior1 = 初一
    province: '湖北', teachingMethod: 'online', currentScore: 92, currentScoreFull: 100,
    expectedTime: JSON.stringify([{ type: 'week', dow: 3, start: '18:00', end: '20:00' }]),
    preferredTags: ['responsible'], preferredGender: 'male',
    additionalInfo: '希望系统梳理代数。',
  },
  {
    id: 3, user_id: 10, subject: 'english', grade: 'senior1', // senior1 = 高一
    province: '浙江', teachingMethod: 'offline', addressArea: '西湖区·文三路',
    expectedTime: JSON.stringify([{ type: 'week', dow: 2, start: '19:00', end: '21:00' }]),
    preferredTags: [], preferredGender: 'female',
    additionalInfo: '备战托福基础。',
  },
]

/** >3 卡片网格用例（F-10/G5）：4 行数据 + 加号槽 = 5 个网格子项 */
const GRID_FIXTURES = [
  {
    id: 11, user_id: 10, subject: 'chinese', grade: 'p3', province: '上海', teachingMethod: 'both',
    currentScore: 130, currentScoreFull: 150, addressArea: '杨浦区·五角场街道',
    expectedTime: JSON.stringify([{ type: 'week', dow: 7, start: '14:00', end: '16:00' }]),
    preferredTags: ['humorous', 'patience'], preferredGender: 'female', additionalInfo: '夯实基础。',
  },
  {
    id: 12, user_id: 10, subject: 'math', grade: 'junior1', province: '湖北', teachingMethod: 'online',
    currentScore: 92, currentScoreFull: 100,
    expectedTime: JSON.stringify([{ type: 'week', dow: 3, start: '18:00', end: '20:00' }]),
    preferredTags: ['responsible'], preferredGender: 'male', additionalInfo: '系统梳理代数。',
  },
  {
    id: 13, user_id: 10, subject: 'english', grade: 'senior1', province: '浙江', teachingMethod: 'offline',
    addressArea: '西湖区·文三路',
    expectedTime: JSON.stringify([{ type: 'week', dow: 2, start: '19:00', end: '21:00' }]),
    preferredTags: [], preferredGender: 'female', additionalInfo: '备战托福基础。',
  },
  {
    id: 14, user_id: 10, subject: 'physics', grade: 'junior2', province: '江苏', teachingMethod: 'online',
    currentScore: 80, currentScoreFull: 100,
    expectedTime: JSON.stringify([{ type: 'week', dow: 5, start: '16:00', end: '18:00' }]),
    preferredTags: ['logical'], preferredGender: 'female', additionalInfo: '查漏补缺。',
  },
]

/* ---------- 1. datahub 单元 ---------- */
async function unitDatahub() {
  dhInvalidate('demands', 'teachers')
  check(dhHas('demands') === false, 'unit: dhHas after invalidate')
  check(dhGet('demands') === undefined, 'unit: dhGet absent')

  dhSet('demands', { items: [1] })
  check(dhHas('demands') === true, 'unit: dhHas after set')
  check(JSON.stringify(dhGet('demands')) === '{"items":[1]}', 'unit: dhGet value')

  let fetches = 0
  const fetcher = async () => { fetches += 1; return { items: [2] } }
  const v1 = await dhFetch('unit-a', fetcher)
  check(JSON.stringify(v1) === '{"items":[2]}', 'unit: dhFetch first value')
  check(fetches === 1, 'unit: dhFetch first fetch count')
  await dhFetch('unit-a', fetcher)
  check(fetches === 1, 'unit: cache hit must not re-run fetcher')
  await dhFetch('unit-a', fetcher, { force: true })
  check(fetches === 2, 'unit: force must re-run fetcher')

  dhInvalidate('unit-a')
  check(dhHas('unit-a') === false, 'unit: invalidate removes key')

  // dhClearAll (PA-1g-F1): every domain key must be dropped at once, no residue
  dhSet('demands', { items: [1] })
  dhSet('teachers', { items: [2] })
  dhClearAll()
  check(dhHas('demands') === false, 'unit: dhClearAll must drop the demands key')
  check(dhHas('teachers') === false, 'unit: dhClearAll must drop the teachers key')
  check(dhGet('demands') === undefined, 'unit: dhClearAll must leave no residue')
  console.log('  [unit] datahub cache semantics ok')
}

/* ---------- 1b. PA-1g-F1 登出/401 清空 datahub（真实模块行为测试，防跨用户缓存残留） ---------- */
/**
 * PA-1g-F1 (1101): the datahub module cache is process-wide and keyed by business
 * domain only (no user identity). Logout and the 401 dead-token fallback MUST clear
 * the whole cache, otherwise a second user in the same tab reads the first user's
 * cached data (the my-demands list holds private info). This imports the REAL
 * auth-actions.logout / handle-dead-token.handleDeadToken - the Vite `@` alias is
 * resolved for Node via a node:module resolve hook - seeds the cache with multiple
 * domains, and asserts every key is gone. Mutation guard: deleting either dhClearAll
 * call makes the matching assertion red.
 */
async function unitAuthClearsDatahub() {
  const srcUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'src') + '/').href
  const hook = 'data:text/javascript,' + encodeURIComponent(`
    let base = ''
    export function initialize(data) { base = data.src }
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) return nextResolve(new URL(specifier.slice(2), base).href, context)
      return nextResolve(specifier, context)
    }
  `)
  register(hook, { data: { src: srcUrl } })

  const { logout } = await import('../src/modules/shell/auth-actions.js')
  const { handleDeadToken } = await import('../src/modules/shell/handle-dead-token.js')

  // logout: every domain key must be dropped
  dhSet('demands', { items: [1] })
  dhSet('teachers', { items: [2] })
  await logout()
  check(dhHas('demands') === false, 'logout: datahub must drop the demands cache (PA-1g-F1 cross-user leak)')
  check(dhHas('teachers') === false, 'logout: datahub must drop the teachers cache (PA-1g-F1 cross-user leak)')

  // 401 dead-token fallback: same guarantee
  dhSet('demands', { items: [3] })
  dhSet('contracts', { items: [4] })
  handleDeadToken({ silent: true })
  check(dhHas('demands') === false, '401: handleDeadToken must drop the demands cache (PA-1g-F1 cross-user leak)')
  check(dhHas('contracts') === false, '401: handleDeadToken must drop the contracts cache (PA-1g-F1 cross-user leak)')
  console.log('  [unit] logout/401 clear datahub cache ok')
}

/* ---------- 2. region 数据形状单元（M8-15，上海预备班前置） ---------- */
async function unitRegion() {
  check(PROVINCES.some((p) => p.value === 'shanghai'), 'region: PROVINCES must include shanghai')
  check(allowsOffline('shanghai') === true, 'region: allowsOffline(shanghai) must be true')
  check(GRADES.some((g) => g.value === 'p6'), 'region: GRADES must include p6 (小学六年级)')
  check(PREP_GRADE && PREP_GRADE.value === 'prep' && PREP_GRADE.label === '预备班', 'region: PREP_GRADE must exist (prep/预备班)')
  check(gradeLabel('junior1') === '初一', 'region: gradeLabel(junior1) must be 初一')
  check(gradeLabel('prep') === '预备班', 'region: gradeLabel(prep) must be 预备班')
  console.log('  [unit] region data shape ok')
}

/* ---------- 3. pages.js 数组注册单元（M8-15 F-1/G1；import.meta.glob 无法在纯 node 跑，源码级断言） ---------- */
async function unitPageRegistration() {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules', 'my-demands', 'pages.js'),
    'utf8',
  )
  // (a) 必须是 pages 数组导出 —— 单对象导出会被 page-registry glob 静默跳过（F-1 断线）
  check(/export\s+const\s+pages\s*=\s*\[/.test(src), 'pages: pages.js must export a `pages` array (F-1 registry fix)')
  const start = src.indexOf('[')
  const end = src.lastIndexOf(']')
  const arr = start >= 0 && end > start ? src.slice(start, end + 1) : ''
  // (b) 数组内含 my-demands 页定义
  check(arr.includes("path: '/my-demands'"), "pages: my-demands entry must have path '/my-demands'")
  check(arr.includes("name: 'my-demands'"), "pages: my-demands entry must have name 'my-demands'")
  check(/roles\s*:\s*\[[^\]]*student/i.test(arr), 'pages: my-demands roles must include student (ROLES.STUDENT or literal)')
  check(/\bmeta\s*:\s*\{\s*[^}]*tab\s*:\s*true/.test(arr), 'pages: my-demands entry must set meta.tab === true')
  console.log('  [unit] page registration (pages array) ok')
}

/* ---------- 4. Playwright：桌面 1440 ---------- */
async function desktop() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message))
  page.on('requestfailed', (r) => errors.push('desktop requestfailed: ' + r.url()))

  let demandCalls = 0
  await page.route('**/api/demands/mine', async (route) => {
    demandCalls += 1
    const token = route.request().headers()['x-auth-token'] || ''
    check(token === 'test-token', 'desktop: demands fetch missing/invalid X-Auth-Token: ' + token)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: FIXTURES }) })
  })

  await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  const cards = page.locator('.demand-grid .demand-card')
  const n = await cards.count()
  check(n === 3, `desktop: expected 3 student demand cards, got ${n}`)
  check(demandCalls === 1, `desktop: expected 1 initial fetch, got ${demandCalls}`)

  // 网格几何（桌面）：槽宽 28.33%、left = 5% / 35.83% / 66.66%，行高 240
  const geo = await page.evaluate(() =>
    [...document.querySelectorAll('.demand-grid .demand-card')].map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, width: r.width, height: r.height }
    }),
  )
  const vw = 1440
  const expLeft = [0.05, 0.3583, 0.6666].map((f) => f * vw)
  geo.forEach((g, i) => {
    check(Math.abs(g.left - expLeft[i]) <= 3, `desktop: card ${i + 1} left ${g.left} != ~${expLeft[i]}`)
    check(Math.abs(g.width - 0.2833 * vw) <= 3, `desktop: card ${i + 1} width ${g.width} != ~28.33%`)
  })
  if (geo[0]) check(Math.abs(geo[0].height - 240) <= 2, `desktop: card height ${geo[0].height} != 240`)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'desktop: horizontal overflow')

  // 卡片结构 A2.1（第一张：both 三态，全信息项）
  const t1 = (await cards.nth(0).textContent()) || ''
  check(t1.includes('语文·' + gradeLabel('p3')), 'desktop: card1 title subject/grade missing') // 语文·小学三年级
  check(t1.includes(DEMAND_SCORE_TEMPLATE.full(130, 150)), 'desktop: score line missing') // 130分/150满分
  check(t1.includes('上海·' + DEMAND_METHOD_LABEL.both), 'desktop: province+method missing') // 上海·线上线下均可
  check(t1.includes('杨浦区·五角场街道'), 'desktop: address missing (both mode)')
  check(t1.includes(timeLine(7, '14:00', '16:00')), 'desktop: time missing') // 每周日 14:00-16:00
  const t1Tags = ['humorous', 'patience'].map(tagLabel)
  check(t1Tags.includes('幽默') && t1.includes('幽默') && t1.includes('耐心'), 'desktop: personality tags missing') // 幽默·耐心
  check(t1.includes('女'), 'desktop: gender missing')
  check(t1.includes('需要夯实基础'), 'desktop: intro missing')
  check(t1.includes('编辑需求'), 'desktop: student CTA missing')

  // 第二张：线上单，无地址信息项（M8-10a 定案）+ 任务示例 title '数学·初一'
  const t2 = (await cards.nth(1).textContent()) || ''
  check(t2.includes('数学·' + gradeLabel('junior1')), 'desktop: card2 title missing (数学·初一)')
  check(t2.includes('湖北·线上'), 'desktop: card2 province+method missing')
  check(t2.includes(timeLine(3, '18:00', '20:00')), 'desktop: card2 time line missing (每周三 18:00-20:00)')
  check(!t2.includes('地址'), 'desktop: online-only demand must NOT show address')

  // 第三张：线下单，title '英语·高一'
  const t3 = (await cards.nth(2).textContent()) || ''
  check(t3.includes('英语·' + gradeLabel('senior1')), 'desktop: card3 title missing (英语·高一)')
  check(t3.includes('浙江·' + DEMAND_METHOD_LABEL.offline), 'desktop: card3 province+method missing')

  // 缓存 / invalidate（经预览 debug hooks；函数不可跨 evaluate 序列化，页内判型）
  const dbgOk = await page.evaluate(() => {
    const d = window.__myDemandsDebug
    return !!d && typeof d.reload === 'function' && typeof d.dhInvalidate === 'function'
  })
  check(dbgOk, 'desktop: debug hooks missing')
  await page.evaluate(() => window.__myDemandsDebug.reload())
  await page.waitForTimeout(150)
  check(demandCalls === 1, `desktop: cache hit failed (refetched on reload), calls=${demandCalls}`)
  await page.evaluate(() => { window.__myDemandsDebug.dhInvalidate('demands'); window.__myDemandsDebug.reload() })
  await page.waitForTimeout(150)
  check(demandCalls === 2, `desktop: invalidate did not trigger refetch, calls=${demandCalls}`)

  // M9 复用 shape：教师模式卡片（去联系试课 / studentName）
  const tcard = page.locator('.md-preview__teacher .demand-card')
  check((await tcard.count()) === 1, 'desktop: expected 1 teacher-mode card')
  const tt = (await tcard.textContent()) || ''
  check(tt.includes('去联系试课'), 'desktop: teacher CTA missing')
  check(tt.includes('小舟'), 'desktop: teacher card studentName missing')

  await page.screenshot({ path: 'test/smoke-my-demands.png', fullPage: true })
  await browser.close()
  console.log('  [browser] desktop 1440 ok')
}

/* ---------- 5. Playwright：移动 375 ---------- */
async function mobile() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 375, height: 700 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('mobile console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))

  await page.route('**/api/demands/mine', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: FIXTURES }) })
  })
  await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  const cards = page.locator('.demand-grid .demand-card')
  check((await cards.count()) === 3, `mobile: expected 3 cards, got ${await cards.count()}`)

  const geo = await page.evaluate(() =>
    [...document.querySelectorAll('.demand-grid .demand-card')].map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, width: r.width }
    }),
  )
  geo.forEach((g, i) => {
    check(Math.abs(g.left - 0.05 * 375) <= 3, `mobile: card ${i + 1} left ${g.left} != ~5%`)
    check(Math.abs(g.width - 0.9 * 375) <= 3, `mobile: card ${i + 1} width ${g.width} != ~90%`)
  })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'mobile: horizontal overflow')

  await browser.close()
  console.log('  [browser] mobile 375 ok')
}

/* ---------- 6. Playwright：401 兜底 ---------- */
async function unauthorized() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // 401 的浏览器网络日志（"Failed to load resource: ... 401"）为预期产物，非 JS 错误，过滤之
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('401 console: ' + m.text())
  })
  page.on('pageerror', (e) => errors.push('401 pageerror: ' + e.message))

  await page.route('**/api/demands/mine', async (route) => {
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED', message: '' }) })
  })
  await page.addInitScript(() => {
    sessionStorage.setItem('authToken', 'test-token')
    window.__authDeadFired = false
    window.addEventListener('auth:dead', () => { window.__authDeadFired = true })
  })
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  const tokenAfter = await page.evaluate(() => sessionStorage.getItem('authToken'))
  check(tokenAfter === null, `401: authToken not cleared (got ${tokenAfter})`)
  const fired = await page.evaluate(() => window.__authDeadFired)
  check(fired === true, '401: auth:dead event not dispatched')
  check((await page.locator('.demand-grid .demand-card').count()) === 0, '401: grid should render zero cards')

  await browser.close()
  console.log('  [browser] 401 handling ok')
}

/* ---------- 7. Playwright：步进浮窗 create/edit/delete（M8-06..14） ---------- */
/** Click a dropdown inside the visible step page by its field title, then pick an option. */
async function pickDropdown(page, fieldTitle, optionText) {
  const field = page.locator('.ui-step__page:visible .ui-fieldinput', { hasText: fieldTitle })
  await field.locator('.ui-dropdown').click()
  await page.waitForTimeout(160)
  await page.locator('.ui-droppanel__item', { hasText: optionText }).click()
  await page.waitForTimeout(160)
}

/** Click the step footer's right button (next / submit).
 *  UiStepModal guards re-entry while its 320ms page transition runs; wait >= transition + margin. */
async function clickFooterBtn(page) {
  const btn = page.locator('.ui-step__footer .ui-btn').last()
  await btn.click()
  await page.waitForTimeout(450)
}

async function wizard() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('wizard console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('wizard pageerror: ' + e.message))

  // stateful in-memory "DB" mock for I-33/35/36/37/38
  let db = []
  const created = []
  const updated = []
  const deleted = []
  let mineCalls = 0

  await page.route('**/api/demands**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.endsWith('/api/demands/mine')) {
      mineCalls += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: db }) })
      return
    }
    if (url.endsWith('/api/demands') && method === 'POST') {
      const body = route.request().postDataJSON()
      created.push(body)
      const id = 100 + db.length
      db.push({ id, ...body })
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, message: 'ok' }) })
      return
    }
    const m = url.match(/\/api\/demands\/(\d+)$/)
    if (m) {
      const id = Number(m[1])
      if (method === 'GET') {
        const d = db.find((x) => x.id === id)
        await route.fulfill({ status: d ? 200 : 404, contentType: 'application/json', body: JSON.stringify(d || { code: 'NOT_FOUND', message: '' }) })
        return
      }
      if (method === 'PUT') {
        const body = route.request().postDataJSON()
        updated.push(body)
        const i = db.findIndex((x) => x.id === id)
        if (i >= 0) db[i] = { ...db[i], ...body }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'ok' }) })
        return
      }
      if (method === 'DELETE') {
        deleted.push(id)
        db = db.filter((x) => x.id !== id)
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
        return
      }
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: '' }) })
  })

  await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  // empty grid + plus slot
  check((await page.locator('.demand-grid .demand-card').count()) === 0, 'wizard: initial grid should be empty')
  check((await page.locator('.demand-plus-slot').count()) === 1, 'wizard: plus slot missing')

  // ---- create flow ----
  await page.locator('.demand-plus-slot .ui-btn').click()
  await page.waitForTimeout(400)
  check((await page.locator('.ui-step').count()) >= 1, 'wizard: create modal did not open')

  await pickDropdown(page, '年级', '初一') // junior1
  await pickDropdown(page, '省份', '湖北')
  await clickFooterBtn(page) // -> page 1

  await pickDropdown(page, '科目', '数学')
  await page.locator('.ui-checkbtn', { hasText: '线上' }).click()
  await clickFooterBtn(page) // -> page 2

  // step 2 (score, M8-09): fill a numeric raw score - must round-trip to the backend as a string (PA-1d-F2)
  await page.locator('.step-score__raw .ui-input__ta').nth(0).fill('140')
  await clickFooterBtn(page) // score page -> page 3
  check((await page.locator('.ui-fieldinput', { hasText: '地址' }).count()) === 0, 'wizard: address must be hidden for online-only province')

  // step 3：填一个时间段（周三 18:00-20:00），提交 body 里 expectedTime 必须是 JSON wire 串
  await page.locator('.ts-editor__add').click()
  await page.waitForTimeout(200)
  const tsRow = page.locator('.ts-editor__row').first()
  // AK-C2-F6: the added row's default day must come from DAY_LABELS[0] (single
  // source), not a hardcoded literal (G2: swapping the reference to a wrong
  // weekday turns this assertion red).
  const tsRowDayDefault = await tsRow.locator('.ui-dropdown').textContent()
  check(tsRowDayDefault.includes('周一'), 'ts add row default day = DAY_LABELS[0], got ' + tsRowDayDefault)
  await tsRow.locator('.ui-dropdown').click()
  await page.waitForTimeout(160)
  await page.locator('.ui-droppanel__item', { hasText: '周三' }).click()
  await page.waitForTimeout(160)
  await tsRow.locator('.ui-input__ta').nth(0).fill('18:00')
  await tsRow.locator('.ui-input__ta').nth(1).fill('20:00')
  await clickFooterBtn(page) // -> page 4

  await page.locator('.ui-fieldinput', { hasText: '最低预算' }).locator('.ui-input__ta').fill('100')
  await page.locator('.ui-fieldinput', { hasText: '最高预算' }).locator('.ui-input__ta').fill('200')
  await clickFooterBtn(page) // submit

  await page.waitForTimeout(400)
  check(created.length === 1, 'wizard: POST /api/demands not called')
  check(created[0] && created[0].subject === 'math', 'wizard: payload subject wrong: ' + JSON.stringify(created[0]))
  check(created[0] && created[0].grade === 'junior1', 'wizard: payload grade wrong (expect backend id junior1)')
  check(created[0] && created[0].province === 'hubei', 'wizard: payload province wrong')
  check(created[0] && created[0].teachingMethod === 'online', 'wizard: payload teachingMethod wrong')
  check(created[0] && created[0].budgetMin === 100 && created[0].budgetMax === 200, 'wizard: payload budget must be numbers')
  check(
    created[0] && created[0].expectedTime === JSON.stringify([{ type: 'week', dow: 3, start: '18:00', end: '20:00' }]),
    'wizard: payload expectedTime must be the JSON wire string: ' + JSON.stringify(created[0]),
  )
  check(
    created[0] && created[0].currentScore === '140',
    'wizard: payload currentScore must round-trip as a string (PA-1d-F2), got: ' + JSON.stringify(created[0].currentScore),
  )
  check(created[0] && !('currentScoreFull' in created[0]), 'wizard: payload must NOT include currentScoreFull (backend derives from subject)')
  check((await page.locator('.ui-step').count()) === 0, 'wizard: modal did not close after create')
  check((await page.locator('.demand-grid .demand-card').count()) === 1, 'wizard: created card not shown after reload')

  // ---- edit flow ----
  await page.locator('.demand-grid .demand-card').first().click()
  await page.waitForTimeout(400)
  check((await page.locator('.ui-step').count()) >= 1, 'wizard: edit modal did not open')
  const gradeShown = await page
    .locator('.ui-step__page:visible .ui-fieldinput', { hasText: '年级' })
    .locator('.ui-dropdown__text')
    .textContent()
  check(gradeShown && gradeShown.includes('初一'), 'wizard: edit prefill grade missing: ' + gradeShown)

  // navigate to the last step and change the max budget, then save
  await clickFooterBtn(page) // -> page 1
  await clickFooterBtn(page) // -> page 2
  await clickFooterBtn(page) // -> page 3
  await clickFooterBtn(page) // -> page 4
  await page.locator('.ui-fieldinput', { hasText: '最高预算' }).locator('.ui-input__ta').fill('300')
  await clickFooterBtn(page) // save (PUT)

  await page.waitForTimeout(400)
  check(updated.length === 1, 'wizard: PUT /api/demands/:id not called')
  check(updated[0] && updated[0].budgetMax === 300, 'wizard: PUT budgetMax not updated')
  check((await page.locator('.ui-step').count()) === 0, 'wizard: modal did not close after edit')

  // ---- delete flow ----
  await page.locator('.demand-grid .demand-card').first().click()
  await page.waitForTimeout(400)
  await clickFooterBtn(page) // -> page 1
  await clickFooterBtn(page) // -> page 2
  await clickFooterBtn(page) // -> page 3
  await clickFooterBtn(page) // -> page 4
  await page.locator('.demand-editor__delete .ui-btn').click()
  await page.waitForTimeout(300)
  await page.locator('.ui-alert__btn', { hasText: '确认' }).click()
  await page.waitForTimeout(400)

  check(deleted.length === 1, 'wizard: DELETE /api/demands/:id not called')
  check((await page.locator('.demand-grid .demand-card').count()) === 0, 'wizard: card not removed after delete')
  check(mineCalls >= 3, 'wizard: list not refetched after mutations (F7)')

  await browser.close()
  console.log('  [browser] wizard create/edit/delete ok')
}

/* ---------- 8. Playwright：上海预备班（M8-15，StepGradeProvince 替换逻辑经真实下拉 UI） ---------- */
async function shanghaiPrep() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('shanghai console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('shanghai pageerror: ' + e.message))

  await page.route('**/api/demands/mine', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })
  await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  await page.locator('.demand-plus-slot .ui-btn').click()
  await page.waitForTimeout(400)
  check((await page.locator('.ui-step').count()) >= 1, 'shanghai: create modal did not open')

  // 先选省份=上海（5-4 学制），再读年级下拉渲染选项
  await pickDropdown(page, '省份', '上海')
  const gradeField = page.locator('.ui-step__page:visible .ui-fieldinput', { hasText: '年级' })
  await gradeField.locator('.ui-dropdown').click()
  await page.waitForTimeout(200)
  const gradeTexts = await page.locator('.ui-droppanel__item').allTextContents()
  check(gradeTexts.some((t) => t.includes('预备班')), 'shanghai: grade options must include 预备班 (prep)')
  check(!gradeTexts.some((t) => t.includes('小学六年级')), 'shanghai: grade options must NOT include 小学六年级 (p6 replaced by prep)')
  await page.locator('.ui-droppanel__item', { hasText: '初一' }).click()
  await page.waitForTimeout(200)
  const gradeShown = await gradeField.locator('.ui-dropdown__text').textContent()
  check(gradeShown && gradeShown.includes('初一'), 'shanghai: picked 初一 must show as selected')

  await browser.close()
  console.log('  [browser] shanghai prep-grade options ok')
}

/* ---------- 9. Playwright：>3 卡片网格几何（F-10/G5） ---------- */
async function gridOverflow() {
  const browser = await chromium.launch()

  // 桌面 1440：4 卡 + 加号槽，行优先列定位 2/4/6/2/4
  const dPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  dPage.on('console', (m) => { if (m.type() === 'error') errors.push('grid console: ' + m.text()) })
  dPage.on('pageerror', (e) => errors.push('grid pageerror: ' + e.message))
  await dPage.route('**/api/demands/mine', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: GRID_FIXTURES }) })
  })
  await dPage.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await dPage.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  check((await dPage.locator('.demand-grid .demand-card').count()) === 4, 'grid: expected 4 cards')
  check((await dPage.locator('.demand-plus-slot').count()) === 1, 'grid: plus slot missing')

  const dGeo = await dPage.evaluate(() =>
    [...document.querySelectorAll('.demand-grid > *')].map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return { col: Number(cs.gridColumnStart), left: r.left, right: r.right }
    }),
  )
  check(dGeo.length === 5, 'grid: desktop expected 5 children (4 cards + plus)')
  const expCols = [2, 4, 6, 2, 4]
  dGeo.forEach((g, i) => {
    check(g.col === expCols[i], `grid: desktop child ${i + 1} col ${g.col} != expected ${expCols[i]}`)
    check(g.left >= 0 && g.right <= 1440, `grid: desktop child ${i + 1} out of viewport (${g.left}..${g.right})`)
  })
  await dPage.close()

  // 移动 375：每个子项（含加号槽）水平方向都在视口内，且无横向溢出
  const mPage = await browser.newPage({ viewport: { width: 375, height: 700 } })
  mPage.on('console', (m) => { if (m.type() === 'error') errors.push('grid-m console: ' + m.text()) })
  mPage.on('pageerror', (e) => errors.push('grid-m pageerror: ' + e.message))
  await mPage.route('**/api/demands/mine', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: GRID_FIXTURES }) })
  })
  await mPage.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await mPage.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  const mGeo = await mPage.evaluate(() =>
    [...document.querySelectorAll('.demand-grid > *')].map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right }
    }),
  )
  check(mGeo.length === 5, 'grid: mobile expected 5 children')
  mGeo.forEach((g, i) => {
    check(g.left >= 0 && g.right <= 375, `grid: mobile child ${i + 1} out of viewport (${g.left}..${g.right})`)
  })
  const overflow = await mPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check(!overflow, 'grid: mobile horizontal overflow')
  await mPage.close()

  await browser.close()
  console.log('  [browser] grid >3 cards geometry ok')
}

/* ---------- 10. Playwright：currentScore 字符串往返（PA-1d-F2 守护） ---------- */
async function scorePayload() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push('score console: ' + m.text()) })
  page.on('pageerror', (e) => errors.push('score pageerror: ' + e.message))

  await page.addInitScript(() => sessionStorage.setItem('authToken', 'test-token'))
  await page.goto(BASE + '/preview/my-demands.html', { waitUntil: 'networkidle' })

  // Exercise the real demandPayload through the Vite module graph (the exact function the wizard
  // submit path uses). Mutation guard: reverting demandForm.js to Number(form.currentScore) makes
  // 'B+' -> NaN and '140' -> number, both failing the string assertions below.
  const r = await page.evaluate(async () => {
    const m = await import('/src/modules/my-demands/demandForm.js')
    const base = m.emptyDemandForm()
    return {
      grade: m.demandPayload({ ...base, currentScore: 'B+' }).currentScore,
      numeric: m.demandPayload({ ...base, currentScore: '140' }).currentScore,
      empty: m.demandPayload({ ...base, currentScore: '' }).currentScore,
      missing: m.demandPayload({ ...base, currentScore: null }).currentScore,
    }
  })
  check(r.grade === 'B+', 'score: grade letter currentScore must round-trip as string, got: ' + JSON.stringify(r.grade))
  check(r.numeric === '140', 'score: numeric currentScore must round-trip as string, got: ' + JSON.stringify(r.numeric))
  check(r.empty === null, 'score: empty currentScore must be null, got: ' + JSON.stringify(r.empty))
  check(r.missing === null, 'score: missing currentScore must be null, got: ' + JSON.stringify(r.missing))

  await browser.close()
  console.log('  [browser] currentScore string round-trip ok (PA-1d-F2)')
}

/* ---------- run ---------- */
await unitDatahub()
await unitAuthClearsDatahub()
await unitRegion()
await unitPageRegistration()
await desktop()
await mobile()
await unauthorized()
await wizard()
await shanghaiPrep()
await gridOverflow()
await scorePayload()

if (errors.length) {
  console.log('SMOKE MY-DEMANDS FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log(
    'SMOKE MY-DEMANDS PASS: grid geometry (1440+375), >3-card geometry (F-10/G5), I-33 load/token/cache/invalidate/401, card A2.1 shape + M9 teacher reuse, shanghai prep-grade, wizard I-35 wire contract, currentScore string round-trip (PA-1d-F2), zero console',
  )
}
