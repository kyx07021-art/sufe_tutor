/**
 * B1 captcha core tests（旧 app-captcha 行为）.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCaptchaModal, withCaptcha } from '../src/client/core/captcha.js';
import { closeModal } from '../src/client/core/ui-modal.js';
import { TEXT } from '../src/client/constants/text.js';

const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.MutationObserver = class { observe() {} };

function canvasStub() {
  const o = {};
  const mk = () => new Proxy(function () {}, {
    get: (t, k) => (k in o ? o[k] : mk()),
    set: (t, k, v) => { o[k] = v; return true; },
    apply: () => mk(),
  });
  return mk();
}
dom.window.HTMLCanvasElement.prototype.getContext = canvasStub;

const pointer = (knob, type, x = 0) => knob.dispatchEvent(new dom.window.PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));

test('openCaptchaModal renders and failed drag shakes + resets after 420ms', async () => {
  const realRandom = Math.random;
  Math.random = () => 0.5;
  openCaptchaModal({ title: '验证' });
  const canvas = document.getElementById('captcha-canvas');
  const knob = document.getElementById('captcha-knob');
  const tip = document.getElementById('captcha-tip');
  const track = document.getElementById('captcha-track');
  assert.ok(canvas && knob && tip && track);
  assert.equal(canvas.getAttribute('width'), '280');
  assert.equal(tip.textContent, TEXT.CAPTCHA_TIP);
  knob.setPointerCapture = () => {};
  pointer(knob, 'pointerdown', 0);
  pointer(knob, 'pointerup', 0);
  assert.equal(tip.textContent, TEXT.CAPTCHA_FAIL);
  assert.equal(knob.classList.contains('captcha--fail'), true);
  assert.equal(track.classList.contains('captcha--shake'), true);
  await new Promise(r => setTimeout(r, 450));
  assert.equal(tip.textContent, TEXT.CAPTCHA_TIP);
  assert.equal(knob.classList.contains('captcha--fail'), false);
  assert.equal(track.classList.contains('captcha--shake'), false);
  closeModal();
  Math.random = realRandom;
});

test('success path: aligned gap calls onPass after verify', async () => {
  closeModal();
  const realRandom = Math.random;
  const realFetch = globalThis.fetch;
  Math.random = () => 0; // target = 16/240
  globalThis.fetch = async (url, opts = {}) => {
    assert.equal(url, '/api/captcha/verify');
    assert.equal(opts.method, 'POST');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  let passed = 0;
  try {
    const cap = await import('../src/client/core/captcha.js?pass=1');
    cap.openCaptchaModal({ onPass: () => { passed++; } });
    const knob = document.getElementById('captcha-knob');
    knob.setPointerCapture = () => {};
    pointer(knob, 'pointerdown', 0);
    pointer(knob, 'pointermove', 17);
    pointer(knob, 'pointerup', 17);
    await new Promise(r => setTimeout(r, 340));
    assert.equal(passed, 1);
    assert.equal(document.getElementById('modal-container').innerHTML, '');
  } finally {
    Math.random = realRandom;
    globalThis.fetch = realFetch;
    closeModal();
  }
});

test('withCaptcha non-function returns undefined', () => {
  assert.equal(withCaptcha(5), undefined);
  assert.equal(withCaptcha(null), undefined);
});
