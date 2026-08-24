<script setup>
/**
 * CaptchaPuzzle - M6-8b sliding-puzzle interaction + local pass (AK-A1a)
 * -------------------------------------------------------
 * - Ports v2 captcha.js drag semantics: paint via puzzleRender (M6-8a),
 *   pointer drag with setPointerCapture, release -> isPuzzleAligned checks
 *   |offset-target| <= TOLERANCE locally -> immediate pass (no network wait).
 * - Anti-abuse UX gate, NOT an auth boundary: real protection is the
 *   server-verified credential + OTP/password + auth rate limits. The locally
 *   generated captchaId is echoed on the I-06 verify body as a correlation id;
 *   the server no longer confirms the challenge (server gate = AK-A1b).
 * - CSP-safe: slider position rides a CSSOM data channel (--captcha-x / --puzzle-scale
 *   setProperty on the box); zero inline style attributes.
 * - Responsive: --puzzle-scale shrinks the 280px drawing on narrow parents; the
 *   drag math divides client movement by the live scale.
 * - Fail -> shake + reset + repaint after 420ms; pass -> emit('verified', captchaId) once.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  paintCaptcha,
  isPuzzleAligned,
  PUZZLE_W,
  PUZZLE_H,
  SLIDER_W,
  SLIDER_H,
  PUZZLE_MAX_X,
  PUZZLE_TOLERANCE,
} from './puzzle/puzzleRender.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

const emit = defineEmits(['verified'])

const boxRef = ref(null)
const canvasRef = ref(null)
const pieceRef = ref(null)
const trackRef = ref(null)
const knobRef = ref(null)
const tipRef = ref(null)
const hintRef = ref(null)

const st = {
  target: 0,
  id: '',
  offset: 0,
  drag: null,
  pass: false,
  resetTimer: null,
}

function paint() {
  const cv = canvasRef.value
  const pz = pieceRef.value
  if (!cv || !pz) return
  const ctx = cv.getContext('2d')
  const pctx = pz.getContext('2d')
  const r = paintCaptcha(ctx, pctx)
  st.target = r.target
  st.id = r.id
  st.offset = 0
  st.pass = false
  boxRef.value?.style.setProperty('--captcha-x', '0px')
  // AK-A3: the persistent hint (in-track) resets to the tip text; the status
  // line below the track stays empty until pass/fail. is-pass fades the hint
  // out on success (CSS), removed here so a repaint restores it.
  hintRef.value && (hintRef.value.textContent = AUTH_COPY.CAPTCHA_TIP)
  hintRef.value?.classList.remove('is-pass')
  tipRef.value && (tipRef.value.textContent = '')
  tipRef.value?.classList.remove('is-fail', 'is-pass')
  // clear knob/track state classes on every repaint (v2 reset parity):
  // a previous fail/pass must not leave a red/green arrow or a stuck shake.
  knobRef.value?.classList.remove('is-fail', 'is-pass')
  trackRef.value?.classList.remove('is-shake', 'is-dragging')
  publishDebug()
}

/** Dev/test hook (pattern: v2 `_captchaStateForTests`): lets smoke tests drive deterministic drags. */
function publishDebug() {
  if (typeof window !== 'undefined') {
    window.__authPuzzleDebug = {
      target: st.target,
      id: st.id,
      offset: st.offset,
      pass: st.pass,
    }
  }
}

/** Exposed: re-paint a fresh puzzle (parent calls on modal open / after success close). */
function reset() {
  if (st.resetTimer) {
    clearTimeout(st.resetTimer)
    st.resetTimer = null
  }
  paint()
}
defineExpose({ reset })

/** Live render scale = displayed canvas width / intrinsic width (1 on desktop, <1 when squeezed). */
function liveScale() {
  const cv = canvasRef.value
  return cv ? cv.clientWidth / PUZZLE_W : 1
}

/** Puzzle-piece vertical origin = (canvas height - slider height) / 2. Exposed
    as CSSOM variables so the piece stays glued to the gap when PUZZLE_H /
    SLIDER_H change — the CSS must never hard-code these px (AK-L-F3 audit: a
    SLIDER_H 40->32 change left the piece CSS at 40px and desynced the piece
    from the gap by ~11px). */
const PIECE_TOP = (PUZZLE_H - SLIDER_H) / 2

function updateScale() {
  boxRef.value?.style.setProperty('--puzzle-scale', liveScale().toFixed(4))
  boxRef.value?.style.setProperty('--piece-top', PIECE_TOP + 'px')
  boxRef.value?.style.setProperty('--piece-h', SLIDER_H + 'px')
}

function onDown(e) {
  if (st.pass) return
  if (st.resetTimer) {
    clearTimeout(st.resetTimer)
    st.resetTimer = null
  }
  const scale = liveScale()
  st.drag = { startClientX: e.clientX, startX: st.offset * PUZZLE_MAX_X, scale }
  if (typeof knobRef.value.setPointerCapture === 'function') {
    knobRef.value.setPointerCapture(e.pointerId)
  }
  trackRef.value.classList.add('is-dragging')
}

function onMove(e) {
  if (!st.drag) return
  const { startClientX, startX, scale } = st.drag
  const next = Math.max(0, Math.min(PUZZLE_MAX_X, startX + (e.clientX - startClientX) / scale))
  st.offset = next / PUZZLE_MAX_X
  boxRef.value?.style.setProperty('--captcha-x', `${next}px`)
  publishDebug()
}

function onUp() {
  if (!st.drag) return
  st.drag = null
  trackRef.value.classList.remove('is-dragging')
  verify()
}

function onCancel() {
  if (!st.drag) return
  st.drag = null
  trackRef.value.classList.remove('is-dragging')
  paint()
}

function verify() {
  const knob = knobRef.value
  const tip = tipRef.value
  const track = trackRef.value
  const hint = hintRef.value
  if (!knob || !tip || !track) return
  // AK-A1a: local-only alignment check — no I-07 round-trip wait. The captcha is
  // an anti-abuse UX gate, not an auth boundary (server-verified credential +
  // OTP/password + auth rate limits are the real defense). The locally generated
  // captchaId is still echoed on the I-06 verify body as a correlation id.
  if (isPuzzleAligned(st.offset, st.target, PUZZLE_TOLERANCE)) {
    st.pass = true
    knob.classList.add('is-pass')
    tip.textContent = AUTH_COPY.CAPTCHA_PASS
    tip.classList.add('is-pass')
    // AK-A3: fade the in-track hint out on success so the green pass status is
    // the only message (the hint's left half may be covered mid-drag otherwise).
    hint?.classList.add('is-pass')
    publishDebug()
    emit('verified', st.id)
    return
  }
  fail()
}

function fail() {
  const knob = knobRef.value
  const tip = tipRef.value
  const track = trackRef.value
  if (!knob || !tip || !track) return
  knob.classList.add('is-fail')
  track.classList.add('is-shake')
  tip.textContent = AUTH_COPY.CAPTCHA_FAIL
  tip.classList.add('is-fail')
  if (st.resetTimer) clearTimeout(st.resetTimer)
  st.resetTimer = setTimeout(() => {
    st.resetTimer = null
    reset()
  }, 420)
}

function onResize() {
  updateScale()
}

onMounted(() => {
  paint()
  updateScale()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (st.resetTimer) clearTimeout(st.resetTimer)
})
</script>

<template>
  <div ref="boxRef" class="captcha-puzzle" :aria-label="AUTH_COPY.CAPTCHA_ARIA">
    <div class="captcha-puzzle__stage">
      <canvas ref="canvasRef" class="captcha-puzzle__canvas" :width="PUZZLE_W" :height="PUZZLE_H"></canvas>
      <canvas
        ref="pieceRef"
        class="captcha-puzzle__piece"
        :width="SLIDER_W"
        :height="SLIDER_H"
        aria-hidden="true"
      ></canvas>
    </div>
    <div ref="trackRef" class="captcha-puzzle__track">
      <!-- AK-A3: persistent hint lives INSIDE the track as the first child so the
           fill overlay (absolute, follows --captcha-x) covers its left side as the
           knob passes; DOM order hint < fill < knob pins the stacking. -->
      <span ref="hintRef" class="captcha-puzzle__hint" aria-hidden="true">{{ AUTH_COPY.CAPTCHA_TIP }}</span>
      <div class="captcha-puzzle__fill" aria-hidden="true"></div>
      <div
        ref="knobRef"
        class="captcha-puzzle__knob"
        role="button"
        :aria-label="AUTH_COPY.CAPTCHA_ARIA"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onCancel"
      >➜</div>
    </div>
    <!-- AK-A3: tip is now a pure pass/fail status line (idle hidden via CSS); the
         persistent hint lives inside the track. -->
    <p ref="tipRef" class="captcha-puzzle__tip"></p>
  </div>
</template>

<style scoped>
.captcha-puzzle {
  --puzzle-scale: 1;
  position: relative;
  /* AK-A2: fill the auth content column (UiInput/CaptchaPuzzle share the same
     width contract); --puzzle-scale auto-upscales the 280px drawing (liveScale). */
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.captcha-puzzle__stage {
  position: relative;
  width: 100%;
}

.captcha-puzzle__canvas {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}

.captcha-puzzle__piece {
  position: absolute;
  left: 0;
  /* AK-L-F3: top/height come from the derived --piece-top/--piece-h CSSOM
     channel (CaptchaPuzzle.updateScale), never hard-coded px — keeps the piece
     glued to the gap under any PUZZLE_H/SLIDER_H change. width = SLIDER_W (40). */
  top: calc(var(--piece-top, 40px) * var(--puzzle-scale));
  width: calc(40px * var(--puzzle-scale));
  height: calc(var(--piece-h, 40px) * var(--puzzle-scale));
  transform: translateX(calc(var(--captcha-x, 0px) * var(--puzzle-scale)));
  pointer-events: none;
}

.captcha-puzzle__track {
  position: relative;
  box-sizing: border-box;
  height: calc(40px * var(--puzzle-scale));
  margin-top: var(--space-3);
  border-radius: calc(20px * var(--puzzle-scale));
  background: var(--gray-10);
  overflow: hidden;
  touch-action: none;
  transition: transform var(--dur-sm) var(--ease-out);
}
.captcha-puzzle__track.is-shake {
  animation: puzzle-shake 420ms var(--ease-out);
}

/* AK-A3: persistent hint centered in the track grey area, slightly smaller than
   the old below-track line (--fs-sm 14px -> --fs-xs 12px). Rendered under the
   fill (z 0 < 1) so the fill covers its left side as the knob passes; fades out
   on success (is-pass). pointer-events:none so it never blocks drags. */
.captcha-puzzle__hint {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-2);
  font-size: var(--fs-xs);
  color: var(--gray-60);
  line-height: var(--lh-tight);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  transition: opacity var(--dur-sm) var(--ease-out);
}
.captcha-puzzle__hint.is-pass {
  opacity: 0;
}

.captcha-puzzle__fill {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
  width: calc(var(--captcha-x, 0px) * var(--puzzle-scale));
  background: var(--brand-soft);
  pointer-events: none;
}

.captcha-puzzle__knob {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  box-sizing: border-box;
  width: calc(40px * var(--puzzle-scale));
  height: calc(40px * var(--puzzle-scale));
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--paper-raised);
  box-shadow: var(--shadow-input);
  color: var(--ink);
  font-size: calc(18px * var(--puzzle-scale));
  cursor: grab;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transform: translateX(calc(var(--captcha-x, 0px) * var(--puzzle-scale)));
}
.captcha-puzzle__knob.is-pass {
  cursor: default;
  color: var(--success);
}
.captcha-puzzle__knob.is-fail {
  color: var(--danger);
}

/* AK-A3: tip is now a pure pass/fail status line — hidden when idle so the
   in-track hint is the only prompt. */
.captcha-puzzle__tip {
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--gray-60);
  line-height: var(--lh-tight);
}
.captcha-puzzle__tip:not(.is-pass):not(.is-fail) { display: none; }
.captcha-puzzle__tip.is-fail { color: var(--danger); }
.captcha-puzzle__tip.is-pass { color: var(--success); }

@keyframes puzzle-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .captcha-puzzle__track { transition: none; animation: none; }
  .captcha-puzzle__hint { transition: none; }
}
</style>
