import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('app boot is singleton-idempotent: duplicate boot does not double-bind', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = class { observe() {} };
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = () => {};
  let wheelBindings = 0;
  const origAdd = dom.window.EventTarget.prototype.addEventListener;
  dom.window.EventTarget.prototype.addEventListener = function (type, ...args) {
    if (type === 'wheel') wheelBindings++;
    return origAdd.call(this, type, ...args);
  };
  try {
    const app = await import('../src/client/app.js?appboot=1');
    app.boot();
    app.boot();
    assert.equal(globalThis.SUFE_BOOTED, true);
    assert.equal(wheelBindings, 1, 'wheel listener bound exactly once');
    assert.equal(typeof app.boot(), 'object');
  } finally {
    dom.window.EventTarget.prototype.addEventListener = origAdd;
  }
});
