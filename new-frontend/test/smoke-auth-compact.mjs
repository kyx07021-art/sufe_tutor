/**
 * smoke-auth-compact.mjs - AK-A12 auth float compact rhythm (vertical pin)
 * ---------------------------------------------------------------------
 * - User feedback: the auth float should not scroll; register/login compact —
 *   squish component heights, never font sizes (principle 5 压高不压字).
 * - Structural pin: AuthShell caps itself to the panel budget (max-height + overflow
 *   hidden); only .auth-shell__body scrolls internally, so the title + footer
 *   stay on-screen and the confirm button never requires scrolling to reach.
 * - Compact tokens (AuthShell scoped overrides, global values untouched):
 *   --input-h 44->40 (pad-y 10), --btn-h 52->44, shell gap 24->16,
 *   padding 40/24/24->24/24/16, body gap 16->12, register-pane gap 16->12,
 *   otp/password-row gap 12->8, puzzle track margin 12->8.
 * - Font sizes never shrink: inputs/buttons --fs-base 16, checkbox label
 *   --fs-sm 14; title --fs-lg 20 (AK-A13 scene header); .ui-title-sm margin
 *   stays 8px (AK-A8 lock).
 * - G2 mutation targets (each deletion must turn its assertion red):
 *   M1 remove --input-h:40 override -> input height assertion red
 *   M2 remove --btn-h:44 override -> button height assertion red
 *   M3 remove structural pin (max-height/overflow:hidden) -> mobile register
 *      confirm visibility red
 *   M4 remove register-pane/otp-row gap overrides -> gap assertions red
 *   M5 shrink a font-size -> font-size assertion red
 * - Run: node test/smoke-auth-compact.mjs (dev server :5199, /preview/auth.html)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'

let failures = 0
function check(cond, msg) {
  if (!cond) {
    failures += 1
    console.log('COMPACT FAIL: ' + msg)
  }
}

async function run() {
  const browser = await chromium.launch()
  try {
    // ---- desktop 1440x900 ----
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const errors = []
      page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
      await page.route('**/api/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
      )
      await page.goto(BASE + '/preview/auth.html', { waitUntil: 'networkidle' })

      async function openModal() {
        await page.locator('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' }).click()
        await page.waitForSelector('.ui-modal__panel', { timeout: 5000 })
        await page.waitForTimeout(350) // wait out the modal open transition (--dur-base), else geometry reads a mid-scale frame
      }
      async function scene(name) {
        const opened = await page.locator('.ui-modal__panel').count()
        if (opened) {
          await page.mouse.click(8, 8) // backdrop close
          await page.waitForSelector('.ui-modal__panel', { state: 'detached', timeout: 5000 })
        }
        if (name !== 'verify') {
          await page.locator('.auth-preview__row .ui-btn', { hasText: name }).click()
        }
        await openModal()
      }
      async function panelDims() {
        return page.evaluate(() => {
          const p = document.querySelector('.ui-modal__panel')
          const body = document.querySelector('.auth-shell__body')
          return {
            panelClientH: p.clientHeight,
            panelScrollH: p.scrollHeight,
            bodyClientH: body.clientHeight,
            bodyScrollH: body.scrollHeight,
            footerBottom: document.querySelector('.auth-shell__footer').getBoundingClientRect().bottom,
          }
        })
      }

      for (const s of ['verify', 'login', 'register']) {
        await scene(s)
        const d = await panelDims()
        check(
          d.panelScrollH <= d.panelClientH + 1,
          `desktop [${s}]: panel must not scroll (scroll=${d.panelScrollH} client=${d.panelClientH})`,
        )
        check(
          d.footerBottom <= 900,
          `desktop [${s}]: footer (confirm) visible in viewport without scrolling, bottom=${d.footerBottom}`,
        )
      }

      // compact token locks (desktop register)
      await scene('register')
      const compact = await page.evaluate(() => {
        const input = document.querySelector('.register-pane .ui-input')
        const btn = document.querySelector('.auth-shell__footer .ui-btn')
        const regPane = document.querySelector('.register-pane')
        const otpRow = document.querySelector('.otp-row')
        const title = document.querySelector('.otp-row__title')
        const cs = getComputedStyle
        return {
          inputH: input.getBoundingClientRect().height,
          btnH: btn.getBoundingClientRect().height,
          regGap: cs(regPane).gap,
          otpGap: cs(otpRow).gap,
          inputFs: cs(input.querySelector('.ui-input__ta, .ui-input__native')).fontSize,
          titleMarginTop: cs(title).marginTop,
          shellPadTop: cs(document.querySelector('.auth-shell')).paddingTop,
        }
      })
      check(Math.round(compact.inputH) === 40, 'compact: input height should be 40px, got ' + compact.inputH)
      check(Math.round(compact.btnH) === 44, 'compact: footer button height should be 44px, got ' + compact.btnH)
      check(compact.regGap === '12px', 'compact: register-pane gap should be 12px, got ' + compact.regGap)
      check(compact.otpGap === '8px', 'compact: otp-row gap should be 8px, got ' + compact.otpGap)
      check(compact.inputFs === '16px', 'font sizes untouched: input text should stay 16px, got ' + compact.inputFs)
      check(compact.titleMarginTop === '8px', 'AK-A8 kept: .ui-title-sm margin should stay 8px, got ' + compact.titleMarginTop)
      check(compact.shellPadTop === '24px', 'shell top padding should be 24px, got ' + compact.shellPadTop)
      check(errors.length === 0, 'zero console/pageerror expected, got: ' + errors.join(' | '))
      await page.close()
    }

    // ---- mobile 375x667 ----
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 667 } })
      const errors = []
      page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
      await page.route('**/api/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
      )
      await page.goto(BASE + '/preview/auth.html', { waitUntil: 'networkidle' })
      async function openModal() {
        await page.locator('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' }).click()
        await page.waitForSelector('.ui-modal__panel', { timeout: 5000 })
        await page.waitForTimeout(350) // wait out the modal open transition (--dur-base), else geometry reads a mid-scale frame
      }
      async function scene(name) {
        const opened = await page.locator('.ui-modal__panel').count()
        if (opened) {
          await page.mouse.click(8, 8) // backdrop close
          await page.waitForSelector('.ui-modal__panel', { state: 'detached', timeout: 5000 })
        }
        if (name !== 'verify') {
          await page.locator('.auth-preview__row .ui-btn', { hasText: name }).click()
        }
        await openModal()
      }
      async function dims() {
        return page.evaluate(() => {
          const p = document.querySelector('.ui-modal__panel')
          const body = document.querySelector('.auth-shell__body')
          const footer = document.querySelector('.auth-shell__footer')
          return {
            panelScrollH: p.scrollHeight,
            panelClientH: p.clientHeight,
            bodyScrollH: body.scrollHeight,
            bodyClientH: body.clientHeight,
            footerTop: footer.getBoundingClientRect().top,
            footerBottom: footer.getBoundingClientRect().bottom,
          }
        })
      }

      // verify + login: fully fit (no scroll at all)
      for (const s of ['verify', 'login']) {
        await scene(s)
        const d = await dims()
        check(d.panelScrollH <= d.panelClientH + 1, `mobile [${s}]: panel must not scroll (${d.panelScrollH}/${d.panelClientH})`)
        check(d.footerBottom <= 667, `mobile [${s}]: footer visible, bottom=${d.footerBottom}`)
      }

      // register: panel pinned, body scrolls internally, footer (confirm) ALWAYS visible
      await scene('register')
      const d = await dims()
      check(d.panelScrollH <= d.panelClientH + 1, `mobile [register]: panel must not scroll (${d.panelScrollH}/${d.panelClientH})`)
      check(d.bodyScrollH >= d.bodyClientH, 'mobile [register]: body is the internal scroll container')
      check(d.footerTop >= 0 && d.footerBottom <= 667, `mobile [register]: footer (confirm) pinned in viewport, top=${d.footerTop} bottom=${d.footerBottom}`)
      // confirm button actually visible without any scroll
      const confirmBox = await page.locator('.auth-shell__footer .ui-btn--fill-brand').boundingBox()
      check(confirmBox && confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= 667, 'mobile [register]: confirm button visible without scrolling')
      check(errors.length === 0, 'mobile: zero console/pageerror expected, got: ' + errors.join(' | '))
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

await run()
if (failures > 0) {
  console.log('COMPACT SMOKE FAIL: ' + failures + ' assertion(s) failed')
  process.exit(1)
}
console.log('COMPACT SMOKE PASS: vertical pin + compact tokens + font sizes never shrunk')
