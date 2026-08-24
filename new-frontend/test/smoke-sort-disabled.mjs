/**
 * smoke-sort-disabled.mjs - SortBar/OrderToggle disabled-under-loading (hierarchy tree HIGH-1)
 * --------------------------------------------------------------------------------------------
 * Root loading state -> leaf controls stop: while a page is loading its data, the
 * sort tabs (SortBar) and the order toggle (OrderToggle) must be non-interactive,
 * show gray-50 text with no fill/hover animation, and carry the native disabled
 * attribute (accessible + click-suppressed). The SecondBar (teacher-square) and the
 * B1 demand plaza (teacher-side) forward their loading flag to the shared leaves.
 *
 * 1. B1 demand plaza (teacher-side-harness.html): delay /api/demands -> during loading
 *    every sort tab + the order toggle are disabled (native attr + is-disabled class),
 *    text gray-50, cursor default, active-tab fill cleared, hover adds no fill, and a
 *    synthetic click is a no-op (active tab stays 匹配度, order stays desc). After the
 *    load resolves the controls re-enable and a real click changes the sort.
 * 2. Teacher square (harness-teacher-square.html): delay /api/teachers -> the SecondBar
 *    forwards disabled to OrderToggle + SortBar (+ the filter UiButton) during loading,
 *    and re-enables on ready.
 * 3. Mutation guards: drop the disabled wiring and the loading-phase click/hover/attr
 *    assertions turn red (the exact scenario the tree wants locked).
 *
 * Run: node test/smoke-sort-disabled.mjs  (self-starts a Vite dev server unless BASE)
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath, URL } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const errors = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => errors.push(m)

const GRAY_50 = 'rgb(128, 128, 128)'
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** Route that delays only the FIRST matching request, then answers instantly. */
function delayFirst(ctx, pattern, body) {
  let hits = 0
  return ctx.route(pattern, async (route) => {
    hits += 1
    if (hits === 1) await new Promise((r) => setTimeout(r, 2000))
    await route.fulfill({ status: 200, contentType: 'application/json', body })
  })
}

/** Dispatch a real click event (bubbling) regardless of the native disabled attribute,
 *  so the Vue handler is exercised directly (the JS disabled guard is what must hold). */
function syntheticClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  }, selector)
}

async function assertDisabledDuringLoad(page, label) {
  const tabs = page.locator('.sort-bar__tab')
  const n = await tabs.count()
  if (n < 2) { fail(`${label}: expected >= 2 sort tabs, got ${n}`); return }

  const allDisabled = await tabs.evaluateAll((els) => els.every((el) => el.disabled && el.classList.contains('is-disabled')))
  if (!allDisabled) fail(`${label}: every sort tab must be native-disabled + is-disabled during loading`)
  else ok(`${label}: sort tabs native-disabled during loading`)

  const firstTab = tabs.first()
  const firstColor = await firstTab.evaluate((el) => getComputedStyle(el).color)
  if (firstColor !== GRAY_50) fail(`${label}: sort tab text gray-50 during loading, got ${firstColor}`)
  else ok(`${label}: sort tab text gray-50`)

  const cursor = await firstTab.evaluate((el) => getComputedStyle(el).cursor)
  if (cursor !== 'default') fail(`${label}: sort tab cursor default during loading, got ${cursor}`)
  else ok(`${label}: sort tab cursor default`)

  // active tab must not show its gray-10 fill while disabled (mutation: drop
  // background:transparent from .is-disabled -> active tab turns gray-10 -> red)
  const activeBg = await page.locator('.sort-bar__tab.is-active').evaluate((el) => getComputedStyle(el).backgroundColor)
  if (activeBg !== TRANSPARENT) fail(`${label}: active tab fill must clear during loading, got ${activeBg}`)
  else ok(`${label}: active tab fill cleared (no fill animation)`)

  const toggle = page.locator('.order-toggle')
  if ((await toggle.count()) !== 1) { fail(`${label}: expected one order toggle`); return }
  const toggleDisabled = await toggle.evaluate((el) => el.disabled && el.classList.contains('is-disabled'))
  if (!toggleDisabled) fail(`${label}: order toggle must be native-disabled during loading`)
  else ok(`${label}: order toggle native-disabled`)

  const toggleColor = await toggle.evaluate((el) => getComputedStyle(el).color)
  if (toggleColor !== GRAY_50) fail(`${label}: order toggle gray-50 during loading, got ${toggleColor}`)
  else ok(`${label}: order toggle gray-50`)

  // hover must add no fill (mutation: drop .is-disabled:hover background -> gray-15 -> red)
  await page.mouse.move(4, 4)
  await page.waitForTimeout(80)
  const bgBefore = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
  await toggle.hover()
  await page.waitForTimeout(300)
  const bgAfter = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
  if (bgBefore !== TRANSPARENT || bgAfter !== TRANSPARENT) {
    fail(`${label}: order toggle hover must keep transparent fill while disabled, before=${bgBefore} after=${bgAfter}`)
  } else ok(`${label}: order toggle hover adds no fill`)
}

async function assertClickIsNoOp(page, label) {
  // B1 default sort is 匹配度 (active); clicking the other tab while disabled is a no-op
  const before = await page.locator('.sort-bar__tab.is-active').first().textContent()
  await syntheticClick(page, '.sort-bar__tab:not(.is-active)')
  await page.waitForTimeout(120)
  const after = await page.locator('.sort-bar__tab.is-active').first().textContent()
  if (before !== after) fail(`${label}: disabled sort click must be a no-op, active went ${before} -> ${after}`)
  else ok(`${label}: disabled sort click no-op (active tab unchanged)`)

  const pressedBefore = await page.locator('.order-toggle').evaluate((el) => el.getAttribute('aria-pressed'))
  await syntheticClick(page, '.order-toggle')
  await page.waitForTimeout(120)
  const pressedAfter = await page.locator('.order-toggle').evaluate((el) => el.getAttribute('aria-pressed'))
  if (pressedBefore !== pressedAfter) fail(`${label}: disabled order click must be a no-op, aria-pressed ${pressedBefore} -> ${pressedAfter}`)
  else ok(`${label}: disabled order click no-op`)
}

async function waitEnabled(page, label) {
  try {
    await page.locator('.sort-bar__tab').first().waitForFunction((el) => !el.disabled, null, { timeout: 5000 })
    await page.locator('.order-toggle').first().waitForFunction((el) => !el.disabled, null, { timeout: 5000 })
  } catch (e) {
    fail(`${label}: controls never re-enabled after load: ${e.message}`)
    return false
  }
  const stillDisabled = await page.locator('.sort-bar__tab').first().evaluate((el) => el.classList.contains('is-disabled'))
  if (stillDisabled) fail(`${label}: is-disabled class should clear after load`)
  else ok(`${label}: controls re-enabled after load`)
  return true
}

async function b1Checks(browser, base) {
  console.log('— B1 demand plaza: SortBar/OrderToggle disabled under loading —')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrs = []
  page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()))
  page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message))

  const items = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    subject: i % 2 ? 'math' : 'english',
    grade: '高二',
    teachingMethod: 'offline',
    currentScore: 80 + i,
    preferredGender: i % 2 ? 'male' : 'female',
    budgetMin: 100 + i * 20,
    budgetMax: 200 + i * 20,
    studentName: `学生${i + 1}`,
    matchScore: 90 - i,
    matchCount: 2,
  }))
  await delayFirst(ctx, '**/api/demands*', JSON.stringify({ items, total: items.length }))

  await page.goto(base + '/test/teacher-side-harness.html', { waitUntil: 'load' })
  await page.locator('.sort-bar__tab').first().waitFor({ timeout: 8000 })

  await assertDisabledDuringLoad(page, 'B1')
  await assertClickIsNoOp(page, 'B1')

  if (await waitEnabled(page, 'B1')) {
    // regression: after load a real click changes the sort
    await page.locator('.sort-bar__tab', { hasText: '报价' }).click()
    await page.waitForTimeout(150)
    const active = await page.locator('.sort-bar__tab.is-active').first().textContent()
    if (active !== '报价') fail(`B1: after load clicking 报价 must select it, active=${active}`)
    else ok('B1: after load sort click re-enabled (regression)')
  }

  if (consoleErrs.length) fail('B1 console/pageerror: ' + consoleErrs.join(' | '))
  else ok('B1 zero console/pageerror')
  await ctx.close()
}

async function tsqChecks(browser, base) {
  console.log('— Teacher square: SecondBar forwards disabled to sort/order/filter under loading —')
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrs = []
  page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()))
  page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message))

  const GOOD = JSON.stringify({
    items: [{ teacherId: 1, name: '李老师', rating: 4.5, reviewCount: 2, priceMin: 100, priceMax: 200, subjects: [{ subject: 'math' }] }],
    total: 1,
  })
  await delayFirst(ctx, '**/api/teachers*', GOOD)
  await page.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))

  await page.goto(base + '/test/harness-teacher-square.html', { waitUntil: 'load' })
  await page.locator('.second-bar .sort-bar__tab').first().waitFor({ timeout: 8000 })

  const tabDisabled = await page.locator('.second-bar .sort-bar__tab').evaluateAll((els) => els.every((el) => el.disabled))
  if (!tabDisabled) fail('tsq: SecondBar sort tabs must be disabled during loading')
  else ok('tsq: SecondBar sort tabs disabled during loading')

  const toggleDisabled = await page.locator('.second-bar .order-toggle').evaluate((el) => el.disabled)
  if (!toggleDisabled) fail('tsq: SecondBar order toggle must be disabled during loading')
  else ok('tsq: SecondBar order toggle disabled during loading')

  const filterDisabled = await page.locator('.second-bar__filter').evaluate((el) => el.disabled)
  if (!filterDisabled) fail('tsq: SecondBar filter button must be disabled during loading')
  else ok('tsq: SecondBar filter button disabled during loading')

  await assertClickIsNoOp(page, 'tsq')

  try {
    await page.locator('.second-bar .sort-bar__tab').first().waitForFunction((el) => !el.disabled, null, { timeout: 5000 })
    ok('tsq: controls re-enabled after load')
  } catch {
    fail('tsq: controls never re-enabled after load')
  }

  if (consoleErrs.length) fail('tsq console/pageerror: ' + consoleErrs.join(' | '))
  else ok('tsq zero console/pageerror')
  await ctx.close()
}

/* ============================ main ============================ */
let server = null
let base = process.env.BASE
if (!base) {
  server = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}

const browser = await chromium.launch()
try {
  await b1Checks(browser, base)
  await tsqChecks(browser, base)
} finally {
  await browser.close()
  if (server) await server.close()
}

if (errors.length) {
  console.log('SORT-DISABLED SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('SORT-DISABLED SMOKE PASS')
}
