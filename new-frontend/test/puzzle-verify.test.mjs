/**
 * test/puzzle-verify.test.mjs — AK-A1a local alignment pure-function tests
 * ------------------------------------------------------------------------
 * Covers isPuzzleAligned (puzzleRender.js): the browser-local pass decision that
 * replaced the POST /api/captcha/verify round-trip.
 *   - default tolerance (PUZZLE_TOLERANCE=0.08): clearly-inside passes / clearly-outside
 *     fails / NaN and undefined never pass
 *   - exact boundary is locked with a power-of-two tolerance override (0.125) so the
 *     diff hits the tolerance EXACTLY in IEEE754 — G2: mutating `<=` to `<` must go red
 *
 * Run: node test/puzzle-verify.test.mjs   (also picked up by the frontend runner)
 */
import { isPuzzleAligned, PUZZLE_TOLERANCE } from '../src/modules/auth/puzzle/puzzleRender.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

// default tolerance: clearly inside / clearly outside (0.08 has no exact binary form,
// so avoid asserting the exact floating boundary with the default).
ok(isPuzzleAligned(0.5, 0.5) === true, 'exact alignment passes')
ok(isPuzzleAligned(0.5 + (PUZZLE_TOLERANCE - 0.0001), 0.5) === true, 'just inside tolerance passes')
ok(isPuzzleAligned(0.5 - (PUZZLE_TOLERANCE - 0.0001), 0.5) === true, 'just inside tolerance below passes')
ok(isPuzzleAligned(0.5 + (PUZZLE_TOLERANCE + 0.0001), 0.5) === false, 'just past tolerance fails')
ok(isPuzzleAligned(0, 1) === false, 'far off fails')
ok(isPuzzleAligned(NaN, 0.5) === false, 'NaN offset never passes')
ok(isPuzzleAligned(0.5, NaN) === false, 'NaN target never passes')
ok(isPuzzleAligned(undefined, 0.5) === false, 'undefined offset never passes')

// exact boundary lock (power-of-two tolerance = exact in IEEE754): diff === 0.125
// must pass under `<=` — mutating to `<` turns this red (G2).
ok(isPuzzleAligned(0.375, 0.5, 0.125) === true, 'exact boundary passes (inclusive <=, G2 anchor)')
ok(isPuzzleAligned(0.625, 0.5, 0.125) === true, 'exact boundary above passes (inclusive <=, G2 anchor)')
ok(isPuzzleAligned(0.374, 0.5, 0.125) === false, 'boundary + 0.001 fails')
ok(isPuzzleAligned(0.626, 0.5, 0.125) === false, 'boundary + 0.001 above fails')

if (errors.length) {
  console.log('PUZZLE VERIFY TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('PUZZLE VERIFY TEST PASS')
