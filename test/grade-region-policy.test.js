/**
 * M3（v0.25.103）：需求发布年级-地区政策适配
 *  - 调研结论：主流六三学制（小学六年）；上海五四学制（小学五年+初中四年，六年级=初中预备班）。
 *  - 改动：STUDENT_GRADES 补 p6（小学六年级）+ prep（预备班）；FIVE_FOUR_PROVINCES 学制单源；
 *    gradeOptionsForProvince 按地区渲染年级（上海无 p6 有 prep，其他省有 p6 无 prep）；
 *    stageOfGrade('prep') → middle（预备班=初中阶段，科目池/等第同初中）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js'])
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('M3 年级常量：STUDENT_GRADES 含 p6 与 prep', () => {
  const { ctx } = makeCtx();
  const ids = vm.runInContext('STUDENT_GRADES.map(g => g.id)', ctx);
  assert.ok(ids.includes('p6') && ids.includes('prep'), '含小学六年级与预备班');
  assert.ok(ids.includes('p5') && ids.includes('junior1'), '上下文顺序完整');
});

test('M3 学制单源：上海为五四学制（FIVE_FOUR_PROVINCES），其余默认六三', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext('globalThis.SUFE_REGIONS.isFiveFour("shanghai")', ctx), true, '上海五四学制');
  assert.equal(vm.runInContext('globalThis.SUFE_REGIONS.isFiveFour("beijing")', ctx), false, '北京六三学制');
  assert.equal(vm.runInContext('globalThis.SUFE_REGIONS.isFiveFour("zhejiang")', ctx), false, '浙江六三学制');
});

test('M3 年级选项按地区：上海无 p6 有 prep；其他省有 p6 无 prep；未选地区返回占位逻辑', () => {
  const { ctx } = makeCtx();
  const shIds = vm.runInContext('gradeOptionsForProvince("shanghai").map(g => g.id)', ctx);
  assert.ok(!shIds.includes('p6'), '上海无小学六年级（五四学制）');
  assert.ok(shIds.includes('prep'), '上海六年级=预备班');
  assert.ok(shIds.includes('p5') && shIds.includes('junior1'), '上海小学到初一衔接完整');
  const bjIds = vm.runInContext('gradeOptionsForProvince("beijing").map(g => g.id)', ctx);
  assert.ok(bjIds.includes('p6'), '北京有小学六年级（六三学制）');
  assert.ok(!bjIds.includes('prep'), '北京无预备班');
  assert.ok(vm.runInContext('gradeOptionsForProvince("").length', ctx) > 0, '空地区兜底（防崩）');
});

test('M3 预备班=初中阶段：科目池/等第与初中一致', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext('globalThis.SUFE_REGIONS.stageOfGrade("prep")', ctx), 'middle', '预备班归初中阶段');
  const prepSubj = vm.runInContext('globalThis.SUFE_REGIONS.subjectsFor("shanghai", "prep")', ctx);
  const juniorSubj = vm.runInContext('globalThis.SUFE_REGIONS.subjectsFor("shanghai", "junior1")', ctx);
  assert.deepEqual(prepSubj, juniorSubj, '预备班与初一科目池一致');
  const p6Subj = vm.runInContext('globalThis.SUFE_REGIONS.subjectsFor("beijing", "p6")', ctx);
  const p5Subj = vm.runInContext('globalThis.SUFE_REGIONS.subjectsFor("beijing", "p5")', ctx);
  assert.deepEqual(p6Subj, p5Subj, '小学六年级科目池同小学阶段');
});

test('M3 年级显示映射：DISP.studentGradeName 显示预备班/小学六年级（需求列表与筛选同步）', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext('DISP.studentGradeName("prep")', ctx), '预备班', '预备班显示名');
  assert.equal(vm.runInContext('DISP.studentGradeName("p6")', ctx), '小学六年级', '小学六年级显示名');
});
