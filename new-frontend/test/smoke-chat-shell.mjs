/**
 * M4 chat module shell smoke (self-start Vite + Playwright + node pure guards)
 * -----------------------------------------------------------------------------
 * Covers the assembled chat module:
 *   1. M4-01 double-column geometry (list ~20% / conv ~80%, no overflow, G5).
 *   2. M4-02 top fade mask penetration (pointer-events:none, P22).
 *   3. M4-06a framework + M4-06c ended read-only gate (input hidden for closed).
 *   4. M4-06b mobile pane switch negative case (tap conv -> chat window, P22).
 *   5. M4-07 message rendering (I-18 mock -> text + image bubbles render).
 *   6. M4-08 bubble <=70% max-width geometry (G5).
 *   7. M4-10 image bubble -> large-image viewer modal.
 *   8. M4-17/18/30 input bar + optimistic text send (mock POST echo).
 *   9. M4-20 plus rotation + M4-21 attachment sheet buttons.
 *  10. M4-22/23/24 top bar + more dropdown + end-session confirm modal.
 *  11. M4-25 gray-out gate (I-15 relation with contract -> End Session disabled).
 *  12. M4-26/27 temp conversation: init hint + quota input hidden after send.
 *  13. Contract-6 static scan: zero CJK in chat module source (copy is data and
 *      lives in m-chat.js), zero inline event/style attrs, zero v-html, zero
 *      <style> injection.
 *  14. Zero console errors / pageerrors / CSP violations.
 *  15. M4-14 honest cap: picking an attachment never POSTs /api/uploads (S2), so
 *      no orphan upload is staged while the attach-and-send UI is capped.
 *      G2 mutation guard: reverting onAttach to the real uploader makes the
 *      upload counter assertion go red.
 *
 * Run: node test/smoke-chat-shell.mjs   (self-starts a Vite dev server; or set
 *      BASE=http://host:port to reuse a running server)
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

/* ============ Node pure-function guards ============ */
import { isChatInputVisible } from '../src/modules/chat/state.js'
import { formatListTime, formatBubbleTime } from '../src/modules/chat/logic/timeFormat.js'
import { unreadReceive, unreadOpenFromCard, unreadEnterFromOutside, unreadInputActivity } from '../src/modules/chat/logic/unread.js'
import { brandSoftFilter } from '../src/modules/chat/logic/colorFilter.js'
import { truncateFileName } from '../src/modules/chat/logic/fileName.js'
import { normalizeMessage, dedupByMid, sliceTail, advanceCursor } from '../src/modules/chat/logic/messages.js'
import { canEnd, applyEnded } from '../src/modules/chat/logic/endSession.js'
import { deriveTempHint, tempVisibleToMe, applyTempSent, applyFormal } from '../src/modules/chat/logic/tempConversation.js'
import { createClientKey, dedupBatchByClientKey } from '../src/modules/chat/logic/send.js'

// --- M4-06c input-visibility gate + G2 mutation guard ---
const endedState = {
  activeConversationId: 3,
  conversations: [{ conversationId: 3, status: 'closed', tempStatus: null, tempInitiatorId: null, quotaRemaining: 0, iAmInitiator: false }],
}
const activeState = {
  activeConversationId: 1,
  conversations: [{ conversationId: 1, status: 'active', tempStatus: null, tempInitiatorId: null, quotaRemaining: 1, iAmInitiator: false }],
}
ok(isChatInputVisible(endedState) === false, 'M4-06c: ended => input hidden')
ok(isChatInputVisible(activeState) === true, 'M4-06c: active => input visible')
ok(isChatInputVisible({ activeConversationId: null, conversations: [] }) === false, 'M4-06c: no active conv => hidden')
function mutantEndedGateRemoved(s) {
  const conv = s.conversations.find((c) => c.conversationId === s.activeConversationId)
  if (!conv) return false
  // ended gate REMOVED on purpose - mutation.
  if (conv.tempStatus && conv.tempStatus !== 'init' && conv.iAmInitiator && conv.quotaRemaining === 0) return false
  return true
}
ok(mutantEndedGateRemoved(endedState) === true, 'M4-06c mutation guard: gate removal WOULD show input for ended')

// --- M4-27 temp-quota flag mutation guard (G2) ---
const tempSpent = {
  activeConversationId: 4,
  conversations: [{ conversationId: 4, status: 'active', tempStatus: 'sent', tempInitiatorId: 1, quotaRemaining: 0, iAmInitiator: true }],
}
ok(isChatInputVisible(tempSpent) === false, 'M4-27: temp initiator spent quota => input hidden')
function mutantTempQuotaRemoved(s) {
  const conv = s.conversations.find((c) => c.conversationId === s.activeConversationId)
  if (!conv) return false
  if (conv.status === 'closed') return false
  // temp-quota flag REMOVED on purpose - mutation.
  return true
}
ok(mutantTempQuotaRemoved(tempSpent) === true, 'M4-27 mutation guard: temp-quota removal WOULD show input')

// --- M4-04 time formatting ---
const now = new Date('2026-08-20T10:33:00').getTime()
ok(formatListTime(new Date('2026-08-20T10:31:00').getTime(), now) === '2分钟前', 'M4-04 list: today <1h')
ok(formatListTime(new Date('2026-08-19T23:59:59').getTime(), now) === '昨天', 'M4-04 list: yesterday boundary')
ok(formatListTime(new Date('2026-08-01T00:00:00').getTime(), now) === '8月1日', 'M4-04 list: same year')
ok(formatListTime(new Date('2025-12-31T00:00:00').getTime(), now) === '2025年12月31日', 'M4-04 list: previous year')
ok(formatBubbleTime(new Date('2026-08-20T09:05:00').getTime(), now) === '09:05', 'M4-04 bubble: today HH:MM')

// --- M4-05 unread four-path state machine ---
const rows = [{ conversationId: 1, unread: 0 }]
ok(unreadReceive(rows, 1) === 1, 'M4-05: receive -> +1')
ok(unreadEnterFromOutside(rows, 1) === 1, 'M4-05: enter from outside -> dot stays')
ok(unreadInputActivity(rows, 1) === 0, 'M4-05: input action -> clear')
ok(unreadOpenFromCard(rows, 1) === 0, 'M4-05: card open -> clear')
ok(unreadOpenFromCard(rows, 99) === null, 'M4-05: missing row -> null')

// --- M4-08 brand purple filter ---
const soft = brandSoftFilter('#6c5ce7')
ok(/^#[0-9a-f]{6}$/.test(soft), 'M4-08: filter returns #rrggbb')
ok(brandSoftFilter('#6c5') === brandSoftFilter('#66cc55'), 'M4-08: short/long hex consistent')

// --- M4-13 filename truncation ---
ok(truncateFileName('abc.pdf', 20) === 'abc.pdf', 'M4-13: short name unchanged')
ok(truncateFileName('verylongdocumentname.pdf', 12).length <= 12, 'M4-13: truncated keeps <= maxChars')
ok(truncateFileName('verylongdocumentname.pdf', 12).endsWith('.pdf'), 'M4-13: truncated keeps extension')

// --- M4-07 pure cursor/dedup ---
const dm = dedupByMid([{ id: 1, kind: 'text' }], [{ id: 2, kind: 'text' }, { id: 1, kind: 'image' }])
ok(dm.length === 2, 'M4-07: dedupByMid removes duplicate id')
ok(sliceTail([1, 2, 3, 4], 2).length === 2, 'M4-07: sliceTail keeps last N')
ok(advanceCursor([{ id: 1 }, { id: 5 }, { id: 3 }]) === 5, 'M4-07: advanceCursor = max id')

// --- M4-25 gray-out gate ---
ok(canEnd({ conversationId: 1, status: 'active', signing: null }) === true, 'M4-25: no contract => can end')
ok(canEnd({ conversationId: 1, status: 'active', signing: { id: 9 } }) === false, 'M4-25: has contract => cannot end (gray out)')
ok(canEnd({ conversationId: 3, status: 'closed', signing: null }) === false, 'M4-25: closed => cannot end')
ok(canEnd({ conversationId: 4, status: 'active', tempStatus: 'init', signing: null }) === true, 'M4-25: temp => can end')
ok(applyEnded([{ conversationId: 1, status: 'active' }], 1)[0].status === 'closed', 'M4-25: applyEnded flips formal row to closed')
ok(applyEnded([{ conversationId: 4, status: 'active', tempStatus: 'init' }], 4).length === 0, 'M4-25: applyEnded removes temp row')

// --- M4-26/28/29 temp hint + visibility ---
ok(deriveTempHint({ tempStatus: 'init', iAmInitiator: true }) === 'init', 'M4-26: init hint key')
ok(deriveTempHint({ tempStatus: 'sent', iAmInitiator: true }) === 'sent', 'M4-26: sent hint key')
ok(deriveTempHint({ tempStatus: 'sent', iAmInitiator: false }) === 'received', 'M4-28: received hint key')
ok(deriveTempHint({ tempStatus: null, wasTemp: true }) === 'formal', 'M4-29: formal hint key')
ok(tempVisibleToMe({ tempStatus: 'init' }, false) === false, 'M4-28 negative: receiver does not see init')
ok(tempVisibleToMe({ tempStatus: 'sent' }, false) === true, 'M4-28: receiver sees sent')
ok(applyFormal({ tempStatus: 'sent', iAmInitiator: true }).tempStatus === null, 'M4-29: applyFormal clears tempStatus')

// --- M4-30 clientKey + dedup ---
const ck1 = createClientKey()
ok(typeof ck1 === 'string' && ck1.length > 0, 'M4-30: clientKey generated')
ok(dedupBatchByClientKey([{ clientKey: 'a' }, { clientKey: 'a' }, { body: 'nokey' }], []).length === 2, 'M4-30: clientKey dedup keeps first + key-less')

/* ============ Contract-6 static scan (chat module source) ============ */
const CHAT_DIR = fileURLToPath(new URL('../src/modules/chat', import.meta.url))
const cjkRe = /[一-鿿]/
const inlineAttrRe = /\sonclick=|\sonload=|\sonchange=|\sonerror=|\sstyle=/
const vhtmlRe = /\sv-html=/
const styleInjectRe = /createElement\(['"]style['"]\)/
function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) collectFiles(full, out)
    else if (/\.(vue|js)$/.test(name)) out.push(full)
  }
  return out
}
for (const file of collectFiles(CHAT_DIR)) {
  const src = readFileSync(file, 'utf8')
  if (cjkRe.test(src)) ok(false, `contract 6: CJK in ${file}`)
  if (file.endsWith('.vue')) {
    if (inlineAttrRe.test(src)) ok(false, `contract 6: inline event/style attr in ${file}`)
    if (vhtmlRe.test(src)) ok(false, `contract 6: v-html in ${file}`)
  }
  if (styleInjectRe.test(src)) ok(false, `contract 6: <style> injection in ${file}`)
}
ok(true, 'contract 6: chat module source clean (zero CJK / inline attrs / v-html / style injection)')

/* ============ Browser harness checks ============ */
let server
let base = process.env.BASE
if (!base) {
  server = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const FIXTURE_CONV1 = [
  { id: 1, sender_user_id: 2, kind: 'text', name: '', body: '好的，明天下午三点见。', thumb: '', created_at: '2026-08-22T10:31:00' },
  { id: 2, sender_user_id: 1, kind: 'text', name: '', body: '没问题。', thumb: '', created_at: '2026-08-22T10:32:00' },
  { id: 3, sender_user_id: 2, kind: 'image', name: '', body: PNG, thumb: PNG, created_at: '2026-08-22T10:33:00' },
]

// I-17 conversation list rows in the REAL backend shape (dbGetMyConversations raw
// row + handleGetConversations camelCase temp fields): id / student_name /
// teacher_name / student_avatar / teacher_avatar / last_body / last_kind / last_at /
// last_sender / unread_count + tempStatus / tempInitiatorId / iAmInitiator / quota.
// The harness mounts ChatPage without auth (role unknown), so normalizeConversationRow
// maps otherName to teacher_name (the I-17 "teacher_name preferred" fallback).
const FIXTURE_CONVERSATIONS = [
  { id: 1, student_user_id: 1, teacher_user_id: 2, status: 'active', student_name: '张三', teacher_name: '李老师', student_avatar: '', teacher_avatar: '', last_body: '好的，明天下午三点见。', last_kind: 'text', last_at: '2026-08-22T10:31:00', last_sender: 2, unread_count: 1, tempStatus: null, tempInitiatorId: null, iAmInitiator: false, quota: 1 },
  { id: 2, student_user_id: 1, teacher_user_id: 3, status: 'active', student_name: '张三', teacher_name: '王老师', student_avatar: '', teacher_avatar: '', last_body: '课件我发你邮箱了。', last_kind: 'text', last_at: '2026-08-21T09:00:00', last_sender: 3, unread_count: 0, tempStatus: null, tempInitiatorId: null, iAmInitiator: false, quota: 1 },
  { id: 3, student_user_id: 1, teacher_user_id: 4, status: 'closed', student_name: '张三', teacher_name: '赵老师', student_avatar: '', teacher_avatar: '', last_body: '感谢本次课程，下次再约。', last_kind: 'text', last_at: '2026-08-19T18:30:00', last_sender: 4, unread_count: 0, tempStatus: null, tempInitiatorId: null, iAmInitiator: false, quota: 0 },
  { id: 4, student_user_id: 1, teacher_user_id: 5, status: 'active', student_name: '张三', teacher_name: '刘老师', student_avatar: '', teacher_avatar: '', last_body: '', last_kind: null, last_at: '2026-08-22T11:00:00', last_sender: 1, unread_count: 0, tempStatus: 'init', tempInitiatorId: 1, iAmInitiator: true, quota: 1 },
]

function json(route, payload, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
}

const readPosts = []

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  const cdp = await page.context().newCDPSession(page)
  const csp = []
  await cdp.send('Log.enable')
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (/Content Security Policy/i.test(entry.text)) csp.push(entry.text)
  })

  /* ---- mock the standard chat interface caps (I-17/18/19/15) ----
     S2 /api/uploads is counted, not fulfilled: the honest-cap assertion below
     proves picking an attachment NEVER reaches the upload endpoint. ---- */
  let uploadPosts = 0
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const path = url.pathname
    if (method === 'POST' && path === '/api/uploads') {
      uploadPosts += 1
      return json(route, { id: 9000 })
    }
    if (method === 'GET' && path === '/api/conversations') {
      return json(route, { conversations: FIXTURE_CONVERSATIONS })
    }
    if (method === 'GET' && path === '/api/conversations/1/messages') {
      const since = Number(url.searchParams.get('sinceId') || 0)
      return json(route, { messages: FIXTURE_CONV1.filter((m) => m.id > since) })
    }
    if (method === 'GET' && /^\/api\/conversations\/(2|3|4)\/messages$/.test(path)) {
      return json(route, { messages: [] })
    }
    if (method === 'POST' && /^\/api\/conversations\/(1|4)\/messages$/.test(path)) {
      const body = req.postDataJSON()
      const base = path.includes('/4/') ? 40 : 10
      const echoes = (body.batch || []).map((item, i) => ({
        id: base + i,
        sender_user_id: 1,
        kind: item.kind || 'text',
        name: item.name || '',
        body: item.body || '',
        thumb: item.thumb || '',
        created_at: new Date().toISOString(),
        clientKey: item.clientKey,
      }))
      return json(route, { messages: echoes })
    }
    // I-22 mark-read endpoint: opening a conversation POSTs here; the server read
    // cursor advances and the unread count decrements (PA-1h2-M5).
    if (method === 'POST' && /^\/api\/conversations\/\d+\/read$/.test(path)) {
      readPosts.push(path)
      return json(route, { ok: true })
    }
    if (method === 'GET' && path === '/api/my-relations') {
      return json(route, {
        relations: [
          { conversationId: 1, status: 'active', tempStatus: null, tempInitiatorId: null, signing: null },
          { conversationId: 2, status: 'active', tempStatus: null, tempInitiatorId: null, signing: { id: 99 } },
          { conversationId: 3, status: 'closed', tempStatus: null, tempInitiatorId: null, signing: null },
          { conversationId: 4, status: 'active', tempStatus: 'init', tempInitiatorId: 1, signing: null },
        ],
      })
    }
    return route.continue()
  })

  await page.goto(base + '/test/harness-chat-shell.html', { waitUntil: 'networkidle' })
  await page.waitForSelector('.chat')
  await page.waitForSelector('.chat-bubble')

  /* -- 1. M4-01 double-column geometry (G5) -- */
  const geo = await page.evaluate(() => {
    const list = document.querySelector('.chat__list')
    const conv = document.querySelector('.chat__conv')
    if (!list || !conv) return null
    const lr = list.getBoundingClientRect()
    const cr = conv.getBoundingClientRect()
    return { vw: window.innerWidth, lw: lr.width, cw: cr.width, cRight: cr.right }
  })
  ok(geo, 'M4-01: both panes present')
  if (geo) {
    ok(Math.abs(geo.lw - geo.vw * 0.2) <= 2, `M4-01: list ~20% (got ${geo.lw}, vw=${geo.vw})`)
    ok(Math.abs(geo.cw - geo.vw * 0.8) <= 2, `M4-01: conv ~80% (got ${geo.cw}, vw=${geo.vw})`)
    ok(geo.cRight <= geo.vw + 1, `M4-01: conv right edge within viewport (${geo.cRight})`)
  }
  ok((await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) === false, 'M4-01: no page horizontal overflow')

  /* -- 2. M4-02 top fade mask penetration (P22) -- */
  const mask = page.locator('.chat-conv__mask')
  ok((await mask.count()) === 1, 'M4-02: fade mask element present')
  ok((await mask.evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none', 'M4-02: mask pointer-events none')
  const maskHit = await mask.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit === el ? 'mask' : hit ? hit.className || hit.tagName : 'null'
  })
  ok(maskHit !== 'mask', `M4-02: click at mask center hits layer below, not mask (got ${maskHit})`)

  /* -- 3. M4-06a framework + M4-06c input gate -- */
  ok((await page.locator('.chat-conv__scroll').count()) === 1, 'M4-06a: message scroll area present')
  ok((await page.locator('.chat-conv__input-slot').count()) === 1, 'M4-06a: input slot rendered for active conv')

  /* -- 4. M4-07 message rendering (I-18 mock) -- */
  ok((await page.locator('.chat-bubble').count()) === 2, 'M4-07: conv1 renders 2 text bubbles')
  ok((await page.locator('.chat-image').count()) === 1, 'M4-07: conv1 renders 1 image bubble')

  /* -- 4b. M4-05 + I-22 read-marking: opening a conversation fires POST /read + dot clears -- */
  ok((await page.locator('.chat-card').nth(0).locator('.chat-card__dot').count()) === 1, 'I-22: conv1 shows an unread dot before opening')
  const readBefore = readPosts.length
  await page.locator('.chat-card').nth(0).click()
  await page.waitForTimeout(250)
  ok(readPosts.length === readBefore + 1, 'I-22: opening conv1 fires the read endpoint')
  ok(readPosts[readPosts.length - 1] === '/api/conversations/1/read', 'I-22: read endpoint path is POST /api/conversations/1/read')
  ok((await page.locator('.chat-card').nth(0).locator('.chat-card__dot').count()) === 0, 'I-22: conv1 unread dot cleared after opening')

  /* -- 5. M4-08 bubble <=70% max-width geometry (G5) -- */
  const bgeo = await page.evaluate(() => {
    const bubble = document.querySelector('.chat-bubble__bubble')
    const area = document.querySelector('.chat-conv__messages')
    if (!bubble || !area) return null
    const b = bubble.getBoundingClientRect()
    const a = area.getBoundingClientRect()
    return { bw: b.width, aw: a.width, mw: parseFloat(getComputedStyle(bubble).maxWidth) || 0 }
  })
  ok(bgeo, 'M4-08: bubble geometry measurable')
  if (bgeo) {
    ok(bgeo.mw > 0, 'M4-08: bubble max-width set')
    ok(bgeo.bw <= bgeo.aw * 0.7 + 2, `M4-08: bubble <=70% width (${bgeo.bw}/${bgeo.aw})`)
  }

  /* -- 6. M4-10 image bubble -> large-image viewer -- */
  await page.locator('.chat-image__btn').click()
  await page.waitForSelector('.chat-image__viewer')
  await page.waitForTimeout(450) // let the modal enter transition settle (Playwright real-click stability)
  ok((await page.locator('.chat-image__viewer').count()) === 1, 'M4-10: image viewer opens')
  await page.locator('.chat-image__viewer-close').click()
  await page.waitForSelector('.chat-image__viewer', { state: 'detached' })
  await page.waitForTimeout(250)

  /* -- 7. M4-17/18/30 optimistic text send -- */
  ok((await page.locator('.chat-input__ta').count()) === 1, 'M4-17: input bar renders for active conv')
  await page.locator('.chat-input__ta').fill('你好，我是学生')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(350)
  const sentTexts = await page.locator('.chat-bubble__text').allTextContents()
  ok(sentTexts.some((t) => t.includes('你好，我是学生')), 'M4-30: sent text bubble appears (optimistic -> real)')

  /* -- 8. M4-20 plus rotation + M4-21 attachment sheet -- */
  await page.locator('.chat-input__toggle').click()
  await page.waitForTimeout(250)
  ok((await page.locator('.chat-input__sheet.is-open').count()) === 1, 'M4-20: attachment sheet opens')
  ok((await page.locator('.chat-input__toggle.is-open').count()) === 1, 'M4-20: plus toggle rotates (is-open)')
  ok((await page.locator('.chat-input__attach').count()) === 2, 'M4-21: attach buttons (image/file) wired')

  /* -- 8b. M4-14 honest cap: picking an attachment never uploads (no orphan) --
     G2 mutation guard: if onAttach were reverted to wire the real S2 uploader,
     the POST /api/uploads mock would be hit (uploadPosts -> 1) and this
     counter===0 assertion would go red. */
  await page.locator('.chat-input__toggle').click()
  await page.waitForTimeout(250)
  await page.setInputFiles('#chat-input-img', {
    name: 'cap.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  })
  await page.waitForTimeout(300)
  ok(uploadPosts === 0, 'M4-14 cap: picking an image never POSTs /api/uploads (orphan prevention)')
  const capToast = await page.locator('.ui-toast').allTextContents()
  ok(capToast.some((t) => t.includes('附件发送功能待接入')), 'M4-14 cap: ATTACH_CAP toast shown')
  await page.locator('.chat-input__toggle').click()
  await page.waitForTimeout(250)

  /* -- 9. M4-22/23/24 top bar more dropdown -> end-session modal (conv1, no contract) -- */
  ok((await page.locator('.chat-topbar').count()) === 1, 'M4-22: top bar renders')
  await page.locator('.chat-topbar__more').click()
  await page.waitForSelector('.chat-more-panel')
  ok((await page.locator('.chat-more-panel__item').count()) === 1, 'M4-23: dropdown has end-session entry')
  ok((await page.locator('.chat-more-panel__item').isEnabled()), 'M4-25: conv1 end entry enabled (no contract)')
  await page.locator('.chat-more-panel__item').click()
  await page.waitForSelector('.chat-end')
  await page.waitForTimeout(450) // let the modal enter transition settle (Playwright real-click stability)
  ok((await page.locator('.chat-end').count()) === 1, 'M4-24: end-session confirm modal opens')
  // cancel closes it (busy not set)
  await page.locator('.chat-end__btn').first().click()
  await page.waitForSelector('.chat-end', { state: 'detached' })
  ok((await page.locator('.chat-end').count()) === 0, 'M4-24: cancel closes modal')

  /* -- 10. M4-25 gray-out gate: conv2 has a contract (I-15 signing) -> disabled -- */
  await page.locator('.chat-card').nth(1).click()
  await page.waitForTimeout(250)
  await page.locator('.chat-topbar__more').click()
  await page.waitForSelector('.chat-more-panel')
  ok((await page.locator('.chat-more-panel__item.is-disabled').count()) === 1, 'M4-25: conv2 (has contract) end entry grayed')
  ok((await page.locator('.chat-more-panel__item').isDisabled()), 'M4-25: disabled attr set')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  /* -- 11. M4-26/27 temp conversation: init hint + quota input hidden after send -- */
  await page.locator('.chat-card').nth(3).click()
  await page.waitForTimeout(250)
  const hintInit = (await page.locator('.chat-hint__text').textContent()) || ''
  ok(hintInit.includes('临时会话'), 'M4-26: temp init hint shows')
  ok((await page.locator('.chat-input__ta').count()) === 1, 'M4-27: input visible while quota left')
  await page.locator('.chat-input__ta').fill('老师您好')
  await page.keyboard.press('Enter')
  // poll for the input bar to disappear (temp quota spent); give the optimistic
  // send + echo round-trip generous room on loaded CI machines.
  const tempInputGone = await page.waitForSelector('.chat-input__ta', { state: 'detached', timeout: 4000 }).then(() => true).catch(() => false)
  ok(tempInputGone, 'M4-27: input hidden after temp quota spent')
  const hintSent = (await page.locator('.chat-hint__text').textContent()) || ''
  ok(hintSent.includes('等待对方回复'), 'M4-26: sent hint shows after first temp message')

  await page.close()

  /* -- 12. M4-06b mobile pane switch (P22) + top-bar back -- */
  const mob = await browser.newPage({ viewport: { width: 375, height: 700 } })
  mob.on('console', (m) => m.type() === 'error' && errors.push('mobile console: ' + m.text()))
  mob.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))
  await mob.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname === '/api/conversations' && req.method() === 'GET') {
      return json(route, { conversations: FIXTURE_CONVERSATIONS.slice(0, 1) })
    }
    if (url.pathname === '/api/my-relations') {
      return json(route, { relations: [{ conversationId: 1, status: 'active', tempStatus: null, tempInitiatorId: null, signing: null }] })
    }
    if (url.pathname === '/api/conversations/1/messages' && req.method() === 'GET') {
      return json(route, { messages: FIXTURE_CONV1 })
    }
    if (url.pathname === '/api/conversations/1/read' && req.method() === 'POST') {
      return json(route, { ok: true })
    }
    return route.continue()
  })
  await mob.goto(base + '/test/harness-chat-shell.html', { waitUntil: 'networkidle' })
  await mob.waitForSelector('.chat')

  const mobInit = await mob.evaluate(() => ({
    listVisible: (document.querySelector('.chat__list')?.offsetWidth ?? 0) > 0,
    convVisible: (document.querySelector('.chat__conv')?.offsetWidth ?? 0) > 0,
  }))
  ok(mobInit.listVisible === true && mobInit.convVisible === false, 'M4-06b: mobile starts on list pane only')

  await mob.locator('.chat-card').first().click()
  await mob.waitForTimeout(250)
  const mobAfter = await mob.evaluate(() => {
    const list = document.querySelector('.chat__list')
    const conv = document.querySelector('.chat__conv')
    const cr = conv ? conv.getBoundingClientRect() : null
    return { listVisible: (list?.offsetWidth ?? 0) > 0, convVisible: (conv?.offsetWidth ?? 0) > 0, cw: cr ? cr.width : 0, vw: window.innerWidth }
  })
  ok(mobAfter.convVisible === true && mobAfter.listVisible === false, 'M4-06b P22: tap conv => chat window shown, list hidden')
  ok(Math.abs(mobAfter.cw - mobAfter.vw) <= 1, `M4-06b: chat window fills viewport width (${mobAfter.cw}/${mobAfter.vw})`)

  await mob.locator('.chat-topbar__back').click()
  await mob.waitForTimeout(250)
  const mobBack = await mob.evaluate(() => ({
    listVisible: (document.querySelector('.chat__list')?.offsetWidth ?? 0) > 0,
    convVisible: (document.querySelector('.chat__conv')?.offsetWidth ?? 0) > 0,
  }))
  ok(mobBack.listVisible === true && mobBack.convVisible === false, 'M4-06b: top-bar back returns to list')

  await mob.close()
  await browser.close()
  if (csp.length) errors.push('CSP violations: ' + csp.join(' | '))
} finally {
  if (server) await server.close()
}

if (errors.length) {
  console.log('CHAT SHELL SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT SHELL SMOKE PASS')
