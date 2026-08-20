/**
 * v2 captcha core: parity migration of app-captcha.js sliding puzzle gate.
 * setPointerCapture is guarded for jsdom; browser semantics unchanged.
 */
import { CONFIG } from '../../shared/config.js';
import { TEXT } from '../constants/text.js';
import { openModal, closeModal } from './ui-modal.js';

const CAPTCHA_W = 280, CAPTCHA_H = 120, SLIDER_W = 40, SLIDER_H = 40;
const CAPTCHA_MAX_X = CAPTCHA_W - SLIDER_W;
const CAPTCHA_TOLERANCE = 0.08;
const GAP_SHAPES = ['square', 'circle', 'triangle', 'diamond', 'pentagon'];

let _captchaOnPass = null;
let _captchaTarget = 0;
let _captchaOffset = 0;
let _captchaDrag = null;
let _captchaTrack = [];
let _captchaIdStr = '';
let _captchaResetTimer = null;

function _randHex() {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return '#' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function _captchaId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export function openCaptchaModal({ title = TEXT.CAPTCHA_TITLE, onPass = null } = {}) {
  _captchaOnPass = onPass;
  openModal({
    title,
    cls: 'captcha-modal',
    body: `<div class="captcha-box" id="captcha-box">
      <canvas id="captcha-canvas" width="${CAPTCHA_W}" height="${CAPTCHA_H}"></canvas>
      <canvas id="captcha-puzzle" width="${SLIDER_W}" height="${SLIDER_H}" aria-hidden="true"></canvas>
      <div class="captcha-slider-track" id="captcha-track">
        <div class="captcha-slider-fill" id="captcha-fill"></div>
        <div class="captcha-slider-knob" id="captcha-knob" role="button" aria-label="${TEXT.CAPTCHA_ARIA}">➜</div>
      </div>
      <p class="captcha-tip" id="captcha-tip">${TEXT.CAPTCHA_TIP}</p>
    </div>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" data-action="ui.closeModal">${TEXT.BTN_CANCEL}</button>`,
  });
  const closeBtn = document.querySelector('.captcha-modal [data-action="ui.closeModal"]');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  const box = document.getElementById('captcha-box');
  if (box) box.style.setProperty('--captcha-x', '0px');
  paintCaptcha();
  bindCaptchaDrag();
}

function drawGapShape(ctx, cx, cy, r, shape) {
  ctx.beginPath();
  if (shape === 'circle') { ctx.arc(cx, cy, r, 0, Math.PI * 2); }
  else if (shape === 'square') { ctx.rect(cx - r, cy - r, r * 2, r * 2); }
  else if (shape === 'triangle') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx - r, cy + r); ctx.closePath(); }
  else if (shape === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
  else {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
}

function paintCaptcha() {
  const cv = document.getElementById('captcha-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, _randHex());
  g.addColorStop(1, _randHex());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${(Math.random() * 0.5 + 0.1).toFixed(2)})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.2, 1.2);
  }
  const gapMin = 16, gapMax = CAPTCHA_MAX_X - 24;
  _captchaTarget = (gapMin + Math.random() * (gapMax - gapMin)) / CAPTCHA_MAX_X;
  const cutX = _captchaTarget * CAPTCHA_MAX_X, cutY = (H - SLIDER_H) / 2;
  const shape = GAP_SHAPES[Math.floor(Math.random() * GAP_SHAPES.length)];
  const R = SLIDER_W / 2 - 4;
  _captchaIdStr = _captchaId();
  const pz = document.getElementById('captcha-puzzle');
  if (pz) {
    const pctx = pz.getContext('2d');
    pctx.clearRect(0, 0, SLIDER_W, SLIDER_H);
    pctx.drawImage(cv, cutX, cutY, SLIDER_W, SLIDER_H, 0, 0, SLIDER_W, SLIDER_H);
    pctx.save();
    pctx.globalCompositeOperation = 'destination-in';
    drawGapShape(pctx, SLIDER_W / 2, SLIDER_H / 2, R, shape);
    pctx.fill(); // v1.4.17 parity: fill required to clip puzzle into shape (path-only = rectangle)
    pctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, R, shape);
  ctx.fill(); // v1.4.17 parity: fill required to punch the transparent hole
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 2;
  drawGapShape(ctx, cutX + SLIDER_W / 2, cutY + SLIDER_H / 2, R, shape);
  ctx.stroke();
  const fakeShapes = GAP_SHAPES.filter(s => s !== shape);
  const fakes = [];
  for (let i = 0; i < 2; i++) {
    let fx = 0, fy = 0, tries = 0;
    do {
      fx = 24 + Math.random() * (W - 64);
      fy = 10 + Math.random() * (H - 46);
      tries++;
    } while (tries < 20 && (Math.abs(fx - cutX) < 80 || fakes.some(f => Math.abs(f.x - fx) < 60)));
    if (tries >= 20) {
      // Random constraints exhausted: deterministic top-left / bottom-right slots.
      // Geometry guarantee: vertical center distance to the real hole is 34/44 and
      // 78 between the two decoys — all > shape diameter 32, so the three holes
      // never overlap (the random constraints |fx-cutX|>=80 and pairwise >=60 are
      // mathematically unsatisfiable for mid-range cutX; exhaustion used to leave
      // overlapping decoys — a visible defect that also breaks the 3-hole invariant).
      fakes.length = 0;
      fakes.push({ x: 24, y: 6 }, { x: W - 64, y: 84 });
      break;
    }
    fakes.push({ x: fx, y: fy });
  }
  fakes.forEach((f, i) => {
    const fs = fakeShapes[i % fakeShapes.length];
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, R, fs);
    ctx.fill(); // v1.4.17 parity: decoy holes also need fill to punch through
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 2;
    drawGapShape(ctx, f.x + SLIDER_W / 2, f.y + SLIDER_H / 2, R, fs);
    ctx.stroke();
  });
  _captchaOffset = 0; _captchaTrack = [];
  const track = document.getElementById('captcha-track');
  const box = document.getElementById('captcha-box') || track;
  box.style.setProperty('--captcha-x', '0px');
}

function bindCaptchaDrag() {
  const knob = document.getElementById('captcha-knob');
  const track = document.getElementById('captcha-track');
  if (!knob || !track) return;
  const box = document.getElementById('captcha-box') || track;
  const max = CAPTCHA_MAX_X;
  const down = (e) => {
    if (knob.classList.contains('captcha--pass')) return;
    if (_captchaResetTimer) { clearTimeout(_captchaResetTimer); _captchaResetTimer = null; }
    _captchaDrag = { startClientX: e.clientX, startX: _captchaOffset * max, startT: Date.now() };
    _captchaTrack = [];
    if (typeof knob.setPointerCapture === 'function') knob.setPointerCapture(e.pointerId);
    track.classList.add('captcha--dragging');
  };
  const move = (e) => {
    if (!_captchaDrag) return;
    const next = Math.max(0, Math.min(max, _captchaDrag.startX + (e.clientX - _captchaDrag.startClientX)));
    _captchaOffset = next / max;
    box.style.setProperty('--captcha-x', `${next}px`);
    if (_captchaTrack.length < 128) _captchaTrack.push({ t: Date.now() - _captchaDrag.startT, x: e.clientX, y: e.clientY });
  };
  const up = () => {
    if (!_captchaDrag) return;
    _captchaDrag = null;
    track.classList.remove('captcha--dragging');
    verifyCaptcha();
  };
  knob.addEventListener('pointerdown', down);
  knob.addEventListener('pointermove', move);
  knob.addEventListener('pointerup', up);
  knob.addEventListener('pointercancel', up);
}

async function verifyCaptcha() {
  const track = document.getElementById('captcha-track');
  const tip = document.getElementById('captcha-tip');
  const knob = document.getElementById('captcha-knob');
  if (!track || !tip || !knob) return;
  const diff = Math.abs(_captchaOffset - _captchaTarget);
  if (diff <= CAPTCHA_TOLERANCE) {
    try {
      const { api } = await import('./api.js');
      const r = await api('/api/captcha/verify', {
        method: 'POST',
        body: { captchaId: _captchaIdStr, offset: Number(_captchaOffset.toFixed(3)), track: _captchaTrack },
      });
      if (!r || !r.ok) { failCaptcha(track, tip, knob, r && r.message); return; }
    } catch (err) { failCaptcha(track, tip, knob, err && err.message); return; }
    knob.classList.add('captcha--pass');
    tip.textContent = TEXT.CAPTCHA_PASS;
    tip.classList.remove('captcha-tip--fail');
    tip.classList.add('captcha-tip--pass');
    const cb = _captchaOnPass;
    _captchaOnPass = null;
    setTimeout(() => { closeModal(); if (cb) cb(); }, 260);
    return;
  }
  failCaptcha(track, tip, knob);
}

function failCaptcha(track, tip, knob, detail) {
  knob.classList.add('captcha--fail');
  track.classList.add('captcha--shake');
  // R-3d: show the server-side reason (trajectory score detail) when present, else the generic text.
  tip.textContent = detail || TEXT.CAPTCHA_FAIL;
  tip.classList.add('captcha-tip--fail');
  if (_captchaResetTimer) clearTimeout(_captchaResetTimer);
  _captchaResetTimer = setTimeout(() => {
    _captchaResetTimer = null;
    const box = document.getElementById('captcha-box') || track;
    box.style.setProperty('--captcha-x', '0px');
    paintCaptcha();
    tip.textContent = TEXT.CAPTCHA_TIP;
    tip.classList.remove('captcha-tip--fail');
    knob.classList.remove('captcha--fail');
    track.classList.remove('captcha--shake');
  }, 420);
}

export function withCaptcha(action) {
  if (typeof action !== 'function') return;
  openCaptchaModal({ onPass: action });
}

/** Test-only hook: expose paint state for real-browser pixel verification (pattern: _dhResetForTests). */
export function _captchaStateForTests() {
  return { target: _captchaTarget, id: _captchaIdStr };
}
