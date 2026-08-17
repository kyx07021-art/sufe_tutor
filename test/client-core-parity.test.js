/**
 * Parity gate: old classic scripts (vm) vs new ESM core must be behavior-equal.
 * Cases: text/region data, matchDims, diffLines, formatCountdown, btnLoading/btnDone,
 * escHtml, mdRender, datahub batch/single-flight, captcha withCaptcha + drag reset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { SUFE_REGIONS as NEW_REGIONS } from '../src/client/constants/region-data.js';
import { TEXT } from '../src/client/constants/text.js';
import { matchDims as newMatchDims } from '../src/client/core/match.js';
import { diffLines as newDiffLines } from '../src/client/core/display.js';
import { escHtml as newEscHtml, mdRender as newMdRender } from '../src/client/core/dom.js';
import { formatCountdown as newFormatCountdown, btnLoading as newBtnLoading, btnDone as newBtnDone, withCaptcha as newWithCaptcha } from '../src/client/core/ui.js';
import { openCaptchaModal as newOpenCaptcha } from '../src/client/core/captcha.js';
import {
  dhBatchGet as newDhBatchGet, dhGet as newDhGet, dhInvalidateAll as newDhInvalidateAll,
} from '../src/client/core/datahub.js';

const file = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function makeOld(files, { fetchImpl } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document, localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController, performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: cb => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    crypto: w.crypto,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
  });
  for (const f of files) vm.runInContext(file(f), ctx, { filename: f });
  return { dom, ctx, w };
}

test('region-data parity: JSON 深度相等 + 查询函数同口径', () => {
  const { ctx } = makeOld(['constants.js', 'region-data.js']);
  const oldRegions = vm.runInContext('globalThis.SUFE_REGIONS', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(oldRegions)), JSON.parse(JSON.stringify(NEW_REGIONS)));
  assert.deepEqual(JSON.parse(JSON.stringify(NEW_REGIONS.townCoordByAddr('黄浦区·南京东路街道'))), JSON.parse(JSON.stringify(oldRegions.townCoordByAddr('黄浦区·南京东路街道'))));
  assert.deepEqual(JSON.parse(JSON.stringify(NEW_REGIONS.policyOf('zhejiang', 2020))), JSON.parse(JSON.stringify(oldRegions.policyOf('zhejiang', 2020))));
  assert.equal(NEW_REGIONS.subjectMaxFor('shanghai', 'math', 'senior1'), oldRegions.subjectMaxFor('shanghai', 'math', 'senior1'));
});

test('text parity: sampled UI keys 逐字一致', () => {
  const { ctx } = makeOld(['constants.js']);
  const oldUI = vm.runInContext('APP_CONSTANTS.UI', ctx);
  const keys = ['NETWORK_ERROR', 'ERROR_REQUEST_FAILED', 'LOADING', 'BTN_CONFIRM', 'BTN_CANCEL', 'POST_IMG_BLOCKED',
    'MATCH_DIM_SKIP', 'MATCH_DISTANCE_SAME', 'MATCH_DISTANCE_HIT', 'MATCH_REGION_HIT', 'MATCH_REGION_MISS',
    'TAG_PICK_LIMIT', 'CAPTCHA_TIP', 'CAPTCHA_FAIL', 'CAPTCHA_PASS', 'CHART_EMPTY', 'PAGE_ABOUT'];
  for (const k of keys) assert.equal(TEXT[k], oldUI[k], k);
  assert.equal(TEXT.ERROR_REQUEST_FAILED, '请求失败');
});

test('matchDims parity: 同镇与跨镇两例的 score/label/hint 全等', () => {
  const src = file('app-demands.js');
  const start = src.indexOf('function genderMatchScore');
  const end = src.indexOf('// 教师需求匹配度');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  const { ctx } = makeOld(['constants.js', 'region-data.js', 'app-display.js', 'app-state.js']);
  vm.runInContext(`
    function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    ${slice}
  `, ctx);
  const oldMatchDims = vm.runInContext('matchDims', ctx);
  const t = { subjects: ['math'], personality_tags: ['patient'], gender: 'male', province: 'shanghai', address: '黄浦区·南京东路街道', price_min: 100 };
  const d = { target_type: 'academic', target_subjects: ['math'], preferred_personality_tags: ['patient'], teaching_method: 'offline', province: 'shanghai', address: '黄浦区·南京东路街道', budget_min: 80, budget_max: 200, preferred_teacher_gender: 'male' };
  assert.deepEqual(JSON.parse(JSON.stringify(newMatchDims(t, d))), JSON.parse(JSON.stringify(oldMatchDims(t, d))));
  const t2 = { ...t, address: '崇明区·陈家镇' };
  assert.deepEqual(JSON.parse(JSON.stringify(newMatchDims(t2, d))), JSON.parse(JSON.stringify(oldMatchDims(t2, d))));
});

test('diffLines parity: 旧 LCS 返回 {t,text}', () => {
  const { ctx } = makeOld(['constants.js', 'app-display.js']);
  const oldDiff = vm.runInContext('SUFE_DISPLAY.diffLines', ctx);
  const a = 'a\nb\nc', b = 'a\nB\nc\nd';
  assert.deepEqual(JSON.parse(JSON.stringify(newDiffLines(a, b))), JSON.parse(JSON.stringify(oldDiff(a, b))));
});

test('formatCountdown parity: 正常与 NaN/Infinity', () => {
  const { ctx } = makeOld(['constants.js', 'app-state.js', 'app-ui.js']);
  const oldFmt = vm.runInContext('formatCountdown', ctx);
  for (const v of [7 * 24 * 3600 * 1000 + 5, 3 * 3600 * 1000 + 25 * 60 * 1000, 45 * 1000, 0, -1, NaN, Infinity]) {
    assert.equal(newFormatCountdown(v), oldFmt(v), String(v));
  }
});

test('btnLoading/btnDone parity: spinner innerHTML + 仅传 label 才改文案', () => {
  const { ctx, dom } = makeOld(['constants.js', 'app-state.js', 'app-ui.js']);
  const oldLoad = vm.runInContext('btnLoading', ctx);
  const oldDone = vm.runInContext('btnDone', ctx);
  const a = dom.window.document.createElement('button'); a.textContent = '发送';
  const b = dom.window.document.createElement('button'); b.textContent = '发送';
  oldLoad(a, '发送中');
  newBtnLoading(b, '发送中');
  assert.equal(a.disabled, b.disabled);
  assert.equal(a.innerHTML, b.innerHTML);
  oldDone(a);
  newBtnDone(b);
  assert.equal(a.disabled, b.disabled);
  assert.equal(a.innerHTML, b.innerHTML);
  oldDone(a, '恢复');
  newBtnDone(b, '恢复');
  assert.equal(a.textContent, b.textContent);
  assert.equal(a.disabled, b.disabled);
});

test('escHtml/mdRender parity: 段落级 markdown 输出逐字节一致', () => {
  const { ctx } = makeOld(['constants.js', 'app-state.js', 'app-ui.js']);
  const oldEsc = vm.runInContext('escHtml', ctx);
  const oldMd = vm.runInContext('mdRender', ctx);
  const input = `<a b="c">'&`;
  assert.equal(newEscHtml(input), oldEsc(input));
  const md = '# Hi\n\n- a **b**\n- c\n\n> q\n\n![bad](javascript:y)';
  assert.equal(newMdRender(md), oldMd(md));
});

test('dhBatchGet parity: 返回 Map<path,data>，16+4 分块', async () => {
  const paths = Array.from({ length: 20 }, (_, i) => `/api/p/${i}`);
  const oldCalls = [];
  const { ctx } = makeOld(['constants.js', 'app-state.js', 'app-api.js', 'app-datahub.js'], {
    fetchImpl: async (url, opts = {}) => {
      oldCalls.push(JSON.parse(opts.body).gets.length);
      const gets = JSON.parse(opts.body).gets;
      return { ok: true, status: 200, json: async () => ({ results: gets.map(p => ({ path: p, status: 200, data: { path: p } })) }) };
    },
  });
  vm.runInContext('dhInvalidateAll()', ctx);
  const oldMap = await vm.runInContext(`dhBatchGet(${JSON.stringify(paths)})`, ctx);
  assert.deepEqual(oldCalls, [16, 4]);
  assert.equal(oldMap.size, 20);
  assert.deepEqual(oldMap.get('/api/p/0'), { path: '/api/p/0' });

  const newCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    newCalls.push(JSON.parse(opts.body).gets.length);
    const gets = JSON.parse(opts.body).gets;
    return { ok: true, status: 200, json: async () => ({ results: gets.map(p => ({ path: p, status: 200, data: { path: p } })) }) };
  };
  newDhInvalidateAll();
  const newMap = await newDhBatchGet(paths);
  assert.deepEqual(newCalls, [16, 4]);
  assert.equal(newMap.size, 20);
  assert.deepEqual(JSON.parse(JSON.stringify([...newMap.entries()])), JSON.parse(JSON.stringify([...oldMap.entries()])));
});

test('dhGet parity: 并发同路径 single-flight', async () => {
  let release; const gate = new Promise(r => { release = r; });
  let oldN = 0;
  const { ctx } = makeOld(['constants.js', 'app-state.js', 'app-api.js', 'app-datahub.js'], {
    fetchImpl: async () => { oldN++; await gate; return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  });
  vm.runInContext('dhInvalidateAll()', ctx);
  const oldA = vm.runInContext(`dhGet('/api/x')`, ctx);
  const oldB = vm.runInContext(`dhGet('/api/x')`, ctx);
  release();
  await Promise.all([oldA, oldB]);
  assert.equal(oldN, 1);

  let release2; const gate2 = new Promise(r => { release2 = r; });
  let newN = 0;
  globalThis.fetch = async () => { newN++; await gate2; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  newDhInvalidateAll();
  const a = newDhGet('/api/x');
  const b = newDhGet('/api/x');
  release2();
  await Promise.all([a, b]);
  assert.equal(newN, 1);
});

function installCanvasStub(w) {
  w.HTMLCanvasElement.prototype.getContext = function () {
    const ctxObj = {};
    const mk = () => new Proxy(function () {}, {
      get: (t, k) => (k in ctxObj ? ctxObj[k] : mk()),
      set: (t, k, v) => { ctxObj[k] = v; return true; },
      apply: () => mk(),
    });
    return mk();
  };
}

test('captcha parity: withCaptcha 非函数直接 return；拖拽失败 shake/420ms 复位', async () => {
  const realRandom = Math.random;
  const old = makeOld(['constants.js', 'app-state.js', 'app-anim.js', 'app-ui.js', 'app-captcha.js']);
  const { ctx, w } = old;
  installCanvasStub(w);
  vm.runInContext("Object.defineProperty(Math, 'random', { value: () => 0.5 })", ctx);

  assert.equal(vm.runInContext('withCaptcha(5)', ctx), undefined);
  assert.equal(newWithCaptcha(5), undefined);

  const pointer = (knob, type, x = 0) => knob.dispatchEvent(new w.PointerEvent(type, { bubbles: true, clientX: x, pointerId: 1 }));
  const failState = () => {
    const track = w.document.getElementById('captcha-track');
    const tip = w.document.getElementById('captcha-tip');
    const knob = w.document.getElementById('captcha-knob');
    return {
      tip: tip.textContent,
      fail: knob.classList.contains('captcha--fail'),
      shake: track.classList.contains('captcha--shake'),
      tipFail: tip.classList.contains('captcha-tip--fail'),
    };
  };
  const resetState = () => {
    const track = w.document.getElementById('captcha-track');
    const tip = w.document.getElementById('captcha-tip');
    const knob = w.document.getElementById('captcha-knob');
    return {
      tip: tip.textContent,
      fail: knob.classList.contains('captcha--fail'),
      shake: track.classList.contains('captcha--shake'),
    };
  };

  vm.runInContext('openCaptchaModal({})', ctx);
  let knob = w.document.getElementById('captcha-knob');
  knob.setPointerCapture = () => {};
  pointer(knob, 'pointerdown', 0);
  pointer(knob, 'pointerup', 0);
  assert.deepEqual(failState(), { tip: TEXT.CAPTCHA_FAIL, fail: true, shake: true, tipFail: true });
  await new Promise(r => setTimeout(r, 450));
  assert.deepEqual(resetState(), { tip: TEXT.CAPTCHA_TIP, fail: false, shake: false });
  vm.runInContext('closeModal()', ctx);

  globalThis.Math.random = () => 0.5;
  globalThis.document = w.document;
  globalThis.window = w;
  newOpenCaptcha({});
  knob = w.document.getElementById('captcha-knob');
  knob.setPointerCapture = () => {};
  pointer(knob, 'pointerdown', 0);
  pointer(knob, 'pointerup', 0);
  assert.deepEqual(failState(), { tip: TEXT.CAPTCHA_FAIL, fail: true, shake: true, tipFail: true });
  await new Promise(r => setTimeout(r, 450));
  assert.deepEqual(resetState(), { tip: TEXT.CAPTCHA_TIP, fail: false, shake: false });
  const { closeModal } = await import('../src/client/core/ui-modal.js');
  closeModal();
  globalThis.Math.random = realRandom;
});
