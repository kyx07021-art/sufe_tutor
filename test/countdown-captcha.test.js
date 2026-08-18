/**
 * v0.26.0 前端组件测试（B4：直接 import core/captcha + core/ui）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openCaptchaModal, withCaptcha } from '../src/client/core/captcha.js';
import { formatCountdown, bindCountdown } from '../src/client/core/ui.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    createLinearGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: '', save: () => {}, restore: () => {},
    globalCompositeOperation: '', strokeRect: () => {}, lineWidth: 0, strokeStyle: '', beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    arc: () => {}, rect: () => {}, stroke: () => {}, fill: () => {}, clearRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(6400) }),
  });
  return dom;
}

test('formatCountdown：智能单位', () => {
  assert.equal(formatCountdown(7 * 24 * 3600 * 1000 + 5000), '7天');
  assert.equal(formatCountdown(3 * 3600 * 1000 + 25 * 60 * 1000 + 9000), '3时25分');
  assert.equal(formatCountdown(25 * 60 * 1000 + 9000), '25分');
  assert.equal(formatCountdown(45 * 1000 + 500), '45秒');
  assert.equal(formatCountdown(0), '');
  assert.equal(formatCountdown(-100), '');
});

test('bindCountdown：按钮灰化 + 文案更新 + 到期复原', async () => {
  const dom = setup();
  const btn = dom.window.document.createElement('button');
  btn.textContent = '发送验证码';
  dom.window.document.body.appendChild(btn);
  const stop = bindCountdown(btn, { endAt: Date.now() + 400, runningText: '{time}后可再次发送验证码' });
  assert.equal(btn.disabled, true);
  assert.ok(btn.textContent.includes('可再次发送验证码'));
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(btn.disabled, false);
  stop();
  delete globalThis.document;
});

test('openCaptchaModal：渲染验证浮窗', () => {
  const dom = setup();
  openCaptchaModal({ title: '验证', onPass: () => {} });
  const container = dom.window.document.getElementById('modal-container');
  assert.ok(container.querySelector('#captcha-canvas'));
  assert.ok(container.querySelector('#captcha-track'));
  assert.ok(container.querySelector('#captcha-knob'));
  delete globalThis.document;
});

test('withCaptcha：非函数直接返回', () => {
  const dom = setup();
  assert.equal(withCaptcha(5), undefined);
  delete globalThis.document;

});
