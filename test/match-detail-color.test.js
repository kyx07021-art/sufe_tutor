/**
 * R25（v0.25.90）：匹配度明细红黄绿遮罩配色
 *
 * 需求：明细卡总百分比、比例条、比例值不要紫色——按匹配度卡片配色做红黄绿遮罩；
 * 比例条填充区标准色、未填充区淡色遮罩（0/10 也显色）；缺数据保持灰色。
 *
 * 实现收敛：
 *   - 卡级等级类 match-detail--hi/mid/lo（matchLevel 同阈值）设 --md-bar（标准色）/ --md-track（淡色遮罩）；
 *   - 总百分比/比例值/比例条填充走 --md-bar，未填充底走 --md-track；
 *   - 有效 0 分维度不再走 --zero 灰覆盖（0/10 淡色底显色）；缺数据维度 --skip 保持灰。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}
const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js'];
function loadCommon(ctx) {
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
}
function seedFixtures(ctx) {
  vm.runInContext(`
    const TEACHER = { subjects: ['math', 'english'], province: 'shanghai', price_min: 150, price_max: 180,
      personality_tags: ['patience', 'humorous'], gender: 'male', nonacademic_projects: [] };
    const DEMAND = { id: 1, target_type: 'academic', target_subjects: ['math', 'physics'], province: 'shanghai',
      budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience', 'strict'], preferred_teacher_gender: 'male' };
  `, ctx);
}

test('R25 教师端明细卡：卡级等级类随 md（hi 绿 / mid 黄 / lo 红）', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  assert.ok(vm.runInContext('matchDetailHtml(TEACHER, DEMAND, 70)', ctx).includes('match-detail--mid'), '70 → mid 黄');
  assert.ok(vm.runInContext('matchDetailHtml(TEACHER, DEMAND, 100)', ctx).includes('match-detail--hi'), '100 → hi 绿');
  assert.ok(vm.runInContext('matchDetailHtml(TEACHER, DEMAND, 30)', ctx).includes('match-detail--lo'), '30 → lo 红');
});

test('R25 比例条：0 分维度不灰化（显色）、缺数据维度 --skip 灰', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  // 有效 0 分：bar 无 --zero 也无 --skip（0/10 淡色底显色）
  const zero = vm.runInContext(`matchRowsHtml([{ label: '科目', score: 0, max: 45, hint: '' }])`, ctx);
  assert.ok(zero.includes('<div class="match-bar">'), '0 分维度比例条无特殊类（淡色底显色）');
  assert.ok(!zero.includes('match-bar--zero') && !zero.includes('match-bar--skip'), '0 分不再灰化');
  assert.ok(zero.includes('--bar-w:0%'), '0 分填充 0%');
  // 缺数据（score null）：--skip 灰底 + 值 --skip + 无行级配色类
  const skip = vm.runInContext(`matchRowsHtml([{ label: '性格', score: null, max: 15, hint: '' }])`, ctx);
  assert.ok(skip.includes('match-bar--skip'), '缺数据维度比例条 --skip 灰底');
  assert.ok(skip.includes('match-row-s--skip'), '缺数据值 --skip');
  assert.ok(skip.includes('--bar-w:0%'), '缺数据填充 0%');
  assert.ok(!skip.includes('match-row--'), '缺数据维度无行级配色类');
});

test('R25/v0.25.94 比例条逐条独立配色：每维按各自比例定级（不随卡级一股脑同色）', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const hi = vm.runInContext(`matchRowsHtml([{ label: '科目', score: 45, max: 45, hint: '' }])`, ctx);
  assert.ok(hi.includes('match-row--hi'), '100% 维度 → hi 绿');
  const mid = vm.runInContext(`matchRowsHtml([{ label: '区域', score: 14, max: 20, hint: '' }])`, ctx);
  assert.ok(mid.includes('match-row--mid'), '70% 维度 → mid 黄');
  const lo = vm.runInContext(`matchRowsHtml([{ label: '预算', score: 5, max: 20, hint: '' }])`, ctx);
  assert.ok(lo.includes('match-row--lo'), '25% 维度 → lo 红');
  // 同卡不同维度各带各的级（混排用例：一支 hi 一支 lo，卡级只决定总百分比）
  const mixed = vm.runInContext(`matchRowsHtml([
    { label: '科目', score: 45, max: 45, hint: '' },
    { label: '预算', score: 5, max: 20, hint: '' },
    { label: '性格', score: null, max: 15, hint: '' },
  ])`, ctx);
  assert.ok(mixed.includes('match-row--hi') && mixed.includes('match-row--lo'), 'hi/lo 维同卡并存');
  assert.ok(!mixed.includes('match-row--mid'), '无 mid 维不出现');
});

test('R25 学生端明细卡：同时带 --teacher 结构变体与等级类', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  const html = vm.runInContext(`
    studentMatchDetailHtml({ subjects: ['math'], province: 'shanghai', price_min: 150, personality_tags: ['patience'], gender: 'male',
      _matchForStudent: { md: 85, items: [{ d: DEMAND, md: 85 }] } })`, ctx);
  assert.ok(html.includes('match-detail--teacher'), '学生端结构变体保留');
  assert.ok(html.includes('match-detail--hi'), '85 → hi 绿（最高匹配度定卡级）');
  assert.ok(html.includes('<div class="match-bar">'), '明细行比例条无 --zero');
});

test('R25 CSS 单源：pct/row-s/bar 全走等级变量，无紫残留；skip 灰底；零 --zero', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('.match-detail--hi  { --md-bar: var(--ok-deep);   --md-track: var(--ok-tint); }'), 'hi 等级变量（绿）');
  assert.ok(css.includes('.match-detail--mid { --md-bar: var(--warn-deep); --md-track: var(--warn-tint); }'), 'mid 等级变量（黄）');
  assert.ok(css.includes('.match-detail--lo  { --md-bar: var(--danger);    --md-track: var(--danger-tint); }'), 'lo 等级变量（红）');
  // v0.25.94：明细行逐条配色类（每维独立定级）
  assert.ok(css.includes('.match-row--hi  { --md-bar: var(--ok-deep);   --md-track: var(--ok-tint); }'), '行级 hi 变量（绿）');
  assert.ok(css.includes('.match-row--mid { --md-bar: var(--warn-deep); --md-track: var(--warn-tint); }'), '行级 mid 变量（黄）');
  assert.ok(css.includes('.match-row--lo  { --md-bar: var(--danger);    --md-track: var(--danger-tint); }'), '行级 lo 变量（红）');
  assert.ok(/\.match-detail-pct \{[\s\S]*color: var\(--md-bar\)/.test(css), '总百分比走等级色');
  assert.ok(/\.match-row-s \{[\s\S]*color: var\(--md-bar\)/.test(css), '比例值走等级色');
  assert.ok(/\.match-bar \{[\s\S]*background: var\(--md-track\)/.test(css), '未填充区淡色遮罩');
  assert.ok(/\.match-bar i \{[\s\S]*background: var\(--md-bar\)/.test(css), '填充区标准色实色');
  assert.ok(css.includes('.match-bar--skip { background: var(--g-bar-soft); }'), '缺数据灰底');
  assert.ok(!css.includes('match-bar--zero'), '旧 .match-bar--zero 连根删（0/10 显色）');
  assert.ok(!css.includes('linear-gradient(90deg, var(--accent), var(--accent-bright))'), '紫渐变填充已删');
  // 学生端卡级类由 app-teachers 输出（等级随最高匹配度）
  const t = readFileSync('./app-teachers.js', 'utf8');
  assert.ok(t.includes('match-detail--${matchLevel(m.md)}'), '学生端明细卡带等级类');
});
