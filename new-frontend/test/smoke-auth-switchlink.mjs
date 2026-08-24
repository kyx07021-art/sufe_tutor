/**
 * smoke-auth-switchlink.mjs - AK-A14 flip-to-login link (underlined, centered under title)
 * ---------------------------------------------------------------------
 * - User feedback: "已有账号？去登录" must be an underlined interactive link,
 *   centered directly under the modal title (top of the login/register float —
 *   not buried at the bottom of the form flow).
 * - Design: AuthShell owns the link (variant S1 = underlined text link, same
 *   visual as the AK-A9 register channel switch); AuthModal sets
 *   showSwitchLogin = (scene !== verify) — the verify scene is an authenticated
 *   re-auth flow and must never invite a "go login" escape. The old
 *   register-pane bottom link was removed (W18, single source = AUTH_COPY.HAVE_ACCOUNT).
 * - Asserts (G5): link present + visible + underlined + resting gray-60 +
 *   horizontally centered on the panel + directly under the title (login +
 *   register scenes); ABSENT in verify; register click flips the scene to
 *   login (title swaps to the login scene copy, register pane unmounts).
 * - G2 mutation targets (each deletion must turn its assertion red):
 *   M1 remove the link from AuthShell template -> present/geometry/click tests red
 *   M2 set showSwitchLogin always true -> verify-scene absence test red
 *   M3 move the link out of the shell (back to register-pane) -> login-scene
 *      presence test red
 * - Real dev server (BASE, default :5199), /preview/auth.html harness,
 *   /api/** mocked. Run: node --test test/smoke-auth-switchlink.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const HAVE_ACCOUNT = '已有账号？去登录'
const LOGIN_TITLE = '欢迎回来，请登录'
const GRAY_60 = 'rgb(102, 102, 102)' // --gray-60 light (#666666)

function captureErrors(page, bucket) {
  page.on('console', (m) => m.type() === 'error' && bucket.push('console: ' + m.text()))
  page.on('pageerror', (e) => bucket.push('pageerror: ' + e.message))
}

async function setup(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const errors = []
  captureErrors(page, errors)
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
  )
  await page.goto(BASE + '/preview/auth.html', { waitUntil: 'networkidle' })
  return { page, errors }
}

/** close any open modal, pick the preview scene, open the modal, wait out the
    open transition (--dur-base 300ms) so geometry reads the settled frame. */
async function openScene(page, sceneName) {
  if (await page.locator('.ui-modal__panel').count()) {
    await page.mouse.click(8, 8) // backdrop close
    await page.waitForSelector('.ui-modal__panel', { state: 'detached', timeout: 5000 })
  }
  await page.locator('.auth-preview__row .ui-btn', { hasText: sceneName }).click()
  await page.locator('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' }).click()
  await page.waitForSelector('.ui-modal__panel', { timeout: 5000 })
  await page.waitForTimeout(350)
}

async function switchLinkDims(page) {
  return page.evaluate(() => {
    const link = document.querySelector('.auth-shell__switch-login')
    const panel = document.querySelector('.ui-modal__panel')
    const title = document.querySelector('.auth-shell__title')
    if (!link) return { present: false }
    const lb = link.getBoundingClientRect()
    const pb = panel.getBoundingClientRect()
    const tb = title.getBoundingClientRect()
    const cs = getComputedStyle(link)
    return {
      present: true,
      text: link.textContent.trim(),
      linkCenterX: lb.x + lb.width / 2,
      panelCenterX: pb.x + pb.width / 2,
      linkTop: lb.y,
      titleBottom: tb.y + tb.height,
      underline: cs.textDecorationLine,
      color: cs.color,
    }
  })
}

test('AK-A14: login scene shows the underlined flip-to-login link under the title', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await setup(browser, { width: 1440, height: 900 })
    try {
      await openScene(page, 'login')
      const d = await switchLinkDims(page)
      assert.equal(d.present, true, 'login scene must expose .auth-shell__switch-login')
      assert.equal(d.text, HAVE_ACCOUNT, 'link copy = AUTH_COPY.HAVE_ACCOUNT, got "' + d.text + '"')
      assert.ok(d.underline.includes('underline'), 'link must be underlined, got ' + d.underline)
      assert.equal(d.color, GRAY_60, 'link resting color must be gray-60, got ' + d.color)
      assert.ok(Math.abs(d.linkCenterX - d.panelCenterX) <= 2, 'link must be centered on the panel')
      assert.ok(d.linkTop >= d.titleBottom - 1, 'link must sit directly under the title')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-A14: register scene also exposes the link (same shell position)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await setup(browser, { width: 1440, height: 900 })
    try {
      await openScene(page, 'register')
      const d = await switchLinkDims(page)
      assert.equal(d.present, true, 'register scene must expose .auth-shell__switch-login')
      assert.equal(d.text, HAVE_ACCOUNT, 'register link copy must match, got "' + d.text + '"')
      assert.ok(Math.abs(d.linkCenterX - d.panelCenterX) <= 2, 'register link must be centered too')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-A14: verify scene must NOT show the flip-to-login link (authenticated re-auth flow)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await setup(browser, { width: 1440, height: 900 })
    try {
      await openScene(page, 'verify')
      assert.equal(
        await page.locator('.auth-shell__switch-login').count(),
        0,
        'verify scene must not invite a "go login" escape (G2: showSwitchLogin always-true goes red)',
      )
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test('AK-A14: register flip-to-login switches the scene to login (title swaps, register pane unmounts)', async () => {
  const browser = await chromium.launch()
  try {
    const { page, errors } = await setup(browser, { width: 1440, height: 900 })
    try {
      await openScene(page, 'register')
      assert.equal(await page.locator('.register-pane').count(), 1, 'precondition: register pane mounted')
      await page.locator('.auth-shell__switch-login').click()
      await page.waitForFunction(() => !document.querySelector('.register-pane'), null, { timeout: 5000 })
      await page.waitForTimeout(350) // modal swap transition
      assert.equal(await page.locator('.register-pane').count(), 0, 'flip must unmount the register pane')
      const titleText = await page.textContent('.auth-shell__title')
      assert.equal(titleText, LOGIN_TITLE, 'flip must land on the login scene title, got "' + titleText + '"')
      assert.equal(await page.locator('.auth-shell__switch-login').count(), 1, 'flipped login scene keeps its own switch link')
      assert.deepEqual(errors, [], 'zero console/pageerror expected, got: ' + errors.join(' | '))
    } finally {
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
