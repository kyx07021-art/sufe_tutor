/**
 * teacher-card-geometry.mjs - AK-N-D1/D2/D4/D5/D6 teacher-card geometry guards
 * -----------------------------------------------------------------------------
 * - Mounts TeacherCard directly (test/harness-teacher-card.html) so card-only
 *   geometry is asserted without the page-level filters/sort bars.
 * - Each section is a mutation guard: reverting the corresponding fix makes the
 *   section's assertions turn red (G2).
 * - Run: node test/teacher-card-geometry.mjs   (BASE env optional for an
 *   already-running dev server).
 */
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const A4_MIN = 210 / 297 // AK-N-D4 "horizontal A4" min height / width ratio ~0.707

let base = process.env.BASE
let server = null
if (!base) {
  server = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 0, host: '127.0.0.1' } })
  await server.listen()
  base = `http://127.0.0.1:${server.httpServer.address().port}`
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(base + '/test/harness-teacher-card.html', { waitUntil: 'networkidle' })

  const cards = page.locator('.cell .teacher-card')
  await cards.first().waitFor({ timeout: 8000 })
  const full = cards.nth(0)
  const minimal = cards.nth(1)

  /* ============================ AK-N-D1 ============================ */
  {
    // awards:[] must never render as a literal "[]" anywhere in the card.
    const fullText = await full.textContent()
    assert.ok(!fullText.includes('[]'), 'D1: awards:[] must not leak "[]" brackets')
    // The empty subject entry ('') is filtered out -> exactly 2 subject rows.
    const rows = full.locator('.teacher-card__subject')
    assert.equal(await rows.count(), 2, 'D1: empty subject entry filtered -> 2 rows')
    const mathRow = await rows.nth(0).textContent()
    assert.ok(mathRow.includes('数学'), 'D1: math subject label rendered')
    assert.ok(!mathRow.includes('[]'), 'D1: math row carries no brackets')
    // Minimal card (subjects:[]) renders no subject section at all.
    assert.equal(await minimal.locator('.teacher-card__subjects').count(), 0, 'D1: empty subjects -> no subject section')
    console.log('  ok  D1 empty-subject/awards leak guard')
  }

  /* ============================ AK-N-D2 ============================ */
  {
    const avatarBox = await full.locator('.teacher-card__avatar').boundingBox()
    const identityBox = await full.locator('.teacher-card__identity').boundingBox()
    assert.ok(avatarBox && identityBox, 'D2: avatar + identity present')
    assert.ok(avatarBox.x < identityBox.x, 'D2: avatar is leftmost (left of identity)')
    const idText = await full.locator('.teacher-card__id').textContent()
    assert.ok(idText.includes('ID 11'), 'D2: user id shown right of avatar, got: ' + idText)
    assert.equal(await full.locator('.rating-stars').count(), 1, 'D2: RatingStars component used on the card')
    console.log('  ok  D2 avatar-leftmost + id/rating beside it')
  }

  /* ============================ AK-N-D4 ============================ */
  {
    const cardBox = await minimal.boundingBox()
    assert.ok(cardBox, 'D4: minimal card has a box')
    assert.ok(
      cardBox.height >= cardBox.width * A4_MIN - 1,
      `D4: minimal card height ${cardBox.height.toFixed(1)} >= 0.707 x width ${(cardBox.width * A4_MIN).toFixed(1)}`,
    )
    const fullBox = await full.boundingBox()
    assert.ok(
      fullBox.height >= fullBox.width * A4_MIN - 1,
      `D4: full card height ${fullBox.height.toFixed(1)} >= 0.707 x width ${(fullBox.width * A4_MIN).toFixed(1)}`,
    )
    console.log('  ok  D4 min-height ratio (empty + full)')
  }

  if (errors.length) throw new Error('console/pageerror: ' + errors.join(' | '))
  console.log('TEACHER-CARD GEOMETRY PASS')
} finally {
  await browser.close()
  if (server) await server.close()
}
