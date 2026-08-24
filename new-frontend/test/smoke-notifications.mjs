/**
 * M5 smoke test - C3 notifications + C4 more (full module assembly)
 * -------------------------------------------------------
 * Asserts against the M5 preview harness (m5-preview.html), covering:
 *  - M5-00 entry wiring: openC3 envelope / openC4 user-area dropdown
 *  - blocked-path negative cases: guest click notification/settings -> login toast
 *  - M5-01 data layer: I-26 consumed via route intercept, all server items render
 *    (no client re-filter), unread count derives from cache
 *  - M5-02 card geometry: avatar branch, red dot, ellipsis no-wrap, inset divider
 *  - M5-03 block-system toggle: PUT /api/settings + re-fetch (system cards disappear)
 *  - M5-04 read semantics: detail-open marks single read; modal-close batch read
 *  - M5-05 detail view: list <-> detail slide, back button
 *  - M5-06 more dropdown: 3 options with SVG icons
 *  - M5-07 settings skeleton: left switch / right scroll / two-way sync /
 *    center divider + no dividers between setting items
 *  - M5-08 settings data: I-08 mocked load (username rendered)
 *  - M5-13 about modal / M5-14 feedback modal / M5-16 tickets
 *  - zero console/pageerror/CSP + 375 no horizontal overflow
 * Run: node test/smoke-notifications.mjs   (built preview served on BASE)
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5197'
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text())
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))
page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText || '')))

// CSP violations via CDP.
const cdp = await page.context().newCDPSession(page)
const csp = []
await cdp.send('Log.enable')
cdp.on('Log.entryAdded', ({ entry }) => {
  if (/Content Security Policy/i.test(entry.text)) csp.push(entry.text)
})

/* ---- mock API state ---- */
const HOUR = 3600 * 1000
const apiState = { blockSystem: false, readAllCalls: 0, singleReadCalls: [], lastAvatarDataUrl: '', feedbackPosts: [] }

// A1 mutation guard: the avatar write path must send the SHARED crop pipeline output
// (512x512 square). A 1x1 PNG staged through the input must come back as 512x512 in
// the PUT /api/settings payload; a raw write (bypassing useAvatarCrop) would stay 1x1.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
function pngSizeFromDataUrl(dataUrl) {
  const b64 = String(dataUrl).split(',')[1]
  const buf = Buffer.from(b64, 'base64')
  // PNG signature(8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
const MOCK = {
  notifications: () => {
    const all = [
      {
        id: 1,
        type: 'chat',
        title: '张三 发来一条很长的消息标题用来验证省略号不会换行并且被截断',
        content: '你好，请问这周六下午方便试课吗？',
        created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
        is_read: false,
        avatar_src: 'user',
      },
      {
        id: 2,
        type: 'system',
        title: '合同待确认',
        content: '你有一份合同等待确认签署',
        created_at: new Date(Date.now() - 26 * HOUR).toISOString(),
        is_read: true,
        avatar_src: 'system',
      },
      {
        id: 3,
        type: 'chat',
        title: '李四 已接受你的需求',
        content: '李四已接单，点击查看',
        created_at: new Date(Date.now() - 30 * 24 * HOUR).toISOString(),
        is_read: false,
        avatar_src: 'user',
      },
    ]
    return { notifications: apiState.blockSystem ? all.filter((n) => n.avatar_src !== 'system') : all }
  },
  settings: {
    user: { id: 1, username: 'qa_student', avatar: '', role: 'student', contactMasks: { phone: '138****8000', email: 'qa***@x.com' } },
    usernameStatus: { canChange: true, cooldownMs: 0 },
    blockSystemNotifications: false,
    notifyBroadcastMuted: false,
    devices: [
      { session_id: 's1', label: 'Chrome on Windows', created_at: new Date(Date.now() - 3 * 24 * HOUR).toISOString(), expires_at: null, current: true },
      { session_id: 's2', label: 'Firefox on Linux', created_at: new Date(Date.now() - 5 * 24 * HOUR).toISOString(), expires_at: null, current: false },
    ],
  },
  tickets: {
    feedbacks: [
      { id: 11, kind: 'bug', title: '登录页样式问题', content: '验证码输入框太窄', created_at: new Date(Date.now() - 2 * HOUR).toISOString() },
    ],
  },
}

await page.route('**/api/notifications**', (route) => {
  const u = new URL(route.request().url())
  if (route.request().method() === 'GET') {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK.notifications()) })
  } else if (/\/read-all$/.test(u.pathname)) {
    apiState.readAllCalls++
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  } else if (/\/read$/.test(u.pathname)) {
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length >= 2) apiState.singleReadCalls.push(segs[segs.length - 2])
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  } else {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  }
})
await page.route('**/api/auth/logout', async (route) => {
  // AK-L-F4: hold the revocation ~600ms so the smoke can prove local state
  // clears WITHOUT waiting for the network (F7 optimistic clear in
  // auth-actions.logout). Revert the ordering (await the API before clearAuth)
  // and this turns red: the session key still exists at 400ms.
  await new Promise((r) => setTimeout(r, 600))
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
})
await page.route('**/api/settings', (route) => {
  const req = route.request()
  if (req.method() === 'GET') {
    const body = { ...MOCK.settings, blockSystemNotifications: apiState.blockSystem }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  } else if (req.method() === 'PUT') {
    const data = JSON.parse(req.postData() || '{}')
    if (data.blockSystemNotifications !== undefined) apiState.blockSystem = !!data.blockSystemNotifications
    if (data.avatar !== undefined) apiState.lastAvatarDataUrl = data.avatar
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  } else {
    route.continue()
  }
})
await page.route('**/api/feedbacks/mine**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK.tickets) }),
)
// Feedback POST capture: the anonymity hard constraint is that the request carries
// NO auth token (auth:false through the single-point api()). Mutation guard: if
// someone drops auth:false the X-Auth-Token header appears -> red.
await page.route('**/api/feedbacks', (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    let body = {}
    try {
      body = JSON.parse(req.postData() || '{}')
    } catch {
      /* keep {} */
    }
    apiState.feedbackPosts.push({
      authToken: req.headers()['x-auth-token'] || '',
      clientToken: body.clientToken || '',
    })
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  } else {
    route.continue()
  }
})

await page.goto(BASE + '/m5-preview.html', { waitUntil: 'networkidle' })

const notifBtn = page.locator('.m5pv__notif')
const moreBtn = page.locator('.m5pv__more')
const authBtn = page.locator('.m5pv__auth')

/* ---- blocked path #1: guest envelope -> login toast, no modal ---- */
await notifBtn.click()
await page.waitForTimeout(400)
const guestToast = await page.locator('.ui-toast').first().textContent()
if (!guestToast || !guestToast.includes('请先登录')) errors.push('guest envelope: no login toast')
if ((await page.locator('.ui-modal').count()) !== 0) errors.push('guest envelope: modal opened while not authed')

/* ---- blocked path #2: guest C4 -> 设置 -> login toast, no settings ---- */
await moreBtn.click()
await page.waitForTimeout(350)
if ((await page.locator('.m5-more').count()) === 0) errors.push('more dropdown did not open (guest)')
const optCount = await page.locator('.m5-more__item').count()
// AK-L-F2: settings / about / feedback + logout (the C4 dropdown gained a 4th row)
if (optCount !== 4) errors.push('more dropdown option count: ' + optCount)
const iconCount = await page.locator('.m5-more__opt-icon').count()
if (iconCount !== 4) errors.push('more dropdown SVG icon count: ' + iconCount)
await page.locator('.m5-more__item').first().click()
await page.waitForTimeout(400)
if ((await page.locator('.st-settings').count()) !== 0) errors.push('guest settings: window opened while not authed')
const toast2 = await page.locator('.ui-toast').last().textContent()
if (!toast2 || !toast2.includes('请先登录')) errors.push('guest settings: no login toast')
await page.locator('.m5-pv__title').click()
await page.waitForTimeout(300)
if ((await page.locator('.m5-more').count()) !== 0) errors.push('more dropdown did not close on outside click')

/* ---- log in ---- */
await authBtn.click()
await page.waitForTimeout(200)

/* ---- C3 notification modal + cards (M5-01/02) ---- */
await notifBtn.click()
await page.locator('.nt-card').first().waitFor({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)

const cardCount = await page.locator('.nt-card').count()
if (cardCount !== 3) errors.push('notification card count: ' + cardCount)
const cardTitles = await page.locator('.nt-card__title').allTextContents()
if (cardTitles.length !== 3) errors.push('card titles count mismatch: ' + cardTitles.length)
if (!cardTitles.some((t) => t.includes('张三'))) errors.push('user notification missing')
if (!cardTitles.some((t) => t.includes('合同待确认'))) errors.push('system notification missing')

// M5-03 / AK-C2-F9 (#4): block-system toggle is a checkbox row (box + check) —
// present in the modal and must NOT stretch its width when selected (the
// UiCheckButton right-stretch anti-pattern the user rejected).
const bst = page.locator('.nt-toggle .ui-checkbox')
if ((await bst.count()) !== 1) errors.push('AK-C2-F9: block-system toggle should be a UiCheckbox (box + check), got ' + (await bst.count()))
const bstW0 = await bst.evaluate((el) => el.getBoundingClientRect().width)
await bst.click()
await page.waitForTimeout(300)
const bstW1 = await bst.evaluate((el) => el.getBoundingClientRect().width)
if (Math.abs(bstW1 - bstW0) > 1) errors.push('AK-C2-F9: checkbox must not stretch on select (' + bstW0 + '->' + bstW1 + ')')
await bst.click() // restore unchecked state, then wait for the re-fetch to settle
await page.waitForTimeout(600)

// avatar branch / red dots / ellipsis / divider geometry (M5-02)
if ((await page.locator('.nt-card__avatar.is-system').count()) !== 1) errors.push('system avatar branch count')
if ((await page.locator('.nt-card__dot').count()) !== 2) errors.push('unread dot count (expect 2)')
const ellipsisOk = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.nt-card__title, .nt-card__content')]
  const nowrap = els.every((el) => getComputedStyle(el).whiteSpace === 'nowrap')
  const card = document.querySelector('.nt-card')
  const cr = card.getBoundingClientRect()
  const over = els.some((el) => {
    const r = el.getBoundingClientRect()
    return r.right > cr.right + 1 || r.left < cr.left - 1
  })
  return nowrap && !over
})
if (!ellipsisOk) errors.push('card ellipsis/no-wrap violated')
const clippedTitle = await page.evaluate(() => {
  const t = document.querySelector('.nt-card__title')
  return t ? t.scrollWidth > t.clientWidth + 1 : false
})
if (!clippedTitle) errors.push('long title was not clipped (ellipsis inactive)')
const divGeom = await page.evaluate(() => {
  const panel = document.querySelector('.ui-modal__panel')
  const div = document.querySelector('.nt-divider')
  if (!panel || !div) return null
  const pr = panel.getBoundingClientRect()
  const dr = div.getBoundingClientRect()
  return { leftInset: dr.left - pr.left, rightInset: pr.right - dr.right }
})
if (!divGeom || divGeom.leftInset < 8 || divGeom.rightInset < 8) errors.push('divider not inset: ' + JSON.stringify(divGeom))

/* ---- M5-05 detail view: click card -> detail, back -> list ---- */
await page.locator('.nt-card').first().click()
await page.locator('.nt-detail').waitFor({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(400)
if ((await page.locator('.nt-detail').count()) !== 1) errors.push('detail view did not open')
const detailTitle = await page.locator('.nt-detail__title').textContent()
if (!detailTitle || !detailTitle.includes('张三')) errors.push('detail title wrong: ' + detailTitle)
if (apiState.singleReadCalls.length !== 1) errors.push('single read POST count: ' + apiState.singleReadCalls.length)
await page.locator('.nt-detail__bar').locator('button').click()
await page.waitForTimeout(400)
if ((await page.locator('.nt-detail').count()) !== 0) errors.push('detail view did not close on back')
if ((await page.locator('.nt-card').count()) !== 3) errors.push('list did not restore after back')

/* ---- M5-04: closing the modal fires the batch read (silent, per-id) ---- */
// PA-1h2-M3: the exit batch read must mark ONLY the revealed+unread ids via per-id
// POST /api/notifications/:id/read - never read-all (which marks every unseen row).
// Mock ids: 1 unread (opened -> already read), 2 already-read (must NOT be re-marked),
// 3 unread+revealed (must be the batch target).
await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(500)
if ((await page.locator('.ui-modal').count()) !== 0) errors.push('notification modal did not close')
if (apiState.readAllCalls !== 0) errors.push('batch exit read fired read-all (must be per-id): ' + apiState.readAllCalls)
const singleIds = apiState.singleReadCalls.join(',')
if (!singleIds.includes('3')) errors.push('batch exit read did not mark revealed unread id 3: ' + singleIds)
if (singleIds.includes('2')) errors.push('batch exit read marked already-read id 2: ' + singleIds)

/* ---- M5-06 + M5-13 about ---- */
await moreBtn.click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').nth(1).click() // 关于平台
await page.waitForTimeout(400)
if ((await page.locator('.ab-about').count()) === 0) errors.push('about modal did not open')
await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(400)

/* ---- M5-14 + M5-16 feedback + tickets ---- */
await moreBtn.click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').nth(2).click() // 用户反馈
await page.waitForTimeout(400)
if ((await page.locator('.fb-feedback').count()) === 0) errors.push('feedback modal did not open')
const fbTabs = await page.locator('.fb-nav__item').count()
if (fbTabs !== 2) errors.push('feedback tab count: ' + fbTabs)
if ((await page.locator('.ui-input').count()) < 2) errors.push('feedback form fields missing')
// switch to 我的工单 -> tickets load
await page.locator('.fb-nav__item').nth(1).click()
await page.locator('.ft__card').first().waitFor({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
const ticketCount = await page.locator('.ft__card').count()
if (ticketCount !== 1) errors.push('ticket card count: ' + ticketCount)
// M5-15 anonymity mutation guard: submit a feedback and assert the POST carries
// no auth token (only clientToken) - dropping auth:false in api() -> red.
await page.locator('.fb-nav__item').nth(0).click()
await page.waitForTimeout(300)
await page.locator('.ff-control .ui-input__ta').nth(0).fill('匿名反馈标题')
await page.locator('.ff-control .ui-input__ta').nth(1).fill('匿名反馈内容')
await page.locator('.ff-footer .ui-btn').click()
await page.waitForTimeout(600)
if (!apiState.feedbackPosts.length) {
  errors.push('feedback POST not captured')
} else {
  const post = apiState.feedbackPosts[0]
  if (post.authToken) errors.push('feedback POST carried an auth token (anonymity violated): ' + post.authToken)
  if (!post.clientToken) errors.push('feedback POST missing clientToken (anonymous identity)')
}
await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(400)

/* ---- M5-07 + M5-08 settings ---- */
await moreBtn.click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').first().click() // 设置
await page.waitForTimeout(600)
if ((await page.locator('.st-settings').count()) === 0) errors.push('settings window did not open')

// M5-08: mocked I-08 data rendered (username + device rows)
const settingsUser = await page.locator('.su-row').first().textContent()
if (!settingsUser || !settingsUser.includes('qa_student')) errors.push('settings username not rendered: ' + settingsUser)
const deviceRows = await page.locator('.sd-row').count()
if (deviceRows !== 2) errors.push('settings device row count: ' + deviceRows)

// M5-09b A1 guard: the avatar write path must use the SHARED crop pipeline
// (useAvatarCrop -> 512x512 square). Staging a 1x1 PNG and saving must PUT a
// 512x512 payload; a raw write (bypassing the crop) would stay 1x1 -> red.
await page.setInputFiles('.sv-avatar__file', { name: 'a.png', mimeType: 'image/png', buffer: PNG_1x1 })
await page.waitForTimeout(800) // file read + image decode + canvas crop
if ((await page.locator('.sv-avatar__save').count()) !== 1) errors.push('avatar save button did not appear after staging')
await page.locator('.sv-avatar__save').click()
await page.waitForTimeout(700)
if (!apiState.lastAvatarDataUrl) {
  errors.push('avatar PUT not captured')
} else {
  const { width, height } = pngSizeFromDataUrl(apiState.lastAvatarDataUrl)
  if (width !== 512 || height !== 512) {
    errors.push('avatar write path not cropped to 512x512 (A1): ' + width + 'x' + height)
  }
}

// M5-07: nav count, center divider, no item dividers
const navCount = await page.locator('.st-nav__item').count()
if (navCount !== 4) errors.push('settings nav item count: ' + navCount)
if ((await page.locator('.st-settings .st-divider').count()) !== 1) errors.push('center divider count')
const itemDivider = await page.evaluate(() => {
  return [...document.querySelectorAll('.st-section__body > *')].some((el) => {
    const s = getComputedStyle(el)
    return s.borderTopWidth !== '0px' || s.borderBottomWidth !== '0px' || s.borderTopStyle !== 'none'
  })
})
if (itemDivider) errors.push('setting items have dividers (should have none)')

// two-way sync #1: click 外观 -> right column scrolls
await page.locator('.st-nav__item').nth(1).click()
await page.waitForTimeout(700)
const scrollTopAfter = await page.evaluate(() => {
  const sc = document.querySelector('.st-scroll')
  return sc ? sc.scrollTop : -1
})
if (scrollTopAfter <= 0) errors.push('left click did not scroll right column')

// two-way sync #2: scroll right to bottom -> last nav highlighted
await page.evaluate(() => {
  const sc = document.querySelector('.st-scroll')
  if (sc) sc.scrollTop = sc.scrollHeight
})
await page.waitForTimeout(200)
const lastActive = await page.evaluate(() => {
  const items = document.querySelectorAll('.st-nav__item')
  return items[items.length - 1].classList.contains('is-active')
})
if (!lastActive) errors.push('right scroll did not sync left highlight')

await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(400)

/* ---- M5-03 toggle: block system -> PUT + re-fetch (system card disappears) ---- */
await notifBtn.click()
await page.locator('.nt-card').first().waitFor({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
await page.locator('.nt-toggle .ui-checkbox').click()
await page.waitForTimeout(600)
if (!apiState.blockSystem) errors.push('block-system PUT not persisted to test state')
const systemAfter = await page.locator('.nt-card__avatar.is-system').count()
if (systemAfter !== 0) errors.push('system notification still visible after block toggle')
const userAfter = await page.locator('.nt-card').count()
if (userAfter !== 2) errors.push('user cards after block toggle: ' + userAfter)
await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(400)

/* ---- 375 geometry: no horizontal overflow ---- */
await page.setViewportSize({ width: 375, height: 700 })
await page.waitForTimeout(300)
await notifBtn.click()
await page.locator('.nt-card').first().waitFor({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
if (mobileOverflow) errors.push('375 horizontal overflow (notifications)')
const cardsFit = await page.evaluate(() => {
  const vw = window.innerWidth
  return [...document.querySelectorAll('.nt-card')].every((el) => {
    const r = el.getBoundingClientRect()
    return r.left >= -1 && r.right <= vw + 1
  })
})
if (!cardsFit) errors.push('375 notification card out of viewport')
await page.locator('.ui-modala1__close').first().click()
await page.waitForTimeout(300)

await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(200)
await moreBtn.click()
await page.waitForTimeout(350)
await page.locator('.m5-more__item').first().click()
await page.waitForTimeout(400)
await page.setViewportSize({ width: 375, height: 700 })
await page.waitForTimeout(300)
const mobileSettingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
if (mobileSettingsOverflow) errors.push('375 horizontal overflow (settings)')

/* ---- AK-L-F2: C4 gained a logout row; clicking it clears the session ---- */
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(200)
// close the settings modal left open by the previous section (its backdrop
// would intercept the more-button click)
await page.locator('.ui-modala1__close').first().click().catch(() => {})
await page.waitForTimeout(300)
await moreBtn.click()
await page.waitForTimeout(350)
const logoutLabel = await page.locator('.m5-more__item').nth(3).textContent().catch(() => '')
if (!logoutLabel.includes('退出登录')) errors.push('AK-L-F2: 4th more row should be 退出登录, got: ' + logoutLabel)
await page.locator('.m5-more__item').nth(3).click()
// AK-L-F4: the local session (sessionStorage authToken, written by the harness's
// persistAuth) must clear BEFORE the 600ms-delayed revocation resolves — logout
// clears optimistically (F7). 400ms < 600ms: a reverted await-first ordering
// times out red here.
const clearedEarly = await page
  .waitForFunction(() => sessionStorage.getItem('authToken') === null, null, { timeout: 400, polling: 20 })
  .then(() => true)
  .catch(() => false)
if (!clearedEarly) errors.push('AK-L-F4: local session must clear without waiting for the network revocation')
await page.waitForTimeout(500)
// logged out -> the guest envelope re-arms: a notification click now toasts 请先登录
await notifBtn.click()
await page.waitForTimeout(400)
const logoutToast = await page.locator('.ui-toast').first().textContent().catch(() => '')
if (!logoutToast.includes('请先登录')) errors.push('AK-L-F2: after logout the guest envelope must re-arm (请先登录), got: ' + logoutToast)

await page.screenshot({ path: 'test/smoke-notifications.png', fullPage: true })

await browser.close()

/* ---- verdict ---- */
const combined = [...errors, ...csp]
if (combined.length) {
  console.log('SMOKE FAIL')
  combined.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log(
  'SMOKE PASS: M5 full assembly (entry, blocked paths, data, cards, detail, read semantics, block toggle, more menu, about, feedback/tickets, settings skeleton+data, geometry, zero console/CSP, 375)',
)
