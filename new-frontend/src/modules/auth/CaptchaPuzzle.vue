<script setup>
/**
 * CaptchaPuzzle - M6-8b sliding-puzzle interaction + verification (I-07)
 * -------------------------------------------------------
 * - Ports v2 captcha.js drag/verify semantics: paint via puzzleRender (M6-8a),
 *   pointer drag with setPointerCapture, track points (<=128), release ->
 *   |offset-target| <= TOLERANCE -> POST /captcha/verify (I-07) -> verified.
 * - CSP-safe: slider position rides a CSSOM data channel (--captcha-x / --puzzle-scale
 *   setProperty on the box); zero inline style attributes.
 * - Responsive: --puzzle-scale shrinks the 280px drawing on narrow parents; the
 *   drag math divides client movement by the live scale.
 * - Fail -> shake + reset + repaint after 420ms; pass -> emit('verified', captchaId) once —
 *   the id is echoed on the I-06 verify body so the server can confirm the challenge passed.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  paintCaptcha,
  PUZZLE_W,
  PUZZLE_H,
  SLIDER_W,
  SLIDER_H,
  PUZZLE_MAX_X,
  PUZZLE_TOLERANCE,
} from './puzzle/puzzleRender.js'
import { api } from '@/core/api.js'
import { AUTH_COPY } from '@/constants/m-auth.js'

const emit = defineEmits(['verified'])

const boxRef = ref(null)
const canvasRef = ref(null)
const pieceRef = ref(null)
const trackRef = ref(null)
const knobRef = ref(null)
const tipRef = ref(null)

const st = {
  target: 0,
  id: '',
  offset: 0,
  drag: null,
  track: [],
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
  st.track = []
  st.pass = false
  boxRef.value?.style.setProperty('--captcha-x', '0px')
  tipRef.value && (tipRef.value.textContent = AUTH_COPY.CAPTCHA_TIP)
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

function updateScale() {
  boxRef.value?.style.setProperty('--puzzle-scale', liveScale().toFixed(4))
}

function onDown(e) {
  if (st.pass) return
  if (st.resetTimer) {
    clearTimeout(st.resetTimer)
    st.resetTimer = null
  }
  const scale = liveScale()
  st.drag = { startClientX: e.clientX, startX: st.offset * PUZZLE_MAX_X, scale, startT: Date.now() }
  st.track = []
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
  if (st.track.length < 128) {
    st.track.push({ t: Date.now() - st.drag.startT, x: e.clientX, y: e.clientY })
  }
  publishDebug()
}

async function onUp() {
  if (!st.drag) return
  st.drag = null
  trackRef.value.classList.remove('is-dragging')
  await verify()
}

function onCancel() {
  if (!st.drag) return
  st.drag = null
  trackRef.value.classList.remove('is-dragging')
  paint()
}

async function verify() {
  const knob = knobRef.value
  const tip = tipRef.value
  const track = trackRef.value
  if (!knob || !tip || !track) return
  const diff = Math.abs(st.offset - st.target)
  if (diff <= PUZZLE_TOLERANCE) {
    try {
      const r = await api('/captcha/verify', {
        method: 'POST',
        auth: false,
        body: {
          captchaId: st.id,
          offset: Number(st.offset.toFixed(3)),
          track: st.track,
        },
      })
      if (!r || !r.ok) {
        fail()
        return
      }
    } catch (err) {
      fail()
      return
    }
    st.pass = true
    knob.classList.add('is-pass')
    tip.textContent = AUTH_COPY.CAPTCHA_PASS
    tip.classList.add('is-pass')
    publishDebug()
    // emit the server-confirmed captchaId so the caller can echo it on the verify (I-06) body.
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
    <p ref="tipRef" class="captcha-puzzle__tip">{{ AUTH_COPY.CAPTCHA_TIP }}</p>
  </div>
</template>

<style scoped>
.captcha-puzzle {
  --puzzle-scale: 1;
  position: relative;
  width: 280px;
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
  top: calc(40px * var(--puzzle-scale));
  width: calc(40px * var(--puzzle-scale));
  height: calc(40px * var(--puzzle-scale));
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

.captcha-puzzle__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(var(--captcha-x, 0px) * var(--puzzle-scale));
  background: var(--brand-soft);
  pointer-events: none;
}

.captcha-puzzle__knob {
  position: absolute;
  top: 0;
  left: 0;
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

.captcha-puzzle__tip {
  margin-top: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--gray-60);
  line-height: var(--lh-tight);
}
.captcha-puzzle__tip.is-fail { color: var(--danger); }
.captcha-puzzle__tip.is-pass { color: var(--success); }

@keyframes puzzle-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

@media (prefers-reduced-motion: reduce) {
  .captcha-puzzle__track { transition: none; animation: none; }
}
</style>
