/**
 * 需求十六（R16）·前端评分显示兜底 4.0 → 4.5（与服务端 INITIAL_RATING 同源）
 *
 * 教师档案缺省（rating 空/0/未定义）时，星级与评分文本不再按旧默认 4 渲染，
 * 而按新默认 4.5；筛选阈值判断同口径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage,
    console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  });
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
  return { dom, ctx };
}

test('R16 starsHtml/ratingText 缺省显示 4.5（星级 5 星满 / 文本 4.5）', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext(`DISP.ratingText('')`, ctx), '4.5', '空值兜底 4.5');
  assert.equal(vm.runInContext(`DISP.ratingText(undefined)`, ctx), '4.5', 'undefined 兜底 4.5');
  const stars = vm.runInContext(`DISP.starsHtml(undefined)`, ctx);
  assert.equal((stars.match(/class="star filled"/g) || []).length, 5, '缺省 4.5 → 四舍五入 5 星满');
  assert.equal(vm.runInContext(`DISP.ratingText(3.6)`, ctx), '3.6', '有值照实显示');
});

test('R16 教师筛选阈值缺省按 4.5（源码断言，非 4）', () => {
  const js = readFileSync('./app-teachers.js', 'utf8');
  assert.ok(/\(t\.rating\|\|4\.5\) < minRating/.test(js), '筛选缺省按 4.5');
  assert.ok(!/\(t\.rating\|\|4\) < minRating/.test(js), '不再按 4 兜底');
});
