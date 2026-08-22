/**
 * M3 C1 relations module smoke test (smoke-relations.mjs)
 * -------------------------------------------------------
 * Three layers:
 *   1. Node-side pure-function assertions (data.js / layout.js / curve.js):
 *      I-15 mock access + concentric-circle invariants (N=1/2/3/multi-edge)
 *      + dashed-curve invariants + NON-OVERLAP MUTATION GUARD.
 *   2. Browser render (Vite dev server, self-started unless BASE is set):
 *      I-15 mocked via route interception -> board renders -> geometry
 *      assertions (avatars on circle, no overlap, in-viewport, 375 no overflow)
 *      -> F4 relation-card geometry (midpoint float cards non-overlapping /
 *      in-board; compact list cards below the board; 1366x768 geometric-strip
 *      lock) -> zero console/pageerror -> flow class toggle + reduced-motion
 *      degrade.
 *   3. Contract-6 static scan of module source (zero inline style/event
 *      literals, zero <style> injection, zero CJK outside the copy single source).
 *
 * Run: node test/smoke-relations.mjs    (self-starts a Vite dev server on an
 *      ephemeral port; or set BASE=http://host:port to reuse a running server)
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MOD = join(ROOT, 'src', 'modules', 'relations')
const CONSTS = join(ROOT, 'src', 'constants', 'm-relations.js')

const errors = []
const ok = (m) => console.log('  ok  ' + m)
const fail = (m) => errors.push(m)

/** Axis-aligned box intersection (box-level test for float cards / self). */
function intersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

// ============================================================
// 1. Pure-function assertions
// ============================================================
async function pureChecks() {
  const data = await import(pathToFileURL(join(MOD, 'data.js')).href)
  const layout = await import(pathToFileURL(join(MOD, 'layout.js')).href)
  const curve = await import(pathToFileURL(join(MOD, 'curve.js')).href)
  const actions = await import(pathToFileURL(join(MOD, 'actions.js')).href)

  console.log('— pure checks —')

  // --- M3-01: I-15 mock access ---
  const mock = {
    relations: [
      { conversationId: 1, status: 'active', tempStatus: null, tempInitiatorId: null, other: { id: 101, role: 'teacher', name: '李老师', avatar: '' }, last: { text: '你好' }, signing: null },
      { conversationId: 2, status: 'active', other: { id: 102, role: 'teacher', name: '王老师', avatar: '' }, signing: null },
      { conversationId: 3, status: 'closed', other: { id: 103, role: 'teacher', name: '赵老师', avatar: '' }, signing: { id: 5 } },
      { conversationId: 4, status: 'active', other: { id: 104, role: 'student', name: '小明', avatar: '' }, signing: null },
      { conversationId: 5, status: 'active', other: { id: 105, role: 'teacher', name: '钱老师', avatar: '' }, signing: null },
      { conversationId: 6, status: 'closed', other: { id: 106, role: 'teacher', name: '孙老师', avatar: '' }, signing: null },
    ],
  }
  const parsed = data.parseMyRelations(mock)
  if (parsed.nodes.length !== 6 || parsed.edges.length !== 6 || parsed.total !== 6) fail('parseMyRelations node/edge/total counts')
  else ok('parseMyRelations 6 nodes / 6 edges / total 6')
  const closed = parsed.nodes.find((n) => n.userId === 103)
  if (!(closed.status === 'closed' && closed.hasContract === true && closed.edgeCount === 1)) fail('closed node status/contract/edgeCount')
  else ok('closed + contract node mapped (status=closed, hasContract=true)')

  // aggregation by other.id
  const agg = data.parseMyRelations({
    relations: [
      { conversationId: 1, status: 'active', other: { id: 101, role: 'teacher', name: '李老师', avatar: '' }, signing: null },
      { conversationId: 2, status: 'closed', other: { id: 101, role: 'teacher', name: '李老师', avatar: '' }, signing: { id: 9 } },
    ],
  })
  if (!(agg.nodes.length === 1 && agg.nodes[0].edgeCount === 2 && agg.nodes[0].hasContract === true && agg.nodes[0].status === 'active')) fail('aggregation by other')
  else ok('aggregation by other.id (edgeCount=2, hasContract, active)')

  // fail-closed shape validation
  let threw = false
  try { data.parseMyRelations({ relations: [{ conversationId: 'x', status: 'active', other: { id: 1, role: 'teacher', name: 'a' } }] }) } catch (e) { threw = e instanceof data.RelationsShapeError }
  if (!threw) fail('shape validation: bad conversationId must throw RelationsShapeError')
  else ok('shape validation rejects malformed row')
  const empty = data.parseMyRelations({ relations: [] })
  if (empty.nodes.length !== 0 || empty.total !== 0) fail('empty relations')
  else ok('empty relations -> empty model')

  // --- M3-03: concentric layout ---
  // N=1
  const one = layout.layoutCircle([{ userId: 1, edgeCount: 1 }], { radius: 200, center: { x: 100, y: 100 }, avatarDiameter: 100 })
  if (!(one.positions.length === 1 && Math.abs(one.positions[0].x - 300) < 1e-9 && Math.abs(one.positions[0].y - 100) < 1e-9)) fail('N=1 at positive right')
  else ok('layout N=1 single avatar at east')

  // N=2 / N=3 / multi-edge: angles tile 2pi, max-edge at 0, non-overlap
  const configs = [
    [{ userId: 1, edgeCount: 1 }, { userId: 2, edgeCount: 1 }],
    [{ userId: 1, edgeCount: 1 }, { userId: 2, edgeCount: 1 }, { userId: 3, edgeCount: 1 }],
    [{ userId: 1, edgeCount: 1 }, { userId: 2, edgeCount: 1 }, { userId: 3, edgeCount: 10 }],
  ]
  for (const nodes of configs) {
    const r = layout.layoutCircle(nodes, { radius: 300, center: { x: 0, y: 0 }, avatarDiameter: 100 })
    const angles = r.positions.map((p) => p.angle).sort((a, b) => a - b)
    // distinct angles, sorted within [0, 2pi)
    if (!(angles.length === nodes.length && angles.every((a) => a >= 0 && a < 2 * Math.PI))) fail('angles in [0,2pi)')
    // max-edge node at 0
    const maxEdge = nodes.reduce((m, n) => (n.edgeCount > m.edgeCount ? n : m))
    const maxPos = r.positions.find((p) => p.node.userId === maxEdge.userId)
    if (!(Math.abs(maxPos.angle) < 1e-9 || Math.abs(maxPos.angle - 2 * Math.PI) < 1e-9)) fail('max-edge node not at positive right')
    // all on circle
    for (const p of r.positions) {
      const d = Math.hypot(p.x, p.y)
      if (Math.abs(d - 300) > 1e-6) fail('position off circle')
    }
    // non-overlap (chord >= avatarDiameter)
    for (let i = 0; i < r.positions.length; i++) {
      for (let j = i + 1; j < r.positions.length; j++) {
        const d = Math.hypot(r.positions[i].x - r.positions[j].x, r.positions[i].y - r.positions[j].y)
        if (d < 100 - 1e-6) fail('overlap for config ' + JSON.stringify(nodes.map((n) => n.edgeCount)))
      }
    }
  }
  ok('layout N=1/2/3 + multi-edge: on-circle, max-edge east, no overlap')

  // --- M3-03 mutation guard: the non-overlap floor is load-bearing ---
  // Config where pure-proportional placement OVERLAPS but the guarded layout does not.
  const d = 100
  const R = d / (2 * Math.sin((20 * Math.PI) / 180)) // minSep = 40deg
  const nodes = [{ userId: 1, edgeCount: 1 }, { userId: 2, edgeCount: 1 }, { userId: 3, edgeCount: 10 }]
  const guarded = layout.layoutCircle(nodes, { radius: R, center: { x: 0, y: 0 }, avatarDiameter: d })
  const total = 12 // 1 + 1 + 10
  // Simulated "mutation": pure proportional spans without the minSep floor.
  const pureSpans = nodes.map((n) => ((n.edgeCount / total) * 2 * Math.PI))
  const pureCenters = []
  let cum = 0
  for (let i = 0; i < nodes.length; i++) { cum += pureSpans[i] / 2; pureCenters.push(cum); cum += pureSpans[i] / 2 }
  const pureRot = pureCenters[2] // max-edge at index 2
  let minPureGap = Infinity
  for (let i = 0; i < nodes.length; i++) {
    const a = pureCenters[i] - pureRot, b = pureCenters[(i + 1) % nodes.length] - pureRot
    let gap = Math.min(Math.abs(a - b), 2 * Math.PI - Math.abs(a - b))
    minPureGap = Math.min(minPureGap, gap)
  }
  const pureOverlaps = 2 * R * Math.sin(minPureGap / 2) < d
  if (!pureOverlaps) fail('mutation guard: test config must overlap under pure-proportional (bad fixture)')
  else ok('mutation guard: pure-proportional WOULD overlap (fixture has teeth)')
  let minGuardedChord = Infinity
  for (let i = 0; i < guarded.positions.length; i++) {
    for (let j = i + 1; j < guarded.positions.length; j++) {
      minGuardedChord = Math.min(minGuardedChord, Math.hypot(guarded.positions[i].x - guarded.positions[j].x, guarded.positions[i].y - guarded.positions[j].y))
    }
  }
  if (minGuardedChord < d - 1e-6) fail('mutation guard: guarded layout still overlaps (guard missing)')
  else ok('mutation guard: guarded layout non-overlapping (minChord ' + minGuardedChord.toFixed(1) + ' >= ' + d + ')')

  // --- M3-04: dashed curve invariants ---
  const from = { x: 100, y: 100 }, to = { x: 300, y: 100 }
  const c1 = curve.buildCurves(1, from, to)
  if (!(c1.length === 1 && c1[0].path.startsWith('M 100 100 L 300 100'))) fail('curve N=1 straight')
  const c3 = curve.buildCurves(3, from, to)
  if (!(c3.length === 3 && c3[1].path.startsWith('M 100 100 L 300 100'))) fail('curve N=3 middle straight')
  const cubicMid = (dstr) => { const p = dstr.match(/-?[\d.]+/g).map(Number); return { x: (p[0] + 3 * p[2] + 3 * p[4] + p[6]) / 8, y: (p[1] + 3 * p[3] + 3 * p[5] + p[7]) / 8 } }
  let okCurves = true
  for (const N of [2, 3, 4, 5]) {
    const cs = curve.buildCurves(N, from, to)
    if (cs.length !== N) { okCurves = false; break }
    const mids = cs.map((c) => (c.path.startsWith('M 100 100 L') ? { x: 200, y: 100 } : cubicMid(c.path)))
    for (let i = 0; i < N; i++) if (!(cs[i].path.startsWith('M 100 100') && cs[i].path.endsWith('300 100'))) okCurves = false
    if (Math.abs((mids[0].y - 100) + (mids[N - 1].y - 100)) > 1e-6) okCurves = false
    for (let i = 0; i < N - 1; i++) if (Math.abs(mids[i + 1].y - mids[i].y) < curve.CURVE_GAP_MIN - 1e-6) okCurves = false
  }
  if (!okCurves) fail('curve invariants (N=2..5 symmetric, gap>=threshold, shared endpoints)')
  else ok('curve N=1..5: straight middle, symmetry, gap>=CURVE_GAP_MIN, shared endpoints')
  const c2off = Math.abs(cubicMid(curve.buildCurves(2, from, to)[0].path).y - 100)
  const c3off = Math.abs(cubicMid(curve.buildCurves(3, from, to)[0].path).y - 100)
  if (!(c3off > c2off)) fail('curve N=3 outer bend must exceed N=2 bend')
  else ok('curve bend increases N=2 (' + c2off + ') < N=3 (' + c3off + ')')
  if (curve.buildCurves(0, from, to).length !== 0) fail('curve N=0 -> []')
  else ok('curve N=0 -> []')

  // --- PA-1h2-M1: open-conversation wiring (actions.js) ---
  // The card click must (1) activate the chat store with the conversation id and
  // (2) deep-link the router to /chat?conv=<id>. Deps are injected so plain Node
  // can exercise the wiring without loading the Vite-only '@/' alias.
  {
    const opened = []
    const pushed = []
    await actions.openRelationConversation(42, {
      openChat: (id) => opened.push(id),
      push: async (route) => pushed.push(route),
    })
    if (opened[0] !== 42) fail('openRelationConversation must activate the chat store with the conversation id (got ' + opened[0] + ')')
    const route = pushed[0]
    if (!(route && route.path === actions.RELATIONS_CHAT_ROUTE && route.query && route.query.conv === '42')) fail('openRelationConversation must push ' + actions.RELATIONS_CHAT_ROUTE + '?conv=42')
    else ok('openRelationConversation wires chat activation + ' + actions.RELATIONS_CHAT_ROUTE + '?conv deep-link')
    // null guard: a card without a conversation id must not fire any navigation.
    let calls = 0
    await actions.openRelationConversation(null, { openChat: () => calls++, push: async () => { calls++ } })
    if (calls !== 0) fail('openRelationConversation must no-op for null/undefined conversationId')
    else ok('openRelationConversation null guard')
  }
}

// ============================================================
// 2. Browser render
// ============================================================
async function browserChecks(base) {
  console.log('— browser render @ ' + base + ' —')
  const browser = await chromium.launch()
  try {
    // default context (no reduced-motion) -> flow ON
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const consoleErrs = []
    page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()))
    page.on('pageerror', (e) => consoleErrs.push('pageerror: ' + e.message))
    await page.route('**/api/my-relations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          relations: [
            { conversationId: 1, status: 'active', tempStatus: null, other: { id: 101, role: 'teacher', name: '李老师', avatar: '' }, last: { text: '你好' }, signing: null },
            { conversationId: 2, status: 'active', other: { id: 102, role: 'teacher', name: '王老师', avatar: '' }, signing: null },
            { conversationId: 3, status: 'closed', other: { id: 103, role: 'teacher', name: '赵老师', avatar: '' }, signing: { id: 5 } },
            { conversationId: 4, status: 'active', other: { id: 104, role: 'student', name: '小明', avatar: '' }, signing: null },
            { conversationId: 5, status: 'active', other: { id: 105, role: 'teacher', name: '钱老师', avatar: '' }, signing: null },
            { conversationId: 6, status: 'closed', other: { id: 106, role: 'teacher', name: '孙老师', avatar: '' }, signing: null },
          ],
        }),
      }),
    )
    // PA-1h2-M1: the card/avatar click activates the chat store, which fires
    // /conversations/<id>/messages (loadMessages). Intercept so the harness stays
    // backend-free and the wiring is asserted on the store, not on network noise.
    await page.route('**/api/conversations/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }),
    )
    await page.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await page.goto(base + '/test/harness-relations.html', { waitUntil: 'networkidle' })

    const avatars = page.locator('.rel-avatar')
    const cards = page.locator('.rel-card')
    const lines = page.locator('.rel-line__path')
    await avatars.first().waitFor({ timeout: 8000 })

    const avatarCount = await avatars.count()
    const cardCount = await cards.count()
    const lineCount = await lines.count()
    if (!(avatarCount === 7)) fail('avatar count = ' + avatarCount + ' (expected 7)')
    else ok('avatars rendered: 6 others + 1 self')
    if (cardCount !== 6) fail('card count = ' + cardCount + ' (expected 6)')
    else ok('relation cards rendered: 6')
    if (lineCount !== 6) fail('line path count = ' + lineCount + ' (expected 6)')
    else ok('dashed line paths rendered: 6')

    // flow class on by default
    const flowing = await page.locator('.relations-board').evaluate((el) => el.classList.contains('is-flowing'))
    if (!flowing) fail('board missing is-flowing class (default context)')
    else ok('flow animation class applied (is-flowing)')

    // dot grid present
    const gridBg = await page.locator('.relations-board').evaluate((el) => getComputedStyle(el).backgroundImage)
    if (!/radial-gradient/.test(gridBg)) fail('board dot grid missing')
    else ok('dot grid (radial-gradient) present')

    // z-order tokens single source
    const z = await page.evaluate(() => {
      const board = document.querySelector('.relations-board')
      const layers = [...board.querySelectorAll('.relations-board__layer')]
      const by = (c) => layers.find((l) => l.classList.contains(c)) && getComputedStyle(layers.find((l) => l.classList.contains(c))).zIndex
      return { line: by('relations-board__layer--lines'), avatar: by('relations-board__layer--avatars'), card: by('relations-board__layer--cards') }
    })
    if (!(z.line === '1' && z.avatar === '2' && z.card === '3')) fail('z-order tokens wrong: ' + JSON.stringify(z))
    else ok('z-order layers line=1 avatar=2 card=3')

    // geometry: self at center; others on circle; no overlap; in-viewport
    const geo = await page.evaluate(() => {
      const rects = [...document.querySelectorAll('.rel-avatar')].map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width, isSelf: el.classList.contains('rel-avatar--self') }
      })
      const self = rects.find((r) => r.isSelf)
      return { rects, self }
    })
    if (!geo.self) fail('self avatar missing')
    else {
      let bad = 0
      let minChord = Infinity
      for (const r of geo.rects) {
        if (r.isSelf) continue
        const dist = Math.hypot(r.x - geo.self.x, r.y - geo.self.y)
        if (dist < 100 || dist > 600) bad++ // sanity: reasonable radius band
      }
      for (let i = 0; i < geo.rects.length; i++) {
        for (let j = i + 1; j < geo.rects.length; j++) {
          minChord = Math.min(minChord, Math.hypot(geo.rects[i].x - geo.rects[j].x, geo.rects[i].y - geo.rects[j].y))
        }
      }
      // avatars must not overlap each other (diameter 100)
      if (minChord < 100 - 1) fail('avatar overlap, minChord=' + minChord.toFixed(1))
      else ok('avatars non-overlapping (minChord ' + minChord.toFixed(1) + 'px)')
      if (bad) fail('outer avatar not on concentric circle (bad=' + bad + ')')
      else ok('outer avatars on concentric circle')
      const vw = await page.evaluate(() => window.innerWidth)
      const out = geo.rects.filter((r) => r.x < 0 || r.x > vw || r.y < 0)
      if (out.length) fail('avatar out of viewport: ' + out.length)
      else ok('avatars in-viewport')
    }

    // ---- F4 card geometry (desktop 1440x900, 6 equal-edge relations) ----
    // Midpoint mode: 6 float cards hang in the board's cards layer at the dashed
    // edge midpoints. Each card must clear the self avatar and its neighbors and
    // stay inside the board. The fitted width (tightest of max / center
    // clearance / adjacent chord, never clamped up) lands at ~154px in [140, 200].
    const boardCardCount = await page.locator('.relations-board__layer--cards .rel-card').count()
    if (boardCardCount !== 6) fail('expected 6 float cards, got ' + boardCardCount)
    else {
      const selfRect = await page.evaluate(() => {
        const el = document.querySelector('.rel-avatar--self')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })
      const boardRect = await page.locator('.relations-board').first().evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })
      const cardRects = await page.evaluate(() =>
        [...document.querySelectorAll('.relations-board__layer--cards .rel-card')].map((el) => {
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
        }),
      )
      if (!selfRect) fail('self avatar missing for card geometry')
      else {
        let selfHits = 0
        for (const r of cardRects) if (intersect(r, selfRect)) selfHits++
        if (selfHits) fail('float card overlaps self avatar: ' + selfHits)
        let pairHits = 0
        for (let i = 0; i < cardRects.length; i++)
          for (let j = i + 1; j < cardRects.length; j++)
            if (intersect(cardRects[i], cardRects[j])) pairHits++
        if (pairHits) fail('float card-card overlap: ' + pairHits + ' pairs')
        let narrow = 0
        for (const r of cardRects) if (r.width < 140 - 0.5 || r.width > 200 + 0.5) narrow++
        if (narrow) fail('float card width out of [140,200]: ' + narrow)
        let outBoard = 0
        for (const r of cardRects)
          if (r.left < boardRect.left - 1 || r.right > boardRect.right + 1 || r.top < boardRect.top - 1 || r.bottom > boardRect.bottom + 1) outBoard++
        if (outBoard) fail('float card out of board bounds: ' + outBoard)
        if (!selfHits && !pairHits && !narrow && !outBoard) ok('desktop float cards: no self overlap, no card-card overlap, in-board')
      }
    }

    if (consoleErrs.length) fail('console/pageerror: ' + consoleErrs.join(' | '))
    else ok('zero console/pageerror')

    // ---- PA-1h2-M1: dead-UI wiring (open-conversation / open-profile) ----
    // Card click must open the conversation page at that conversation: the harness
    // has no router install (router push degrades to a guarded no-op navigation),
    // so the observable wiring is the chat-store activation the page performs
    // before pushing. First float card maps to conversationId 1.
    await page.locator('.rel-card__btn').first().click()
    await page.waitForFunction(() => window.__REL_TEST__ && window.__REL_TEST__.chatState.activeConversationId === 1)
    const activeAfterCard = await page.evaluate(() => window.__REL_TEST__.chatState.activeConversationId)
    if (activeAfterCard !== 1) fail('card click must open conversation 1 (chat store), got ' + activeAfterCard)
    else ok('card click activates conversation 1 in the chat store')

    // Avatar click must open the peer profile modal (open-profile wiring). The
    // 2nd other avatar is node 102 (single active edge -> conversationId 2), so
    // the modal's open-chat entry exercises a NEW conversation (not the one the
    // card click already activated).
    await page.locator('.rel-avatar:not(.rel-avatar--self)').nth(1).click()
    const profileOpen = await page.locator('.rel-profile').isVisible()
    if (!profileOpen) fail('avatar click must open the peer profile modal')
    else ok('avatar click opens the peer profile modal')

    // The modal's open-chat entry must jump into that peer's conversation (node
    // 102 -> conversationId 2) and then close itself.
    await page.locator('.rel-profile__chat').click()
    await page.waitForFunction(() => window.__REL_TEST__ && window.__REL_TEST__.chatState.activeConversationId === 2)
    const activeAfterModalChat = await page.evaluate(() => window.__REL_TEST__.chatState.activeConversationId)
    if (activeAfterModalChat !== 2) fail('modal open-chat must open conversation 2, got ' + activeAfterModalChat)
    const modalClosed = await page.locator('.rel-profile').count()
    if (modalClosed !== 0) fail('profile modal must close after open-chat')
    if (activeAfterModalChat === 2 && modalClosed === 0) ok('profile modal open-chat routes conversation 2 and closes')

    if (consoleErrs.length) fail('console/pageerror after wiring: ' + consoleErrs.join(' | '))
    else ok('zero console/pageerror after wiring')

    // ended cards (2 closed relations in the fixture) are grayed but clickable
    const endedCard = page.locator('.rel-card__btn--ended')
    if (await endedCard.count() !== 2) fail('expected 2 ended cards, got ' + await endedCard.count())
    else {
      const disabled = await endedCard.first().evaluate((el) => el.hasAttribute('disabled'))
      if (disabled) fail('ended card must remain clickable (non-disabled)')
      else ok('ended cards (2) grayed but clickable')
      const bg = await endedCard.first().evaluate((el) => getComputedStyle(el).backgroundColor)
      if (bg !== 'rgb(230, 230, 230)') fail('ended card bg must be gray-10 #e6e6e6, got ' + bg)
      else ok('ended card computed gray background (gray-10)')
    }

    // ---- mobile 375 geometry (dual-viewport discipline) ----
    const mobile = await browser.newPage({ viewport: { width: 375, height: 700 } })
    const mobileErrs = []
    mobile.on('console', (m) => m.type() === 'error' && mobileErrs.push(m.text()))
    mobile.on('pageerror', (e) => mobileErrs.push('pageerror: ' + e.message))
    await mobile.route('**/api/my-relations', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ relations: [
        { conversationId: 1, status: 'active', other: { id: 201, role: 'teacher', name: '李老师', avatar: '' }, signing: null },
        { conversationId: 2, status: 'closed', other: { id: 202, role: 'teacher', name: '王老师', avatar: '' }, signing: null },
        { conversationId: 3, status: 'active', other: { id: 203, role: 'teacher', name: '赵老师', avatar: '' }, signing: null },
      ] }) }),
    )
    await mobile.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await mobile.goto(base + '/test/harness-relations.html', { waitUntil: 'networkidle' })
    await mobile.locator('.rel-avatar').first().waitFor({ timeout: 8000 })
    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    const mobileBad = await mobile.evaluate(() => {
      const vw = window.innerWidth
      return [...document.querySelectorAll('.rel-avatar')].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.left < -1 || r.right > vw + 1
      }).length
    })
    if (mobileOverflow) fail('mobile 375 horizontal overflow')
    else ok('mobile 375 no page overflow')
    if (mobileBad) fail('mobile avatars out of viewport: ' + mobileBad)
    else ok('mobile avatars in-viewport')

    // ---- F4 list mode on mobile (compact viewport) ----
    // The 3-relation fixture cannot fit readable midpoint cards on a 375px stage
    // (fitted width ~5px < CARD_W_MIN), so the cards render as a vertical list
    // BELOW the board; the board's cards layer must hold zero floating cards and
    // every list card must carry a user-name label.
    const mobileBoardCards = await mobile.locator('.relations-board__layer--cards .rel-card').count()
    if (mobileBoardCards !== 0) fail('mobile should have no floating cards, got ' + mobileBoardCards)
    const mobileListCards = await mobile.locator('.relations-page__cards .rel-card').count()
    if (mobileListCards !== 3) fail('mobile list cards = ' + mobileListCards + ' (expected 3)')
    const mobileListNames = await mobile.locator('.relations-page__cards .rel-card__name').count()
    if (mobileListNames !== 3) fail('list cards must show user names, got ' + mobileListNames)
    if (mobileBoardCards === 0 && mobileListCards === 3 && mobileListNames === 3) ok('mobile list cards rendered with names, no floating cards')

    if (mobileErrs.length) fail('mobile console: ' + mobileErrs.join(' | '))
    else ok('mobile zero console')
    await mobile.close()

    // ---- reduced-motion: flow OFF, lines still visible ----
    const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const rmPage = await rm.newPage()
    await rmPage.route('**/api/my-relations', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ relations: [
        { conversationId: 1, status: 'active', other: { id: 301, role: 'teacher', name: '李老师', avatar: '' }, signing: null },
      ] }) }),
    )
    await rmPage.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await rmPage.goto(base + '/test/harness-relations.html', { waitUntil: 'networkidle' })
    await rmPage.locator('.rel-avatar').first().waitFor({ timeout: 8000 })
    const rmFlowing = await rmPage.locator('.relations-board').evaluate((el) => el.classList.contains('is-flowing'))
    const rmLineCount = await rmPage.locator('.rel-line__path').count()
    if (rmFlowing) fail('reduced-motion should NOT add is-flowing')
    else ok('reduced-motion: flow class off')
    if (rmLineCount !== 1) fail('reduced-motion lines should stay visible (count=' + rmLineCount + ')')
    else ok('reduced-motion: dashed lines still visible')
    await rmPage.close()
    await rm.close()

    // ---- F4 1366x768 geometric-strip lock ----
    // Mid-size desktop window (6 equal-edge relations, radius ~258): the fitted
    // width drops to ~92px < CARD_W_MIN even though the viewport is wide, so the
    // geometric gate must switch to list mode (zero floating cards in the board,
    // 6 list cards below it). This locks the residual window that a fixed 560px
    // breakpoint alone would miss.
    const mid = await browser.newPage({ viewport: { width: 1366, height: 768 } })
    const midErrs = []
    mid.on('console', (m) => m.type() === 'error' && midErrs.push(m.text()))
    mid.on('pageerror', (e) => midErrs.push('pageerror: ' + e.message))
    await mid.route('**/api/my-relations', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          relations: [
            { conversationId: 1, status: 'active', tempStatus: null, other: { id: 101, role: 'teacher', name: '李老师', avatar: '' }, last: { text: '你好' }, signing: null },
            { conversationId: 2, status: 'active', other: { id: 102, role: 'teacher', name: '王老师', avatar: '' }, signing: null },
            { conversationId: 3, status: 'closed', other: { id: 103, role: 'teacher', name: '赵老师', avatar: '' }, signing: { id: 5 } },
            { conversationId: 4, status: 'active', other: { id: 104, role: 'student', name: '小明', avatar: '' }, signing: null },
            { conversationId: 5, status: 'active', other: { id: 105, role: 'teacher', name: '钱老师', avatar: '' }, signing: null },
            { conversationId: 6, status: 'closed', other: { id: 106, role: 'teacher', name: '孙老师', avatar: '' }, signing: null },
          ],
        }),
      }),
    )
    await mid.addInitScript(() => localStorage.setItem('authToken', 'smoke-token'))
    await mid.goto(base + '/test/harness-relations.html', { waitUntil: 'networkidle' })
    await mid.locator('.rel-avatar').first().waitFor({ timeout: 8000 })
    const boardCards768 = await mid.locator('.relations-board__layer--cards .rel-card').count()
    if (boardCards768 !== 0) fail('1366x768 must use list mode (no floating cards) — geometric strip, got ' + boardCards768)
    const listCards768 = await mid.locator('.relations-page__cards .rel-card').count()
    if (listCards768 !== 6) fail('1366x768 list cards = ' + listCards768 + ' (expected 6)')
    if (midErrs.length) fail('1366x768 console/pageerror: ' + midErrs.join(' | '))
    if (boardCards768 === 0 && listCards768 === 6 && midErrs.length === 0) ok('1366x768 geometric strip lock')
    await mid.close()

    await page.close()
  } finally {
    await browser.close()
  }
}

// ============================================================
// 3. Contract-6 static scan
// ============================================================
async function contractChecks() {
  console.log('— contract 6 static scan —')
  const targets = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(js|vue)$/.test(name)) targets.push(p)
    }
  }
  walk(MOD)

  const cjk = /[一-鿿]/
  const inlineEvent = /\b(?:onclick|onload|onchange|onmouseover|onerror)\s*=/
  // literal HTML style= attr (Vue `:style` CSSOM bindings are excluded)
  const styleAttr = /(?<!:)style\s*=\s*["']/
  const styleInjection = /createElement\(['"]style['"]\)/
  const vhtml = /\bv-html\b/

  let bad = 0
  for (const file of targets) {
    const src = readFileSync(file, 'utf8')
    // CJK allowed ONLY in src/constants/m-relations.js (copy single source)
    if (file !== CONSTS && cjk.test(src)) { fail('CJK in ' + file); bad++ }
    if (inlineEvent.test(src)) { fail('inline event attr in ' + file); bad++ }
    if (styleAttr.test(src)) { fail('literal style= attr in ' + file); bad++ }
    if (styleInjection.test(src)) { fail('<style> injection in ' + file); bad++ }
    if (vhtml.test(src)) { fail('v-html in ' + file); bad++ }
  }
  if (bad === 0) ok('module source clean: zero CJK (outside copy), zero inline event/style literals, zero <style> injection, zero v-html')
  else fail('contract 6 violations: ' + bad)
}

// ============================================================
// main
// ============================================================
let server = null
let base = process.env.BASE
if (!base) {
  server = await createServer({
    root: ROOT,
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
  })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}

try {
  await pureChecks()
  await browserChecks(base)
  await contractChecks()
} finally {
  if (server) await server.close()
}

if (errors.length) {
  console.log('\nSMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('\nSMOKE PASS: relations module pure functions + browser geometry + contract 6 clean')
}
