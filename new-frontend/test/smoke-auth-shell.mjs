/**
 * M6 C5 identity-auth shell smoke test
 * -------------------------------------------------------
 * Node unit (state machine, no browser):
 *   - Four contactMasks combos -> default method (有手机→手机 / 仅邮箱→邮箱 / 永不默认密码 / 全无→密码兜底)
 *   - switchMethod clears the credential buffer + bumps resetTick; invalid/same no-op; scene change resets.
 * Browser (dev server :5199, /preview/auth.html harness, Playwright):
 *   - Shell open/close: title "请验证身份", method title "手机验证码", cancel button, confirm gray-state.
 *   - Backdrop click closes / cancel closes / no residue (no .ui-modal, body scroll unlocked).
 *   - Blocked paths: panel-interior click does NOT close; a covered behind-button is NOT triggered;
 *     dragging the puzzle to a wrong offset FAILs (shake + tip), to the target PASSes locally
 *     (AK-A1a: isPuzzleAligned in-browser, zero /api/captcha/verify calls).
 *   - Confirm gate: disabled until (6-digit code + puzzle passed) -> enabled -> confirm (I-06 mocked) closes.
 *   - 375px mobile: zero horizontal overflow; title/cancel/puzzle inside the viewport.
 *   - Zero console errors / pageerrors / CSP violations.
 * Run: node test/smoke-auth-shell.mjs (requires dev server on port 5199; BASE overridable)
 */
import { chromium } from 'playwright'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref, nextTick } from 'vue'
import {
  AUTH_SCENES,
  AUTH_METHODS,
  defaultMethod,
  availableMethods,
  otherMethods,
  isOtp,
} from '../src/modules/auth/authMethod.js'
import { useAuthMethod } from '../src/modules/auth/useAuthMethod.js'

/* ================================================================== *
 * 1. Node unit: state machine (four contactMasks combos + switch reset)
 * ================================================================== */
function assert(cond, msg) {
  if (!cond) {
    console.log('AUTH STATE MACHINE FAIL: ' + msg)
    process.exit(1)
  }
}

// four combos -> default method
const FOUR_CASES = [
  [{ phone: true, email: true }, AUTH_METHODS.OTP_PHONE],
  [{ phone: true, email: false }, AUTH_METHODS.OTP_PHONE],
  [{ phone: false, email: true }, AUTH_METHODS.OTP_EMAIL],
  [{ phone: false, email: false }, AUTH_METHODS.PASSWORD],
]
for (const [masks, expected] of FOUR_CASES) {
  const got = defaultMethod(AUTH_SCENES.VERIFY, masks)
  assert(got === expected, `defaultMethod(${JSON.stringify(masks)}) = ${got}, expected ${expected}`)
}

// availableMethods shape
const avail = availableMethods(AUTH_SCENES.VERIFY, { phone: true, email: false })
assert(
  avail.length === 2 && avail[0] === AUTH_METHODS.OTP_PHONE && avail[1] === AUTH_METHODS.PASSWORD,
  'availableMethods(phone only) should be [otp_phone, password]',
)
assert(
  availableMethods(AUTH_SCENES.REGISTER, {}).length === 2,
  'register available should be exactly [otp_phone, otp_email]',
)

// otherMethods = pick-any-two (exactly the two not current)
const others = otherMethods(AUTH_SCENES.VERIFY, { phone: true, email: true }, AUTH_METHODS.OTP_PHONE)
assert(others.length === 2, 'otherMethods should return two alternatives')
assert(!others.includes(AUTH_METHODS.OTP_PHONE), 'otherMethods should not include current')

// login scene (PA-1h3-F1): both code channels + password always offered,
// independent of contactMasks — a user's bound channels are unknown before login.
const loginEmpty = availableMethods(AUTH_SCENES.LOGIN, {})
assert(
  loginEmpty.length === 3 &&
    loginEmpty[0] === AUTH_METHODS.OTP_PHONE &&
    loginEmpty[1] === AUTH_METHODS.OTP_EMAIL &&
    loginEmpty[2] === AUTH_METHODS.PASSWORD,
  'login available should be [otp_phone, otp_email, password] even with empty contactMasks, got: ' + loginEmpty.join(','),
)
const loginMasked = availableMethods(AUTH_SCENES.LOGIN, { phone: false, email: false })
assert(
  loginMasked.length === 3 && loginMasked[0] === AUTH_METHODS.OTP_PHONE,
  'login available should ignore contactMasks (both code channels + password), got: ' + loginMasked.join(','),
)
assert(
  defaultMethod(AUTH_SCENES.LOGIN, {}) === AUTH_METHODS.OTP_PHONE,
  'login default should be otp_phone (first non-password in the always-on set)',
)
// verify scene STILL follows contactMasks (bound contacts known) — no regression
assert(
  availableMethods(AUTH_SCENES.VERIFY, {}).join(',') === AUTH_METHODS.PASSWORD,
  'verify with empty masks should stay [password] (contactMasks still gates verify)',
)

// useAuthMethod: switch resets credential, invalid/same no-op, scene change resets
const scene = ref(AUTH_SCENES.VERIFY)
const masks = ref({ phone: true, email: true })
const am = useAuthMethod(scene, masks)
assert(am.current.value === AUTH_METHODS.OTP_PHONE, 'initial default should be otp_phone')
am.credential.value = '123456'
am.switchMethod(AUTH_METHODS.OTP_EMAIL)
assert(am.current.value === AUTH_METHODS.OTP_EMAIL, 'switch should change current')
assert(am.credential.value === '', 'switch should clear the credential buffer')
assert(am.resetTick.value === 1, 'switch should bump resetTick')

const tickBefore = am.resetTick.value
am.switchMethod(AUTH_METHODS.OTP_EMAIL) // same -> no-op
assert(am.resetTick.value === tickBefore, 'switch to same method should no-op')
am.switchMethod('bogus') // invalid -> no-op
assert(am.current.value === AUTH_METHODS.OTP_EMAIL, 'invalid method switch should no-op')

scene.value = AUTH_SCENES.REGISTER
await nextTick()
assert(am.current.value === AUTH_METHODS.OTP_PHONE, 'scene change should recompute default (register -> phone)')
assert(am.credential.value === '', 'scene change should clear credential')
assert(isOtp(AUTH_METHODS.OTP_PHONE) && !isOtp(AUTH_METHODS.PASSWORD), 'isOtp classification')

// PA-2-F7: AUTH_SCENES (english) -> server OTP scene literal (OTP_SCENES mirror).
// The server whitelists scene against Object.values(OTP_SCENES); without this
// translation the request silently falls back to '' (mail template scene empty).
// otpSceneFor is the named function useOtpSend calls at the boundary, so these
// assertions lock the consumption path (G1) — an inline-table regression where
// useOtpSend stops translating would not change the table but would break here.
const { otpSceneFor, buildOtpRequestBody } = await import('../src/constants/m-auth.js')
assert(otpSceneFor(AUTH_SCENES.LOGIN) === '登录验证', 'login -> server 登录验证')
assert(otpSceneFor(AUTH_SCENES.REGISTER) === '注册验证', 'register -> server 注册验证')
assert(otpSceneFor(AUTH_SCENES.VERIFY) === '绑定验证', 'verify -> server 绑定验证 (BIND semantics)')
assert(otpSceneFor('bogus') === '', 'unknown scene maps to \'\' (server falls back cleanly)')
// Consumption-path lock (F7 audit observation): the OTP send body must translate
// at the boundary. Asserting buildOtpRequestBody (the function useOtpSend calls)
// directly catches a regression where the send chain stops translating (an
// inline-table test of OTP_SCENE_OF alone would not).
assert(
  buildOtpRequestBody({ channel: 'sms', scene: AUTH_SCENES.REGISTER }).scene === '注册验证',
  'useOtpSend body.scene = 注册验证 (register)',
)
assert(
  buildOtpRequestBody({ channel: 'email', scene: AUTH_SCENES.LOGIN }).scene === '登录验证',
  'useOtpSend body.scene = 登录验证 (login)',
)
assert(
  buildOtpRequestBody({ channel: 'sms', scene: AUTH_SCENES.VERIFY }).scene === '绑定验证',
  'useOtpSend body.scene = 绑定验证 (verify -> BIND)',
)
const targetBody = buildOtpRequestBody({ channel: 'sms', scene: AUTH_SCENES.LOGIN, target: ' 13800000000 ' })
assert(
  JSON.stringify(targetBody) === JSON.stringify({ channel: 'sms', scene: '登录验证', target: '13800000000' }),
  'useOtpSend body trims target: ' + JSON.stringify(targetBody),
)
const emptyTargetBody = buildOtpRequestBody({ channel: 'sms', scene: AUTH_SCENES.LOGIN, target: '' })
assert(emptyTargetBody.target === undefined, 'useOtpSend body omits empty target: ' + JSON.stringify(emptyTargetBody))
assert(
  buildOtpRequestBody({ channel: 'sms', scene: 'bogus' }).scene === '',
  'useOtpSend unknown scene -> \'\' in the request body',
)

console.log('STATE MACHINE PASS: four cases + switch reset + OTP scene mapping + body builder')

/* ================================================================== *
 * 1b. Contract 6 scan: zero CJK in auth module source.
 *     EXCLUDES src/constants/m-auth.js — that file IS the sanctioned
 *     single-source for user-visible Chinese copy (契约 6: 文案走 m-*.js).
 * ================================================================== */
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const authDir = join(__dirname, '..', 'src', 'modules', 'auth')
const scanFiles = []
function collect(dir, out) {
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent)
    const st = statSync(full)
    if (st.isDirectory()) collect(full, out)
    else if (extname(full) === '.js' || extname(full) === '.vue') out.push(full)
  }
  return out
}
collect(authDir, scanFiles)
const cjk = /[一-鿿]/
const cjkHits = scanFiles.filter((f) => cjk.test(readFileSync(f, 'utf8')))
if (cjkHits.length) {
  console.log('AUTH CONTRACT 6 FAIL (CJK in source):')
  cjkHits.forEach((f) => console.log(' - ' + f))
  process.exit(1)
}
console.log('CONTRACT 6 PASS: zero CJK in auth module source')

// PA-2-F7 consumption-path lock: useOtpSend must translate the OTP scene at the
// boundary by calling buildOtpRequestBody (whose behavior the unit assertions
// above lock). A regression where the send chain stops translating would leave
// buildOtpRequestBody unused (a dead import the bundler may keep) — this source
// check closes the blind spot a pure function-definition test cannot.
const otpSendSrc = readFileSync(join(__dirname, '..', 'src', 'modules', 'auth', 'useOtpSend.js'), 'utf8')
if (!/buildOtpRequestBody\(/.test(otpSendSrc)) {
  console.log('AUTH OTP SCENE FAIL: useOtpSend.js 不再调用 buildOtpRequestBody（翻译被绕过）')
  process.exit(1)
}
console.log('OTP SCENE CONSUMPTION PASS: useOtpSend 调用 buildOtpRequestBody')

/* ================================================================== *
 * 2. Browser smoke (dev server)
 * ================================================================== */
const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
function check(cond, msg) {
  if (!cond) errors.push(msg)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const csp = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push('console: ' + m.text()))
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) csp.push(entry.text)
})

// mock the auth APIs the modal consumes; record the I-06 verify bodies so we can
// assert the locally generated captchaId is echoed (#108). AK-A1a: the puzzle
// passes locally — the /api/captcha/verify endpoint must NEVER be called (the
// route below counts + 404s; the final assertion requires captchaVerifyCalls===0).
const verifyBodies = []
let captchaVerifyCalls = 0
await page.route('**/api/captcha/verify', (route) => {
  captchaVerifyCalls++
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({}) })
})
await page.route('**/api/auth/verify', (route) => {
  const post = route.request().postData()
  if (post) verifyBodies.push(JSON.parse(post))
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ verified: true, capToken: 'cap-token' }) })
})
await page.route('**/api/auth/otp/request', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
)

await page.goto(BASE + '/preview/auth.html', { waitUntil: 'networkidle' })
await page.waitForSelector('.auth-preview__title')

// --- preview harness renders ---
check((await page.textContent('.auth-preview__title')).includes('Identity Auth'), 'preview title missing')

const openBtn = page.locator('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' })
const behindBtn = page.locator('.auth-preview__row .ui-btn', { hasText: 'behind click count' })
const modal = page.locator('.ui-modal')
const confirmBtn = page.locator('.auth-shell__footer .ui-btn--fill-brand')
const cancelBtn = page.locator('.auth-shell__footer .ui-btn').first()

/** Drag the puzzle knob to a normalized offset (0..1). */
async function dragPuzzleTo(offset) {
  const knob = page.locator('.captcha-puzzle__knob')
  await knob.waitFor({ state: 'visible' })
  const box = await knob.boundingBox()
  check(box, 'puzzle knob missing')
  if (!box) return
  const dbg = await page.evaluate(() => window.__authPuzzleDebug || { offset: 0 })
  const scale = await page.evaluate(() => {
    const cv = document.querySelector('.captcha-puzzle__canvas')
    return cv ? cv.clientWidth / 280 : 1
  })
  const current = (dbg.offset || 0) * 240 * scale
  const desired = Math.max(0, Math.min(1, offset)) * 240 * scale
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + (desired - current), cy, { steps: 8 })
  await page.mouse.up()
}

async function openModal() {
  await openBtn.click()
  await modal.waitFor({ state: 'visible', timeout: 5000 })
}

/**
 * AK-A2 horizontal-axis contract (G5 geometry): every identity-auth field
 * (captcha row / puzzle / identifier / password / register fields) must fill
 * the .auth-shell__body content column and sit left-right aligned to it — the
 * centered modal column then yields symmetric whitespace automatically. The
 * puzzle canvas must upscale (clientWidth/280 >= 1) to fill the column.
 */
async function assertAuthColumnGeometry(page, label) {
  // Wait out the modal open transition (--dur-base 300ms) — boundingBox during the
  // transform animation measures a mid-scale frame and fails the geometry asserts.
  await page.waitForTimeout(350)
  const body = await page.locator('.auth-shell__body').boundingBox()
  check(body, label + ': .auth-shell__body missing')
  if (!body) return
  const targets = [
    '.ui-captcha',
    '.captcha-puzzle',
    // Password fields: the UiInput root carries BOTH .ui-input and
    // .password-row__identifier/.password-row__password, so the descendant
    // selector `.password-row__identifier .ui-input` would never match (audit
    // FAIL 17a51d2: dead selector, password geometry unasserted). Match the
    // root class directly.
    '.password-row__identifier',
    '.password-row__password',
    // Register fields: .register-pane__field is the UiInput root class on the
    // invite/username/password fields. NOT `.register-pane .ui-input` — that also
    // matches the captcha row's inner input (right side has the send button, not
    // full-width by design).
    '.register-pane__field',
  ]
  for (const sel of targets) {
    const n = await page.locator(sel).count()
    for (let i = 0; i < n; i++) {
      const b = await page.locator(sel).nth(i).boundingBox()
      check(b, label + ': ' + sel + '[' + i + '] missing')
      if (!b) continue
      check(
        Math.abs(b.width - body.width) <= 1,
        label + ': ' + sel + '[' + i + '] width ' + b.width.toFixed(1) + ' != body ' + body.width.toFixed(1),
      )
      check(
        Math.abs(b.x - body.x) <= 1 && Math.abs(b.x + b.width - (body.x + body.width)) <= 1,
        label + ': ' + sel + '[' + i + '] not left-right aligned to body (x=' + b.x.toFixed(1) + ')',
      )
    }
  }
  const scale = await page.evaluate(() => {
    const cv = document.querySelector('.captcha-puzzle__canvas')
    return cv ? cv.clientWidth / 280 : 0
  })
  check(scale >= 1, label + ': puzzle should upscale to fill the content column, scale=' + scale.toFixed(2))
}

// --- open the modal ---
await openModal()
check((await modal.count()) === 1, 'modal did not open')
await assertAuthColumnGeometry(page, 'verify')

// title + method title + cancel
check((await page.textContent('.auth-shell__title')) === '请验证身份', 'title should be 请验证身份')
check((await page.textContent('.otp-row__title')) === '手机验证码', 'default method should be 手机验证码')
check((await cancelBtn.textContent()) === '取消', 'cancel button should be 取消')

// confirm gray-state: disabled initially
await confirmBtn.waitFor({ state: 'visible' })
check(await confirmBtn.isDisabled(), 'confirm should be disabled initially')

// puzzle present
check((await page.locator('.captcha-puzzle__canvas').count()) === 1, 'puzzle canvas missing')
check((await page.locator('.captcha-puzzle__track').count()) === 1, 'puzzle track missing')
check((await page.locator('.captcha-puzzle__knob').count()) === 1, 'puzzle knob missing')

// blocked path A: panel-interior click does NOT close
await page.locator('.auth-shell__title').click()
await page.waitForTimeout(250)
check((await modal.count()) === 1, 'panel-interior click should NOT close the modal')

// fill a 6-digit code -> confirm still disabled (puzzle not passed yet)
const ta = page.locator('.ui-captcha .ui-input__ta')
await ta.waitFor({ state: 'visible' })
await ta.fill('123456')
await page.waitForTimeout(150)
check(await confirmBtn.isDisabled(), 'confirm should stay disabled until puzzle passes')

// puzzle PASS (drag to the debug target)
await dragPuzzleTo(await page.evaluate(() => (window.__authPuzzleDebug || {}).target))
await page.waitForTimeout(400)
check((await page.textContent('.captcha-puzzle__tip')).includes('验证通过'), 'puzzle should pass')
// AK-A3 (G2): the in-track hint must fade out on success — lock is-pass +
// opacity 0 so the pass-fade is NOT a decoration (mutation: delete
// hint.classList.add('is-pass') in verify() must go red).
const hintPass = await page.evaluate(() => {
  const h = document.querySelector('.captcha-puzzle__hint')
  return h ? { isPass: h.classList.contains('is-pass'), opacity: getComputedStyle(h).opacity } : null
})
check(hintPass && hintPass.isPass, 'AK-A3: hint should carry is-pass on success (G2 pass-fade lock)')
check(hintPass && hintPass.opacity === '0', 'AK-A3: hint opacity should be 0 after pass, got ' + (hintPass && hintPass.opacity))
check(await confirmBtn.isEnabled(), 'confirm should enable after code + puzzle pass')

// blocked path B: a covered behind-button is NOT triggered through the overlay
// (whether the modal closes depends on whether the button sits under the backdrop
//  or under the panel — either way the covered button's action must NOT fire)
const behindBox = await behindBtn.boundingBox()
const beforeText = await behindBtn.textContent()
if (behindBox) {
  await page.mouse.click(behindBox.x + behindBox.width / 2, behindBox.y + behindBox.height / 2)
  await page.waitForTimeout(300)
  check((await behindBtn.textContent()) === beforeText, 'covered behind-button should NOT be triggered through the overlay')
}
// deterministic backdrop close: top-left corner is always outside the centered panel
await page.mouse.click(20, 20)
await modal.waitFor({ state: 'detached', timeout: 5000 })
// no residue
check((await modal.count()) === 0, 'no .ui-modal residue after backdrop close')
check(
  (await page.evaluate(() => document.body.style.overflow)) === '',
  'body scroll lock should be released after close',
)

// --- reopen -> cancel closes ---
await openModal()
await cancelBtn.click()
await modal.waitFor({ state: 'detached', timeout: 5000 })
check((await modal.count()) === 0, 'cancel should close the modal')

// --- reopen -> confirm happy path closes ---
await openModal()
await page.locator('.ui-captcha .ui-input__ta').fill('123456')
await dragPuzzleTo(await page.evaluate(() => (window.__authPuzzleDebug || {}).target))
await page.waitForTimeout(400)
check(await confirmBtn.isEnabled(), 'confirm should enable for the happy path')
await confirmBtn.click()
await modal.waitFor({ state: 'detached', timeout: 5000 })
check((await modal.count()) === 0, 'confirm (I-06) should close the modal')

// --- reopen -> puzzle FAIL path (drag to far right, deterministic wrong) ---
await openModal()
await dragPuzzleTo(1)
// AK-A3: at full-right drag the fill must cover the hint's left half. Measure
// while offset=1 (before the fail path resets).
const a3mask = await page.evaluate(() => {
  const hint = document.querySelector('.captcha-puzzle__hint')
  const fill = document.querySelector('.captcha-puzzle__fill')
  if (!hint || !fill) return null
  const hr = hint.getBoundingClientRect()
  const fr = fill.getBoundingClientRect()
  return { fillRight: fr.right, hintLeft: hr.x, hintRight: hr.right }
})
check(a3mask, 'AK-A3: hint/fill present for mask assert')
if (a3mask) {
  check(
    a3mask.fillRight >= a3mask.hintLeft + (a3mask.hintRight - a3mask.hintLeft) / 2,
    'AK-A3: fill must cover at least the hint left half, fillRight=' + a3mask.fillRight.toFixed(1) + ' hintRight=' + a3mask.hintRight.toFixed(1),
  )
}
await page.waitForTimeout(200)
const failTip = await page.textContent('.captcha-puzzle__tip')
check(failTip.includes('没对准缺口'), 'wrong drag should fail with 没对准缺口, got: ' + failTip)
await page.waitForTimeout(600) // auto reset + repaint
check((await page.textContent('.captcha-puzzle__hint')).includes('拖动滑块'), 'in-track hint should show 拖动滑块 after auto-reset')

// --- AK-A3: in-track hint geometry ---
const a3 = await page.evaluate(() => {
  const track = document.querySelector('.captcha-puzzle__track')
  const hint = document.querySelector('.captcha-puzzle__hint')
  const fill = document.querySelector('.captcha-puzzle__fill')
  const knob = document.querySelector('.captcha-puzzle__knob')
  const tip = document.querySelector('.captcha-puzzle__tip')
  if (!track || !hint || !fill || !knob) return null
  const tr = track.getBoundingClientRect()
  const hr = hint.getBoundingClientRect()
  const fr = fill.getBoundingClientRect()
  const cs = getComputedStyle(hint)
  const hc = hr.x + hr.width / 2
  const tc = tr.x + tr.width / 2
  return {
    hint: { x: hr.x, right: hr.right, y: hr.y, bottom: hr.bottom, w: hr.width, h: hr.height, fontSize: cs.fontSize },
    track: { x: tr.x, right: tr.right, y: tr.y, bottom: tr.bottom, w: tr.width, h: tr.height },
    fill: { right: fr.right, x: fr.x },
    knob: { x: knob.getBoundingClientRect().x },
    tipDisplay: tip ? getComputedStyle(tip).display : 'missing',
    centerDelta: Math.abs(hc - tc),
    // DOM order pins stacking: hint < fill < knob (firstElementChild chain).
    order: [track.children[0].className, track.children[1].className, track.children[2].className].join(' '),
  }
})
check(a3, 'AK-A3: hint/fill/knob/track present')
if (a3) {
  // hint inside the track (1px tolerance)
  check(
    a3.hint.x >= a3.track.x - 1 && a3.hint.right <= a3.track.right + 1 && a3.hint.y >= a3.track.y - 1 && a3.hint.bottom <= a3.track.bottom + 1,
    'AK-A3: hint must be inside the track, hint=' + JSON.stringify(a3.hint) + ' track=' + JSON.stringify(a3.track),
  )
  // horizontally centered in the track
  check(a3.centerDelta <= 2, 'AK-A3: hint must be horizontally centered in track, delta=' + a3.centerDelta.toFixed(1))
  // smaller than the old --fs-sm (14px) — fixed --fs-xs (12px)
  check(a3.hint.fontSize === '12px', 'AK-A3: hint font-size should be 12px (--fs-xs), got ' + a3.hint.fontSize)
  // stacking: hint < fill < knob (fill covers hint's left as knob passes)
  check(a3.order === 'captcha-puzzle__hint captcha-puzzle__fill captcha-puzzle__knob', 'AK-A3: DOM order must be hint < fill < knob, got ' + a3.order)
  // fill starts at 0 (no mask before dragging)
  check(Math.abs(a3.fill.right - a3.fill.x) <= 1, 'AK-A3: fill should be zero-width initially')
  // idle status line hidden — the in-track hint is the only prompt
  check(a3.tipDisplay === 'none', 'AK-A3: idle tip should be display:none, got ' + a3.tipDisplay)
}
// close via backdrop (Esc needs focus inside the modal; after a mouse-only drag focus is on body)
await page.mouse.click(20, 20)
await modal.waitFor({ state: 'detached', timeout: 5000 })

// --- login scene (PA-1h3-F1): no contactMasks -> dual channels visible + password login hits /auth/login ---
// Mock the real password-login endpoint and capture the request body.
const loginBodies = []
await page.route('**/api/auth/login', (route) => {
  const post = route.request().postData()
  if (post) loginBodies.push(JSON.parse(post))
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 1, username: 'alice', role: 'student', avatar: '' }, authToken: 'login-token' }),
  })
})
// Switch the preview to the login scene with NO bound contact channels.
await page.locator('.auth-preview__row .ui-btn', { hasText: 'login' }).click()
for (const label of ['phone', 'email']) {
  const cb = page.locator('.ui-checkbtn', { hasText: label })
  if ((await cb.getAttribute('aria-pressed')) === 'true') await cb.click()
}
const noteText = await page.textContent('.auth-preview__note')
check(
  noteText.includes('手机验证码 / 邮箱验证码 / 输入密码'),
  'login available should list both code channels + password regardless of masks, note: ' + noteText,
)
await openModal()
await assertAuthColumnGeometry(page, 'login')
// Default method = phone code; the pick-2 switch shows email + password.
check((await page.textContent('.otp-row__title')) === '手机验证码', 'login default method should be 手机验证码')
const switchBtns = page.locator('.method-switch .ui-btn')
check((await switchBtns.count()) === 2, 'login modal should show exactly two alternative methods')
const switchLabels = await switchBtns.allTextContents()
check(
  switchLabels.includes('邮箱验证码验证') && switchLabels.includes('密码验证'),
  'login switch should offer 邮箱验证码验证 + 密码验证, got: ' + switchLabels.join(', '),
)
// Switch to password, fill identifier + password, pass the puzzle, confirm.
await page.locator('.method-switch .ui-btn', { hasText: '密码验证' }).click()
await page.waitForSelector('.password-row')
await assertAuthColumnGeometry(page, 'login-password')
await page.locator('.password-row__identifier .ui-input__ta').fill('alice')
await page.locator('.password-row__password .ui-input__native').fill('secret123')
await dragPuzzleTo(await page.evaluate(() => (window.__authPuzzleDebug || {}).target))
await page.waitForTimeout(400)
check(await confirmBtn.isEnabled(), 'login confirm should enable after identifier + password + puzzle')
await confirmBtn.click()
await modal.waitFor({ state: 'detached', timeout: 5000 })
check((await modal.count()) === 0, 'login success should close the modal')
check(
  loginBodies.length === 1 &&
    loginBodies[0].identifier === 'alice' &&
    loginBodies[0].password === 'secret123',
  'password login should POST /api/auth/login with {identifier,password}, got: ' + JSON.stringify(loginBodies),
)

// --- register scene (PA-2-F6 redo): register password must also be a masked native input ---
await page.locator('.auth-preview__row .ui-btn', { hasText: 'register' }).click()
await openModal()
await page.waitForSelector('.register-pane')
await assertAuthColumnGeometry(page, 'register')
// The password field is a native type=password input (shoulder-surfing guard), not a textarea.
const regPw = page.locator('.register-pane__password .ui-input__native')
await regPw.waitFor({ state: 'visible', timeout: 5000 })
const regPwTag = await regPw.evaluate((el) => el.tagName + ':' + el.type)
check(regPwTag === 'INPUT:password', 'register password should be INPUT:password, got: ' + regPwTag)
// PA-2a 4: the teacher invite-code field carries a concise explicit aria-label
// ('邀请码'), not the verbose placeholder text (UiInput ariaLabel precedence).
await page.locator('.register-pane .ui-btn', { hasText: '我是教师' }).click()
const inviteInput = page.locator('.register-pane [aria-label="邀请码"]')
await inviteInput.waitFor({ state: 'visible', timeout: 5000 })
const inviteAria = await inviteInput.getAttribute('aria-label')
check(inviteAria === '邀请码', 'invite input aria-label should be 邀请码, got: ' + inviteAria)
await assertAuthColumnGeometry(page, 'register-teacher')
await page.mouse.click(20, 20)
await modal.waitFor({ state: 'detached', timeout: 5000 })
check((await modal.count()) === 0, 'register modal should close via backdrop')

// --- mobile 375 geometry ---
const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
const mobileErrors = []
mobile.on('console', (m) => m.type() === 'error' && mobileErrors.push('console: ' + m.text()))
mobile.on('pageerror', (e) => mobileErrors.push('pageerror: ' + e.message))
await mobile.goto(BASE + '/preview/auth.html', { waitUntil: 'networkidle' })
await mobile.waitForSelector('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' })
await mobile.locator('.auth-preview__row .ui-btn', { hasText: 'Open identity auth' }).click()
await mobile.waitForSelector('.ui-modal', { timeout: 5000 })
const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check(!mobileOverflow, 'mobile 375 should have zero horizontal overflow')
check(await mobile.locator('.auth-shell__title').isVisible(), 'mobile title should be visible')
check(await mobile.locator('.auth-shell__footer .ui-btn').first().isVisible(), 'mobile cancel button should be visible')
const panelInViewport = await mobile.evaluate(() => {
  const r = document.querySelector('.ui-modal__panel').getBoundingClientRect()
  return r.right <= window.innerWidth + 1 && r.left >= -1 && r.bottom <= window.innerHeight + 1
})
check(panelInViewport, 'mobile modal panel should stay inside the viewport')
await mobile.close()

await page.screenshot({ path: 'new-frontend/test/smoke-auth-shell.png', fullPage: false })
await browser.close()

check(consoleErrors.length === 0, 'zero console/pageerror expected: ' + consoleErrors.join(' | '))
check(csp.length === 0, 'zero CSP violations expected: ' + csp.join(' | '))
check(mobileErrors.length === 0, 'mobile zero console/pageerror expected: ' + mobileErrors.join(' | '))
check(
  verifyBodies.length > 0 && verifyBodies.some((b) => b.captchaVerified === true && b.captchaId && b.captchaId.length > 0),
  'I-06 verify body must echo the locally generated captchaId (CaptchaPuzzle emits its own id)',
)
check(captchaVerifyCalls === 0, 'AK-A1a: puzzle passes locally — /api/captcha/verify must never be called, got ' + captchaVerifyCalls)

if (errors.length) {
  console.log('AUTH SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('AUTH SMOKE PASS: shell open/close + backdrop/cancel + blocked paths + confirm gate + puzzle + mobile geometry + zero console/CSP')
