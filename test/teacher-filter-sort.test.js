/**
 * 需求一（2026-08-08）·教师列表筛选功能恢复 + 新资料项完善（v0.25.29）
 *
 * 实证结论（线上 qa_student 实测）：筛选面板本就存在且生效（性别筛选 15→4），
 * 缺失的是：① 排序控件（匹配度排序被 v0.25.8 强制、无「默认排序」可选——用户反馈
 *   「默认排序不是强制展示」）；② 新资料项筛选（仅性别/科目/报价/评分，缺授课方式/
 *   可授课时间/认证等新资料项）。
 *
 * 本测试覆盖：
 *   - sortTeachers 各模式：default=服务器原序 / match=匹配度降序（无数据回落原序）/
 *     rating=评分降序 / price=报价升序（未填报价沉底）；
 *   - applyFilters 新字段：授课方式 / 可授课星期（结构化时间段 JSON 解析）/ 认证状态；
 *   - hasDaySlot：JSON 时间段星期命中、历史纯文本不参与、非数组兜底。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js'];
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

function seed(ctx, teachers) {
  // 模拟 loadTeachers 的选项填充：index.html 的 filter-method/filter-day 只留「不限」占位，
  // 选项由 loadTeachers 从单源（TEACHING_METHODS / WEEKDAYS）填充——测试需同款填充才能设值
  vm.runInContext(`
    state.allTeachers = ${JSON.stringify(teachers)};
    state.user = { role: 'teacher', id: 1, username: 't' };
    const mf = document.getElementById('filter-method');
    TEACHING_METHODS.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; mf.appendChild(o); });
    const df = document.getElementById('filter-day');
    WEEKDAYS.forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; df.appendChild(o); });
  `, ctx);
}

// 教师夹具：id/评分/报价/方式/时间段/认证 各不相同
const TEACHERS = [
  { user_id: 1, username: '甲', avatar: '', rating: 5, grade: 'senior', province: 'shanghai', gender: 'male',
    price_min: 200, price_max: 260, subjects: ['math'], teaching_method: 'online',
    time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]), verified: 1 },
  { user_id: 2, username: '乙', avatar: '', rating: 3, grade: 'junior', province: 'beijing', gender: 'female',
    price_min: 100, price_max: 150, subjects: ['english'], teaching_method: 'offline',
    time_slots: JSON.stringify([{ type: 'week', dow: 3, start: '16:00', end: '18:00' }]), verified: 0 },
  { user_id: 3, username: '丙', avatar: '', rating: 4, grade: 'senior', province: 'guangzhou', gender: 'male',
    price_min: 150, price_max: 200, subjects: ['math', 'physics'], teaching_method: 'both',
    time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '09:00', end: '12:00' }, { type: 'week', dow: 5, start: '19:00', end: '21:00' }]), verified: 1 },
  { user_id: 4, username: '丁', avatar: '', rating: 4.5, grade: 'senior', province: 'shenzhen', gender: 'female',
    price_min: null, price_max: null, subjects: ['english'], teaching_method: '',
    time_slots: '历史纯文本', verified: 0 },
];

test('sortTeachers：无 default 模式（Q6 删除）/ rating 降序 / price 升序未填沉底', () => {
  const { ctx } = makeCtx(); seed(ctx, TEACHERS);
  const ids = () => Array.from(vm.runInContext('state.allTeachers.map(t => t.user_id)', ctx));

  // v0.25.112（用户纠正）：teacherSortMode 无控件兜底按角色——seed 为教师语境 → 默认评分最高
  // （匹配度是学生↔需求概念，教师看教师不适用；学生语境兜底 match，见下方 Q6 测试）
  assert.equal(vm.runInContext('teacherSortMode()', ctx), 'rating', 'v0.25.112：教师语境 teacherSortMode 默认返回 rating（非匹配度）');

  vm.runInContext(`state.allTeachers = ${JSON.stringify(TEACHERS)}; sortTeachers(state.allTeachers, 'rating')`, ctx);
  assert.deepEqual(ids(), [1, 4, 3, 2], '评分降序 5→4.5→4→3');

  vm.runInContext(`state.allTeachers = ${JSON.stringify(TEACHERS)}; sortTeachers(state.allTeachers, 'price')`, ctx);
  assert.deepEqual(ids(), [2, 3, 1, 4], '报价升序 100→150→200，未填报价(丁)沉底');
});

test('sortTeachers：match 模式按最高匹配度降序；无匹配数据回落原序', () => {
  const { ctx } = makeCtx();
  const withMatch = TEACHERS.map(t => ({ ...t }));
  withMatch[0]._matchForStudent = { md: 88 }; // 甲 88
  withMatch[2]._matchForStudent = { md: 99 }; // 丙 99
  vm.runInContext(`state.allTeachers = ${JSON.stringify(withMatch)}; sortTeachers(state.allTeachers, 'match')`, ctx);
  assert.deepEqual(Array.from(vm.runInContext('state.allTeachers.map(t => t.user_id)', ctx)), [3, 1, 2, 4], '匹配度 99→88，无匹配沉底');

  vm.runInContext(`state.allTeachers = ${JSON.stringify(TEACHERS)}; sortTeachers(state.allTeachers, 'match')`, ctx);
  assert.deepEqual(Array.from(vm.runInContext('state.allTeachers.map(t => t.user_id)', ctx)), [1, 2, 3, 4], '无匹配数据回落原序');
});

test('hasDaySlot：JSON 时间段星期命中 / 历史纯文本不参与 / 非数组兜底', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext(`hasDaySlot(${JSON.stringify(TEACHERS[0].time_slots)}, 1)`, ctx), true, '甲周一命中');
  assert.equal(vm.runInContext(`hasDaySlot(${JSON.stringify(TEACHERS[0].time_slots)}, 3)`, ctx), false, '甲周三未命中');
  assert.equal(vm.runInContext(`hasDaySlot('历史纯文本', 1)`, ctx), false, '历史纯文本不参与星期筛选');
  assert.equal(vm.runInContext(`hasDaySlot('', 1)`, ctx), false, '空值兜底 false');
  assert.equal(vm.runInContext(`hasDaySlot('{}', 1)`, ctx), false, '非数组兜底 false');
});

test('applyFilters 新资料项：授课方式 / 可授课星期 / 认证状态叠加过滤', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx, TEACHERS);
  const count = () => doc.querySelectorAll('#teachers-list .list-card--teacher').length;

  // 授课方式 = 线上 → 仅甲
  vm.runInContext(`document.getElementById('filter-method').value = 'online'; applyFilters()`, ctx);
  assert.equal(count(), 1, '线上仅甲');
  // 复位 + 可授课星期 = 周一 → 甲、丙
  vm.runInContext(`document.getElementById('filter-method').value = ''; document.getElementById('filter-day').value = '1'; applyFilters()`, ctx);
  assert.equal(count(), 2, '周一可授课 = 甲(1) + 丙(3)');
  // 复位 + 认证 = 已认证 → 甲、丙
  vm.runInContext(`document.getElementById('filter-day').value = ''; document.getElementById('filter-verified').value = '1'; applyFilters()`, ctx);
  assert.equal(count(), 2, '已认证 = 甲、丙');
  // 全部复位 → 4 人
  vm.runInContext(`document.getElementById('filter-verified').value = ''; applyFilters()`, ctx);
  assert.equal(count(), 4, '全部复位恢复 4 人');
});

test('Q6：学生端默认排序=匹配度降序（有匹配数据时）；无匹配回落原序', () => {
  const { ctx } = makeCtx();
  // 学生 + 有匹配数据：select 默认选中 match，渲染走匹配度降序
  const withMatch = TEACHERS.map(t => ({ ...t }));
  withMatch[0]._matchForStudent = { md: 88 }; // 甲 88
  withMatch[2]._matchForStudent = { md: 99 }; // 丙 99
  vm.runInContext(`
    state.user = { role: 'student', id: 1, username: 's' };
    state.allTeachers = ${JSON.stringify(withMatch)};
    syncMatchSortOpt(); // 学生有匹配数据 → 匹配度选项可见
  `, ctx);
  assert.equal(vm.runInContext(`document.getElementById('opt-sort-match').classList.contains('hidden')`, ctx), false,
    '学生有匹配数据时「匹配度最高」选项可见');
  assert.equal(vm.runInContext(`document.getElementById('teacher-sort').value`, ctx), 'match',
    'Q6：默认选中匹配度最高（替代被删的「默认排序」）');
  vm.runInContext(`applyFilters()`, ctx);
  const renderedOrder = Array.from(vm.runInContext(
    `[...document.querySelectorAll('#teachers-list .list-card--teacher')].map(c => c.textContent.includes('丙') ? 3 : c.textContent.includes('甲') ? 1 : c.textContent.includes('乙') ? 2 : 4)`,
    ctx));
  assert.deepEqual(renderedOrder, [3, 1, 2, 4],
    'Q6：默认排序=匹配度降序（99→88，无匹配沉底）——渲染卡顺序');
  assert.deepEqual(Array.from(vm.runInContext('state.allTeachers.map(t => t.user_id)', ctx)), [1, 2, 3, 4],
    'state.allTeachers 原序不动（排序只作用于渲染副本）');
  // 无匹配数据（教师端）：v0.25.112 匹配度选项彻底移除（非隐藏），排序回落评分最高
  vm.runInContext(`
    state.user = { role: 'teacher', id: 1, username: 't' };
    state.allTeachers = ${JSON.stringify(TEACHERS)};
    syncMatchSortOpt();
  `, ctx);
  assert.equal(vm.runInContext(`document.getElementById('opt-sort-match')`, ctx), null,
    'v0.25.112：教师看教师「匹配度最高」选项从下拉彻底删除（非隐藏）');
  assert.equal(vm.runInContext(`document.getElementById('teacher-sort').value`, ctx), 'rating',
    'v0.25.112：教师看教师默认排序=评分最高');
  vm.runInContext(`applyFilters()`, ctx);
  assert.deepEqual(Array.from(vm.runInContext('state.allTeachers.map(t => t.user_id)', ctx)), [1, 2, 3, 4],
    'state.allTeachers 原序不动（排序只作用于渲染副本）');
});

test('v0.25.112：教师看教师/访客删除匹配度排序项（用户纠正 v0.25.110 误删成需求大厅）', () => {
  const { ctx, dom } = makeCtx();
  seed(ctx, TEACHERS); // seed 默认 role=teacher
  vm.runInContext('syncMatchSortOpt()', ctx);
  const opts = vm.runInContext(`[...document.getElementById('teacher-sort').options].map(o => o.value).join(',')`, ctx);
  assert.equal(opts, 'rating,price', '教师看教师下拉仅评分/报价，无匹配度选项');
  assert.equal(vm.runInContext(`document.getElementById('teacher-sort').value`, ctx), 'rating', '教师看教师默认评分最高');
  vm.runInContext('applyFilters()', ctx);
  const first = dom.window.document.querySelector('#teachers-list .list-card--teacher .tc-username');
  assert.ok(first && first.textContent.includes('甲'), '教师看教师按评分排序：首卡 5 分甲（非匹配度）');
  // 访客浏览同款（未登录）：同样无匹配度选项、默认评分
  vm.runInContext('state.user = null; syncMatchSortOpt()', ctx);
  assert.equal(vm.runInContext(`document.getElementById('opt-sort-match')`, ctx), null, '访客浏览同样删除匹配度选项');
  assert.equal(vm.runInContext(`document.getElementById('teacher-sort').value`, ctx), 'rating', '访客浏览默认评分最高');
});

test('sortTeachers 组合：排序控件改变影响 applyFilters 输出顺序', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  seed(ctx, TEACHERS);
  vm.runInContext(`document.getElementById('teacher-sort').value = 'rating'; applyFilters()`, ctx);
  const first = doc.querySelector('#teachers-list .list-card--teacher .tc-username');
  assert.ok(first && first.textContent.includes('甲'), '评分排序下首卡为 5 分甲');
  vm.runInContext(`document.getElementById('teacher-sort').value = 'price'; applyFilters()`, ctx);
  const first2 = doc.querySelector('#teachers-list .list-card--teacher .tc-username');
  assert.ok(first2 && first2.textContent.includes('乙'), '报价排序下首卡为 100 乙');
});
