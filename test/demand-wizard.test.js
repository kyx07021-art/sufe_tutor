/**
 * 任务三（v0.31.0）需求表单 wizard 回归：7 页分步 + 进度条 + 逐页校验 + 页脚切换
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 demand-form-2b.test.js）：
 *   - 渲染：7 个 .dw-step 常驻 DOM，初始仅 P1 激活；步进器 7 芯片，第 1 激活；
 *   - 逐页校验：P1 缺省份/缺上海地址 → 不前进 + toast；P3 缺年级、P4 缺科目、P7 缺联系方式同样拦截；
 *   - 导航：合法前进至 P7 → 提交按钮可见、下一步隐藏；Back 回退；P1 无 Back；
 *   - form novalidate（原生校验关闭，每页 JS 拦）。
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
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
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
  vm.runInContext(`globalThis.__toasts = []; showToast = (msg) => __toasts.push(msg);`, ctx);
  const fns = vm.runInContext(`({
    renderDemandModal, initDemandForm, prefillDemandForm, switchDemandType, updateDemandSubjects,
    onDemandProvinceChange, toggleAddressField,
    demandWizardGoTo, demandWizardNext, demandWizardBack, demandWizardValidateStep,
  })`, ctx);
  const toasts = () => vm.runInContext('globalThis.__toasts', ctx);
  return { dom, fns, toasts };
}

test('wizard 渲染：7 步常驻 DOM、初始 P1 激活、步进器 7 芯片、form novalidate', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('');
  const steps = [...doc.querySelectorAll('#demand-form .dw-step')];
  assert.equal(steps.length, 7, '7 个分步页');
  assert.deepEqual(steps.map(s => +s.dataset.step), [1, 2, 3, 4, 5, 6, 7], '步号 1-7');
  assert.equal(steps[0].classList.contains('dw-step--active'), true, '初始 P1 激活');
  assert.equal(steps.slice(1).some(s => s.classList.contains('dw-step--active')), false, '其余页隐藏');
  const chips = [...doc.querySelectorAll('#dw-stepper .dw-step-chip')];
  assert.equal(chips.length, 7, '步进器 7 芯片');
  assert.equal(chips[0].classList.contains('dw-step-chip--active'), true, '芯片 1 激活');
  assert.equal(doc.getElementById('demand-form').noValidate, true, 'form novalidate（原生校验关闭）');
  assert.ok(doc.getElementById('dw-back').classList.contains('hidden'), 'P1 无上一步');
  assert.ok(!doc.getElementById('dw-next').classList.contains('hidden'), 'P1 有下一步');
  const submit1 = doc.getElementById('d-submit');
  assert.ok(submit1.classList.contains('hidden'), 'P1 无提交按钮');
  assert.equal(submit1.disabled, true, 'P1 提交按钮禁用（防 Enter 隐式提交半截表单，审计 🟡3）');
});

test('wizard 逐页校验：P1 缺省份 / 缺上海地址 → 不前进 + toast', () => {
  const { dom, fns, toasts } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('');
  const active = () => [...doc.querySelectorAll('#demand-form .dw-step.dw-step--active')].map(s => +s.dataset.step);
  fns.demandWizardNext(); // 无省份
  assert.deepEqual(active(), [1], '缺省份不前进');
  assert.equal(toasts().at(-1), '请选择省份', '缺省份 toast');
  // 选上海但没选地址 → 拦截
  doc.getElementById('d-province').value = 'shanghai';
  fns.onDemandProvinceChange();
  fns.demandWizardNext();
  assert.deepEqual(active(), [1], '上海缺地址不前进');
  assert.equal(toasts().at(-1), '请选择所在区与镇/街道', '缺地址 toast');
  // 补地址 → 前进到 P2
  doc.getElementById('d-address').value = '黄浦区·南京东路街道';
  fns.demandWizardNext();
  assert.deepEqual(active(), [2], 'P1 校验通过 → P2');
});

test('wizard 逐页校验：P3 缺年级 / P4 缺科目 / P7 缺联系方式 → 拦截；合法流到 P7 出提交按钮', () => {
  const { dom, fns, toasts } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('shanghai');
  const active = () => [...doc.querySelectorAll('#demand-form .dw-step.dw-step--active')].map(s => +s.dataset.step);
  const go = (n) => fns.demandWizardGoTo(n);
  // 填 P1 合法值，直接跳到 P3 测年级拦截
  doc.getElementById('d-address').value = '黄浦区·南京东路街道';
  go(3);
  fns.demandWizardNext();
  assert.deepEqual(active(), [3], '缺年级不前进');
  assert.equal(toasts().at(-1), '请选择学生年级', '缺年级 toast');
  doc.getElementById('d-grade').value = 'senior1';
  fns.updateDemandSubjects();
  go(4);
  fns.demandWizardNext(); // 科目未勾
  assert.deepEqual(active(), [4], '缺科目不前进');
  assert.equal(toasts().at(-1), '请至少选择一个科目', '缺科目 toast');
  // 勾一科 → 前进到 P5 → P6 → P7（时间/预算空合法，成绩可选）
  const cb = [...doc.querySelectorAll('#d-subjects input')].find(c => c.value === 'math');
  assert.ok(cb, '数学科目渲染');
  cb.checked = true;
  fns.demandWizardNext();
  assert.deepEqual(active(), [5], 'P4 校验通过 → P5');
  fns.demandWizardNext();
  assert.deepEqual(active(), [6], 'P5（成绩可选）→ P6');
  fns.demandWizardNext();
  assert.deepEqual(active(), [7], 'P6（时间/预算空合法）→ P7');
  assert.ok(doc.getElementById('dw-next').classList.contains('hidden'), 'P7 无下一步');
  assert.ok(!doc.getElementById('d-submit').classList.contains('hidden'), 'P7 提交按钮可见');
  assert.equal(doc.getElementById('d-submit').disabled, false, 'P7 提交按钮启用');
  assert.ok(!doc.getElementById('dw-back').classList.contains('hidden'), 'P7 有上一步');
  // P7 缺联系方式 → 拦截
  fns.demandWizardValidateStep(7);
  assert.equal(toasts().at(-1), '请填写家长与学生联系方式', '缺联系方式 toast');
  // Back 回退
  fns.demandWizardBack();
  assert.deepEqual(active(), [6], 'Back 回 P6');
  assert.ok(doc.getElementById('dw-next').classList.contains('hidden') === false, 'P6 下一步恢复');
});

test('wizard 编辑模式：prefill 后回 P1 且字段值跨页保留', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('shanghai');
  fns.prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    preferred_personality_tags: ['patience'], preferred_teacher_gender: 'female',
    teaching_method: 'offline', address: '黄浦区·南京东路街道', expected_time: '',
    budget_min: 100, budget_max: 150, submitter_type: 'self',
    parent_contact: '13800000000', student_contact: '13900000000', additional_info: '周末上课',
  });
  const active = [...doc.querySelectorAll('#demand-form .dw-step.dw-step--active')].map(s => +s.dataset.step);
  assert.deepEqual(active, [1], '编辑回填后回到 P1');
  assert.equal(doc.getElementById('d-address').value, '黄浦区·南京东路街道', 'P1 地址回填保留');
  // 跨页值保留：跳到 P4 科目勾选仍在
  fns.demandWizardGoTo(4);
  assert.deepEqual([...doc.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value), ['math'], 'P4 科目勾选跨页保留');
  assert.equal(doc.getElementById('d-pref-gender').value, 'female', 'P4 偏好性别回填');
  // 跳到 P7 联系方式
  fns.demandWizardGoTo(7);
  assert.equal(doc.getElementById('d-parent-contact').value, '13800000000', 'P7 联系方式回填');
  assert.equal(doc.getElementById('d-info').value, '周末上课', 'P7 补充说明回填');
});
