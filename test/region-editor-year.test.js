/**
 * 教师端高考赋分组件按（省份, 毕业年份）选政策渲染回归（R2-12）
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 demand-form-2b.test.js）：
 *   - renderTeacherGaokaoEditor('zhejiang', 2021) → 21 档旧制下拉（L1..L21）；
 *   - renderTeacherGaokaoEditor('zhejiang', 2022 / 未填) → 20 区间新制下拉（I1..I20，M2 修正：2022 届即新制）；
 *   - renderTeacherGaokaoEditor('shanghai', 2016) → 传统文理（理科/文科 pill + 原始分录入）；
 *   - renderTeacherGaokaoEditor('shanghai', 2017) → 11 等第 pill（含 B-）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  const fns = vm.runInContext(`({ renderTeacherGaokaoEditor, gaokaoPolicyMismatchCount, teacherSubjectPool })`, ctx);
  // 纯数据源（region-data / app-display）经 vm 沙箱取，断言跨 realm 用 JSON 归一
  const data = vm.runInContext(`({
    REGIONS: globalThis.SUFE_REGIONS,
    DISP: globalThis.SUFE_DISPLAY,
  })`, ctx);
  return { dom, fns, data };
}

// 勾选擅长科目（renderTeacherGaokaoEditor 只渲染勾选范围内科目），并给出毕业年份输入元素
function mountSubjects(doc, subjectIds) {
  const box = doc.getElementById('profile-subjects');
  box.innerHTML = subjectIds.map(sid => `<label><input type="checkbox" value="${sid}" checked>${sid}</label>`).join('');
}

test('renderTeacherGaokaoEditor：浙江 2021 → 21 档旧制下拉，2022/未填 → 20 区间新制下拉（M2 修正）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  mountSubjects(doc, ['physics']); // 浙江 3+3 选考物理（再选科目按等第/区间录入）
  const container = doc.getElementById('profile-gaokao-scores');

  container.innerHTML = fns.renderTeacherGaokaoEditor('zhejiang', 2021, []);
  const sel2021 = container.querySelector('select.gk-grade-select[data-gk-subject="physics"]');
  assert.ok(sel2021, '浙江 2021 应渲染等第下拉');
  const opt2021 = [...sel2021.options].map(o => o.value);
  assert.ok(opt2021.includes('L1') && opt2021.includes('L21'), '2021 用 21 档旧制 L1..L21');
  assert.ok(!opt2021.includes('I1'), '2021 不含 20 区间选项');

  container.innerHTML = fns.renderTeacherGaokaoEditor('zhejiang', 2022, []);
  const sel2022 = container.querySelector('select.gk-grade-select[data-gk-subject="physics"]');
  const opt2022 = [...sel2022.options].map(o => o.value);
  assert.ok(opt2022.includes('I1') && opt2022.includes('I20'), '2022 用 20 区间新制 I1..I20');
  assert.ok(!opt2022.includes('L1'), '2022 不含 21 档选项');

  container.innerHTML = fns.renderTeacherGaokaoEditor('zhejiang', undefined, []);
  const selLatest = container.querySelector('select.gk-grade-select[data-gk-subject="physics"]');
  assert.ok([...selLatest.options].some(o => o.value === 'I1'), '未填毕业年份 → 最新 20 区间');
});

test('R2-12/H1 存量旧档成绩失配：L 档在 20 区间下警告横幅 + gaokaoPolicyMismatchCount；填毕业年份消除', () => {
  const { dom, fns, data } = makeCtx();
  const doc = dom.window.document;
  mountSubjects(doc, ['physics']);
  const container = doc.getElementById('profile-gaokao-scores');

  // 存量浙江 L3 档成绩 + 未填毕业年份 → 最新 20 区间 → 失配 1 + 警告横幅
  container.innerHTML = fns.renderTeacherGaokaoEditor('zhejiang', undefined, [{ subject: 'physics', grade: 'L3' }]);
  assert.ok(container.querySelector('.gaokao-mismatch-warn'), '未填年份 + 旧档成绩 → 警告横幅');
  assert.equal(fns.gaokaoPolicyMismatchCount(data.REGIONS.policyOf('zhejiang'), [{ subject: 'physics', grade: 'L3' }]), 1, '20 区间下 L 档失配 1 条');
  // 填 2020 毕业年份 → 21 档旧制 → 失配 0，无横幅
  assert.equal(fns.gaokaoPolicyMismatchCount(data.REGIONS.policyOf('zhejiang', 2020), [{ subject: 'physics', grade: 'L3' }]), 0, '21 档下 L 档匹配 0 失配');
  container.innerHTML = fns.renderTeacherGaokaoEditor('zhejiang', 2020, [{ subject: 'physics', grade: 'L3' }]);
  assert.equal(container.querySelector('.gaokao-mismatch-warn'), null, '填对年份后无警告');
  // 分数制条目恒匹配（不误报）
  assert.equal(fns.gaokaoPolicyMismatchCount(data.REGIONS.policyOf('hainan'), [{ subject: 'physics', score: 250 }]), 0, '海南标准分不误报');
});

test('R2-12/M3 教师科目池省感知：浙江含技术，其他省不含；技术显示映射兜底', () => {
  const { fns, data } = makeCtx();
  const zj = fns.teacherSubjectPool('zhejiang');
  assert.ok(zj.some(s => s.id === 'technology'), '浙江科目池含技术');
  const sh = fns.teacherSubjectPool('shanghai');
  assert.ok(!sh.some(s => s.id === 'technology'), '上海不含技术');
  const empty = fns.teacherSubjectPool('');
  assert.ok(!empty.some(s => s.id === 'technology'), '未选省份不含技术');
  assert.equal(JSON.parse(JSON.stringify(data.DISP.subjectName('technology'))), '技术', '技术显示映射走 region-data 兜底');
});

test('renderTeacherGaokaoEditor：上海 2016 → 传统文理（理科原始分），2017 → 11 等第 pill（含 B-）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  mountSubjects(doc, ['physics']);
  const container = doc.getElementById('profile-gaokao-scores');

  container.innerHTML = fns.renderTeacherGaokaoEditor('shanghai', 2016, []);
  assert.ok(container.innerHTML.includes('理科'), '改革前上海渲染传统文理分科 pill');
  assert.ok(container.querySelector('input[data-gk-type="score"][data-gk-subject="physics"]'), '理科物理按原始分录入');

  container.innerHTML = fns.renderTeacherGaokaoEditor('shanghai', 2017, []);
  const grades = container.querySelectorAll('.grade-selector[data-gk-subject="physics"] .grade-option');
  assert.equal(grades.length, 11, '2017 起上海 11 等第 pill');
  assert.equal(grades[0].textContent, 'A+（70分）');
  assert.ok([...grades].some(g => g.textContent === 'B-（58分）'), '含 B- 等第');
  assert.ok([...grades].some(g => g.textContent === 'E（40分）'), '末等第 E（40分）');
});

test('renderTeacherGaokaoEditor：未选省份提示、invalid 省份提示', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  mountSubjects(doc, ['physics']);
  const container = doc.getElementById('profile-gaokao-scores');
  container.innerHTML = fns.renderTeacherGaokaoEditor('', undefined, []);
  assert.ok(container.innerHTML.includes('请先选择高考所在省份'), '空省份给提示');
  container.innerHTML = fns.renderTeacherGaokaoEditor('not-a-province', 2020, []);
  assert.ok(container.innerHTML.includes('请先选择高考所在省份'), '非法省份给提示');
});
