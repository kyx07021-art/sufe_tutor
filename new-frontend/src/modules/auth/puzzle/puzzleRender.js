/**
 * puzzleRender.js - M6-8a sliding-puzzle render layer (v2 pixel-level port)
 * -------------------------------------------------------
 * - Pure canvas functions: no Vue, no DOM, no imports. Caller owns the canvases
 *   (background 280x120 + piece 40x40) and passes their 2d contexts.
 * - Ported verbatim from v2 src/client/core/captcha.js paintCaptcha: random
 *   gradient + 420 noise dots, one real gap + 2 interference holes, white
 *   stroke that follows the silhouette (CSP-safe: canvas drawing only).
 * - Returns { target, shape, id } for the interaction layer (M6-8b) to compare
 *   drag offset against the normalized target. Alignment is judged in the browser
 *   (isPuzzleAligned); the id is echoed on the I-06 verify body (anti-abuse UX
 *   gate, NOT an auth boundary — the server no longer confirms the challenge).
 */
export const PUZZLE_W = 280
/* AK-L-F3: 120 -> 96 (compact auth modal). AK-N-A4: 96 -> 56 — the puzzle is a
   secondary graphic component, "the register page text is the master"; the canvas
   is a wide short strip (5:1), not a dominating block. The piece stays glued to
   the gap via the derived --piece-top/--piece-h CSSOM channel in CaptchaPuzzle.
   Floor: the interference-hole random slot fy = 10 + rand*(H-46) needs H >= 46
   to stay positive; 56 keeps the slots in-canvas (see paintCaptcha). */
export const PUZZLE_H = 56
export const SLIDER_W = 40
/* AK-L-F3: 40 -> 32 (squish heights). SLIDER_H must stay >= 2*SLIDER_R (16) so
   the gap shapes (radius 16, diameter 32) never clip inside the piece canvas. */
export const SLIDER_H = 32
export const PUZZLE_MAX_X = PUZZLE_W - SLIDER_W // 240
export const PUZZLE_TOLERANCE = 0.08

/**
 * Local alignment check (AK-A1a): the puzzle passes in-browser, no server
 * round-trip. Tolerance is inclusive on the boundary.
 * @param {number} offset  normalized drag offset 0..1
 * @param {number} target  normalized gap target 0..1
 * @param {number} [tolerance] override (defaults to PUZZLE_TOLERANCE)
 * @returns {boolean} aligned within tolerance
 */
export function isPuzzleAligned(offset, target, tolerance = PUZZLE_TOLERANCE) {
  const o = Number(offset)
  const t = Number(target)
  if (!Number.isFinite(o) || !Number.isFinite(t)) return false
  return Math.abs(o - t) <= tolerance
}
export const GAP_SHAPES = ['square', 'circle', 'triangle', 'diamond', 'pentagon']

const SLIDER_R = SLIDER_W / 2 - 4 // 16, shape radius

function randHex() {
  const b = new Uint8Array(3)
  crypto.getRandomValues(b)
  return '#' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

function randId() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Trace a gap shape path (v2 verbatim: circle/square/triangle/diamond/pentagon). */
export function drawGapShape(ctx, cx, cy, r, shape) {
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  } else if (shape === 'square') {
    ctx.rect(cx - r, cy - r, r * 2, r * 2)
  } else if (shape === 'triangle') {
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r, cy + r)
    ctx.lineTo(cx - r, cy + r)
    ctx.closePath()
  } else if (shape === 'diamond') {
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r, cy)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r, cy)
    ctx.closePath()
  } else {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
      const px = cx + r * Math.cos(a)
      const py = cy + r * Math.sin(a)
      if (i) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
  }
}

/**
 * Paint a fresh puzzle onto the two contexts.
 * @param {CanvasRenderingContext2D} ctx  background canvas context (PUZZLE_W x PUZZLE_H)
 * @param {CanvasRenderingContext2D} pctx piece canvas context (SLIDER_W x SLIDER_H)
 * @returns {{ target:number, shape:string, id:string }} normalized target 0..1, gap shape, captcha id
 */
export function paintCaptcha(ctx, pctx) {
  const W = ctx.canvas.width
  const H = ctx.canvas.height

  // background: random two-color linear gradient
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, randHex())
  g.addColorStop(1, randHex())
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // 420 noise dots
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${(Math.random() * 0.5 + 0.1).toFixed(2)})`
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2)
  }

  const gapMin = 16
  const gapMax = PUZZLE_MAX_X - 24
  const target = (gapMin + Math.random() * (gapMax - gapMin)) / PUZZLE_MAX_X
  const cutX = target * PUZZLE_MAX_X
  const cutY = (H - SLIDER_H) / 2
  const shape = GAP_SHAPES[Math.floor(Math.random() * GAP_SHAPES.length)]
  const id = randId()

  // piece: cut image clipped to shape + white stroke following the silhouette
  if (pctx) {
    pctx.clearRect(0, 0, SLIDER_W, SLIDER_H)
    pctx.drawImage(ctx.canvas, cutX, cutY, SLIDER_W, SLIDER_H, 0, 0, SLIDER_W, SLIDER_H)
    pctx.save()
    pctx.globalCompositeOperation = 'destination-in'
    drawGapShape(pctx, SLIDER_W / 2, SLIDER_H / 2, SLIDER_R, shape)
    pctx.fill()
    pctx.restore()
    pctx.strokeStyle = 'rgba(255,255,255,.85)'
    pctx.lineWidth = 2
    drawGapShape(pctx, SLIDER_W / 2, SLIDER_H / 2, SLIDER_R, shape)
    pctx.stroke()
  }

  // real hole punched through the background + stroke
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, SLIDER_R, shape)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,.85)'
  ctx.lineWidth = 2
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, SLIDER_R, shape)
  ctx.stroke()

  // 2 interference holes (decoys), non-overlapping with the real hole and each other
  const fakeShapes = GAP_SHAPES.filter((s) => s !== shape)
  const fakes = []
  for (let i = 0; i < 2; i++) {
    let fx = 0
    let fy = 0
    let tries = 0
    do {
      fx = 24 + Math.random() * (W - 64)
      fy = 10 + Math.random() * (H - 46)
      tries++
    } while (tries < 20 && (Math.abs(fx - cutX) < 80 || fakes.some((f) => Math.abs(f.x - fx) < 60)))
    if (tries >= 20) {
      // Random constraints exhausted: deterministic top-left / bottom-right slots.
      // The random constraints |fx-cutX|>=80 and pairwise >=60 are mathematically
      // unsatisfiable for mid-range cutX; exhaustion used to leave overlapping
      // decoys — a visible defect that also breaks the 3-hole invariant.
      // AK-N-A4: PUZZLE_H 96 -> 56 — the old y=84 fallback landed BELOW the
      // canvas (decoy silently invisible); pick a bottom slot that stays in-canvas.
      fakes.length = 0
      fakes.push({ x: 24, y: 6 }, { x: W - 64, y: Math.max(8, H - 36) })
      break
    }
    fakes.push({ x: fx, y: fy })
  }
  fakes.forEach((f, i) => {
    const fs = fakeShapes[i % fakeShapes.length]
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,1)'
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, SLIDER_R, fs)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.lineWidth = 2
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, SLIDER_R, fs)
    ctx.stroke()
  })

  return { target, shape, id }
}
