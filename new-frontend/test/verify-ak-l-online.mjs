/**
 * verify-ak-l-online.mjs - AK-L batch production verification (no mocks, real backend)
 * -------------------------------------------------------------------------
 * Runs against the LIVE site (https://sufe-tutor.pages.dev). The whole point is
 * the real deployed bundle + real API. A fresh browser context (zero cache) is
 * used per check so nothing rides a warm local state.
 *
 * Covers the AK-L batch that just shipped:
 *  - AK-L-F3  register modal compact (no internal scroll) + puzzle piece glued
 *             to the gap, on 1280x800 and 375x667 (piece geometry derived from
 *             the same PUZZLE_H/SLIDER_H constants as smoke-auth-shell).
 *  - AK-B1    hero = 2 client-entry CTAs, no standalone "已有账号/登录" link.
 *  - AK-A13   register scene title; AK-A14 flip-to-login underlined link.
 *  - AK-L-F1  a REAL login from the hero (qa_student) routes into the student
 *             client and the auth modal closes (no stranded landing).
 *  - zero console/pageerror/requestfailed across every step.
 *
 * Run: node --test test/verify-ak-l-online.mjs   (production reachable)
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'
// AK-N-A4: the piece-vs-gap assertion derives from the same PUZZLE_H/SLIDER_H
// constants as smoke-auth-shell — never a hard-coded px (a 96/32 literal would
// silently misreport the deployed bundle after the AK-N-A4 96->56 shrink).
import { PUZZLE_H, SLIDER_H } from '../src/modules/auth/puzzle/puzzleRender.js'

const BASE = process.env.BASE || 'https://sufe-tutor.pages.dev'
const QA = { username: process.env.QA_USER || 'qa_student', password: process.env.QA_PASS || 'SufeQa2026!' }

function captureErrors(page, bucket) {
  page.on('console', (m) => m.type() === 'error' && bucket.push('console: ' + m.text()))
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message))
  page.on('requestfailed', (r) => bucket.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')))
}

async function gotoHome(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const errors = []
  captureErrors(page, errors)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.landing-hero__btn', { timeout: 15000 })
  return { page, errors }
}

/** Drag the puzzle knob to a normalized offset (0..1); CaptchaPuzzle exposes its
    current offset + target via window.__authPuzzleDebug (local pass, AK-A1a). */
async function dragPuzzleTo(page, offset) {
  const knob = page.locator('.captcha-puzzle__knob')
  await knob.waitFor({ state: 'visible', timeout: 5000 })
  const box = await knob.boundingBox()
  if (!box) throw new Error('puzzle knob missing')
  const dbg = await page.evaluate(() => window.__authPuzzleDebug || { offset: 0 })
  const scale = await page.evaluate(() => {
    const cv = document.querySelector('.captcha-puzzle__canvas')
    return cv ? cv.clientWidth / 280 : 1
  })
  const current = (dbg.offset || 0) * 240 * scale
  const desired = Math.max(0, Math.min(1, offset)) * 240 * scale
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + (desired - current), box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
}

/** Open the register modal from the hero and assert it fits the viewport with
    the puzzle fully visible and the piece glued to the gap (AK-L-F3). */
async function assertRegisterFits(page, label, viewport) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(350)
  const geo = await page.evaluate(() => {
    const body = document.querySelector('.auth-shell__body')
    const puzzle = document.querySelector('.captcha-puzzle')
    const pr = puzzle ? puzzle.getBoundingClientRect() : null
    return {
      scrollH: body ? body.scrollHeight : -1,
      clientH: body ? body.clientHeight : -1,
      puzzleBottom: pr ? Math.round(pr.bottom) : -1,
      vh: window.innerHeight,
    }
  })
  assert.ok(geo.scrollH <= geo.clientH + 1, label + ': register body must not scroll (scrollH ' + geo.scrollH + ' > clientH ' + geo.clientH + ')')
  assert.ok(geo.puzzleBottom <= geo.vh, label + ': puzzle must be fully inside the viewport (bottom ' + geo.puzzleBottom + ' > vh ' + geo.vh + ')')
  // piece-vs-gap: derived (PUZZLE_H - SLIDER_H)/2 * scale — same constants as
  // smoke-auth-shell; a desynced hard-coded px (the aa57764 defect) turns red.
  const piece = await page.evaluate(() => {
    const el = document.querySelector('.captcha-puzzle__piece')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { top: parseFloat(cs.top), height: parseFloat(cs.height) }
  })
  const scale = await page.evaluate(() => {
    const cv = document.querySelector('.captcha-puzzle__canvas')
    return cv ? cv.clientWidth / 280 : 1
  })
  const cutY = (PUZZLE_H - SLIDER_H) / 2
  assert.ok(piece && Math.abs(piece.top - cutY * scale) <= 1, label + ': piece top must sit on the gap (cutY ' + cutY + ' x scale ' + scale.toFixed(2) + ' = ' + (cutY * scale).toFixed(1) + ', got ' + (piece ? piece.top.toFixed(1) : 'null') + ')')
  assert.ok(piece && Math.abs(piece.height - SLIDER_H * scale) <= 1, label + ': piece height must match SLIDER_H (' + (SLIDER_H * scale).toFixed(1) + ', got ' + (piece ? piece.height.toFixed(1) : 'null') + ')')
}

test('root boots the AK-L build with zero console/pageerror', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoHome(browser, { width: 1440, height: 900 })
    try {
      const children = await page.evaluate(() => document.querySelector('#app')?.children.length || 0)
      assert.ok(children > 0, 'app must mount (#app children=' + children + ')')
      assert.deepEqual(errors, [], 'zero console/pageerror/requestfailed, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-B1: hero = two client-entry CTAs, no standalone login link', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoHome(browser, { width: 1440, height: 900 })
    try {
      const ctas = await page.locator('.landing-hero__btn').count()
      assert.equal(ctas, 2, 'hero must have exactly 2 CTAs, got ' + ctas)
      const heroText = await page.locator('.landing-hero').innerText()
      assert.ok(!heroText.includes('已有账号'), 'hero must not carry a standalone login link (AK-B1), got: ' + heroText.slice(0, 120))
      assert.deepEqual(errors, [], 'zero console/pageerror/requestfailed, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-L-F3: register modal compact + puzzle piece glued on 1280x800 and 375x667', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoHome(browser, { width: 1280, height: 800 })
    try {
      await page.click('.landing-hero__btn[data-cap="enter.student"]')
      await page.waitForSelector('.ui-modal', { timeout: 8000 })
      await assertRegisterFits(page, 'AK-L-F3 desktop 1280x800', { width: 1280, height: 800 })
      await assertRegisterFits(page, 'AK-L-F3 mobile 375x667', { width: 375, height: 667 })
      assert.deepEqual(errors, [], 'zero console/pageerror/requestfailed, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

/** Open the identity-auth modal from the hero as the register scene (AK-A13). */
async function openRegisterModal(page) {
  await page.click('.landing-hero__btn[data-cap="enter.student"]')
  await page.waitForSelector('.ui-modal', { timeout: 8000 })
  await page.waitForTimeout(350)
}

/** Flip to the login scene, complete a REAL password login (credentials + puzzle
    -> confirm), return once the router has left the landing (AK-L-F1). Assumes
    the auth modal is already open in the register scene. */
async function completePasswordLogin(page) {
  await page.click('.auth-shell__switch-login')
  await page.waitForTimeout(300)
  await page.locator('.method-switch .ui-btn', { hasText: '密码验证' }).click()
  await page.locator('.password-row__identifier .ui-input__ta').fill(QA.username)
  await page.locator('.password-row__password .ui-input__native').fill(QA.password)
  await dragPuzzleTo(page, await page.evaluate(() => (window.__authPuzzleDebug || {}).target))
  await page.waitForTimeout(300)
  const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
  await confirmBtn.waitFor({ state: 'visible', timeout: 8000 })
  assert.ok(!(await confirmBtn.isDisabled()), 'confirm must enable after credential + puzzle')
  await confirmBtn.click()
  await page.waitForFunction(() => {
    const r = window.__APP__?.router?.currentRoute?.value
    return r && r.path !== '/'
  }, null, { timeout: 12000 })
}

/** Login as the QA account from a fresh landing (CTA -> register -> flip ->
    password -> puzzle -> confirm -> routed). */
async function loginAsQA(page) {
  await openRegisterModal(page)
  await completePasswordLogin(page)
}

test('AK-A13/A14 + AK-L-F1: register scene title + flip-to-login + REAL login routes into the client', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoHome(browser, { width: 1440, height: 900 })
    try {
      // CTA -> register scene (AK-A13 title)
      await openRegisterModal(page)
      const regTitle = (await page.locator('.auth-shell__title').innerText()).trim()
      assert.equal(regTitle, '欢迎来到平台，请注册账号', 'register scene title (AK-A13), got: ' + regTitle)
      // AK-A14 flip-to-login underlined link -> login scene
      await page.click('.auth-shell__switch-login')
      await page.waitForTimeout(300)
      const loginTitle = (await page.locator('.auth-shell__title').innerText()).trim()
      assert.equal(loginTitle, '欢迎回来，请登录', 'login scene title, got: ' + loginTitle)
      // AK-L-F1: complete a REAL login (modal already open, no second CTA click)
      await completePasswordLogin(page)
      const state = await page.evaluate(() => ({
        path: window.__APP__.router.currentRoute.value.path,
        roles: window.__APP__.router.currentRoute.value.meta.roles || [],
        user: window.__APP__.authStore.user?.username || null,
      }))
      assert.ok(state.roles.includes('student'), 'post-login must land on a student-gated route (AK-L-F1), got ' + JSON.stringify(state))
      assert.equal(state.user, QA.username, 'logged-in user must be the QA account, got ' + state.user)
      // modal closes after its transition
      await page.waitForFunction(() => document.querySelectorAll('.ui-modal').length === 0, null, { timeout: 6000 })
      assert.equal(await page.locator('.ui-modal').count(), 0, 'auth modal must close after login')
      assert.deepEqual(errors, [], 'zero console/pageerror/requestfailed, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-L-F2: logged-in C4 more menu carries 退出登录 and it returns to the landing', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await gotoHome(browser, { width: 1440, height: 900 })
    try {
      await loginAsQA(page)
      await page.waitForFunction(() => document.querySelectorAll('.ui-modal').length === 0, null, { timeout: 6000 })
      // open the C4 more dropdown from the user area (production shell wiring)
      await page.click('.user-area-dropdown')
      const menu = page.locator('.m5-more')
      await menu.waitFor({ state: 'visible', timeout: 5000 })
      const rows = await menu.locator('.m5-more__item').count()
      assert.equal(rows, 4, 'C4 more menu must have 4 rows (AK-L-F2), got ' + rows)
      const logoutRow = menu.locator('.m5-more__item', { hasText: '退出登录' })
      assert.equal(await logoutRow.count(), 1, '4th row must be 退出登录 (AK-L-F2)')
      const routeBackAt = Date.now()
      await logoutRow.click()
      // logged-out: back on the landing
      await page.waitForFunction(() => window.__APP__.router.currentRoute.value.path === '/', null, { timeout: 8000 })
      const routeLag = Date.now() - routeBackAt
      // local auth state must clear (F7) — poll so a slow network revocation does
      // not race the assertion; the timing below records whether the clear lags
      // the route change (a real F7 gap: store awaits the network first).
      const storeClearedAt = Date.now()
      await page.waitForFunction(() => !window.__APP__.authStore.token && !window.__APP__.authStore.user, null, { timeout: 8000 })
      const clearLag = Date.now() - storeClearedAt
      // eslint-disable-next-line no-console
      console.log('AK-L-F2 timing: routeBack+' + routeLag + 'ms, storeClear+' + clearLag + 'ms after poll start')
      assert.deepEqual(errors, [], 'zero console/pageerror/requestfailed, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
