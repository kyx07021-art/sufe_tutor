/**
 * 任务三（v0.31.0）需求表单 wizard 回归：8 页分步 + 进度条 + 逐页校验 + 页脚切换
 * B4：vm 沙箱 → 直接 import student feature ESM。
 *
 * 覆盖：
 *   - 渲染：8 个 .dw-step 常驻 DOM，初始仅 P1 激活；步进器 8 芯片，第 1 激活；
 *   - 逐页校验：P1 缺省份/缺上海地址 → 不前进 + toast；P3 缺年级、P4 缺科目、P8 缺联系方式同样拦截；
 *   - 导航：合法前进至 P8 → 提交按钮可见、下一步隐藏；Back 回退；P1 无 Back；
 *   - form novalidate（原生校验关闭，每页 JS 拦）；
 *   - 编辑模式 prefill 回 P1 且字段跨页保留；完成态 done∪visited 驱动进度条（不跟当前页）；
 *   - 提交地址纵深防御与 toggleAddressField 同口径（上海+线上不误拦）；
 *   - F1 回归（独立审计阻断）：勾选科目后占位文案被成绩行替换，不残留。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { state } from '../src/client/core/state.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';
import {
  initDemandForm, prefillDemandForm, setDemandType, updateDemandSubjects,
  onDemandProvinceChange, toggleAddressField,
  demandWizardGoTo, demandWizardNext, demandWizardBack, demandWizardValidateStep,
  _wizardResetForTests,
} from '../src/client/features/student/actions.js';
import { renderDemandModalHtml as renderDemandModal } from '../src/client/features/student/render.js';

class MOStub { observe() {} disconnect() {} takeRecords() { return []; } }

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = MOStub;
  state.user = null; state.myDemands = []; state.browseDemands = []; state.allTeachers = [];
  _wizardResetForTests(); // create-mode completion must not inherit a previous test's edit-mode flag
  const doc = dom.window.document;
  const mountForm = (prov) => { doc.getElementById('modal-container').innerHTML = renderDemandModal(null); initDemandForm(prov); };
  const toasts = () => [...(doc.getElementById('toast-container')?.children || [])].map(t => t.textContent);
  const active = () => [...doc.querySelectorAll('#demand-form .dw-step.dw-step--active')].map(s => +s.dataset.step);
  return { dom, doc, mountForm, toasts, active };
}
function teardown() {
  stopVersionProbe();
  _wizardResetForTests();
  delete globalThis.MutationObserver;
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.myDemands = []; state.browseDemands = []; state.allTeachers = [];
}

test('wizard 渲染：8 步常驻 DOM、初始 P1 激活、步进器 8 芯片、form novalidate', () => {
  const { doc, mountForm } = setup();
  mountForm('');
  const steps = [...doc.querySelectorAll('#demand-form .dw-step')];
  assert.equal(steps.length, 8, '8 个分步页（v0.31.7 R1：教师偏好独立页）');
  assert.deepEqual(steps.map(s => +s.dataset.step), [1, 2, 3, 4, 5, 6, 7, 8], '步号 1-8');
  assert.equal(steps[0].classList.contains('dw-step--active'), true, '初始 P1 激活');
  assert.equal(steps.slice(1).some(s => s.classList.contains('dw-step--active')), false, '其余页隐藏');
  const chips = [...doc.querySelectorAll('#dw-stepper .dw-step-chip')];
  assert.equal(chips.length, 8, '步进器 8 芯片');
  assert.equal(chips[0].classList.contains('dw-step-chip--active'), true, '芯片 1 激活');
  assert.equal(doc.getElementById('demand-form').noValidate, true, 'form novalidate（原生校验关闭）');
  assert.ok(doc.getElementById('dw-back').classList.contains('hidden'), 'P1 无上一步');
  assert.ok(!doc.getElementById('dw-next').classList.contains('hidden'), 'P1 有下一步');
  const submit1 = doc.getElementById('d-submit');
  assert.ok(submit1.classList.contains('hidden'), 'P1 无提交按钮');
  assert.equal(submit1.disabled, true, 'P1 提交按钮禁用（防 Enter 隐式提交半截表单，审计 🟡3）');
  // v0.31.7 R1：P4 教学目标 tag-pick 渲染（学科/非学科通用）+ 偏好移入 P6
  assert.ok(doc.querySelectorAll('#d-teaching-goals .tag-pick').length >= 6, 'P4 教学目标标签渲染');
  assert.equal(doc.getElementById('d-pref-gender').closest('.dw-step').dataset.step, '6', '偏好老师性别移入 P6 教师偏好页');
  assert.equal(doc.getElementById('d-personality-tags').closest('.dw-step').dataset.step, '6', '偏好老师性格移入 P6');
  // v0.31.7 R3：sliding track 结构 + --dw-step-active 变量
  assert.ok(doc.querySelector('.dw-steps-track'), '滑动轨道容器存在');
  assert.ok(doc.querySelector('.dw-steps-viewport'), '定高视口容器存在');
  assert.equal(doc.getElementById('demand-form').style.getPropertyValue('--dw-step-active'), '0', '初始 track 索引 0');
  teardown();
});

test('wizard 逐页校验：P1 缺省份拦截；P2 仅上海+线下缺地址拦截（线上放行）', () => {
  const { doc, mountForm, toasts, active } = setup();
  mountForm('');
  demandWizardNext(); // 无省份
  assert.deepEqual(active(), [1], '缺省份不前进');
  assert.equal(toasts().at(-1), '请选择省份', '缺省份 toast');
  // 选上海 → P1 通过（v0.31.5 P3：地址校验已移到 P2）→ 前进 P2
  doc.getElementById('d-province').value = 'shanghai';
  onDemandProvinceChange();
  demandWizardNext();
  assert.deepEqual(active(), [2], '上海 P1 通过 → P2（地址校验在 P2）');
  // P2 默认线上 → 不需要地址 → 放行（用户选线上不被强行要求报地址）
  demandWizardNext();
  assert.deepEqual(active(), [3], 'P2 线上不需要地址 → 放行到 P3');
  // 回 P2 选线下 → 缺地址拦截
  demandWizardGoTo(2);
  doc.getElementById('d-method').value = 'offline';
  toggleAddressField();
  demandWizardNext();
  assert.deepEqual(active(), [2], '上海+线下缺地址不前进');
  assert.equal(toasts().at(-1), '请选择所在区与镇/街道', '缺地址 toast');
  // 补地址 → 通过
  doc.getElementById('d-address').value = '黄浦区·南京东路街道';
  demandWizardNext();
  assert.deepEqual(active(), [3], 'P2 补地址校验通过 → P3');
  teardown();
});

test('wizard 逐页校验：P3 缺年级 / P4 缺科目 / P8 缺联系方式 → 拦截；合法流到 P8 出提交按钮', () => {
  const { doc, mountForm, toasts, active } = setup();
  mountForm('shanghai');
  const go = (n) => demandWizardGoTo(n);
  // 填 P1 合法值，直接跳到 P3 测年级拦截
  doc.getElementById('d-address').value = '黄浦区·南京东路街道';
  go(3);
  demandWizardNext();
  assert.deepEqual(active(), [3], '缺年级不前进');
  assert.equal(toasts().at(-1), '请选择学生年级', '缺年级 toast');
  doc.getElementById('d-grade').value = 'senior1';
  updateDemandSubjects();
  go(4);
  demandWizardNext(); // 科目未勾
  assert.deepEqual(active(), [4], '缺科目不前进');
  assert.equal(toasts().at(-1), '请至少选择一个科目', '缺科目 toast');
  // 勾一科 → 前进到 P5 → P6 → P7 → P8（时间/预算空合法，成绩/教师偏好可选）
  const cb = [...doc.querySelectorAll('#d-subjects input')].find(c => c.value === 'math');
  assert.ok(cb, '数学科目渲染');
  cb.checked = true;
  demandWizardNext();
  assert.deepEqual(active(), [5], 'P4 校验通过 → P5（成绩）');
  demandWizardNext();
  assert.deepEqual(active(), [6], 'P5（成绩可选）→ P6（教师偏好，v0.31.7 R1）');
  demandWizardNext();
  assert.deepEqual(active(), [7], 'P6（教师偏好可选）→ P7（预算时间）');
  demandWizardNext();
  assert.deepEqual(active(), [8], 'P7（时间/预算空合法）→ P8（提交）');
  assert.ok(doc.getElementById('dw-next').classList.contains('hidden'), 'P8 无下一步');
  assert.ok(!doc.getElementById('d-submit').classList.contains('hidden'), 'P8 提交按钮可见');
  assert.equal(doc.getElementById('d-submit').disabled, false, 'P8 提交按钮启用');
  assert.ok(!doc.getElementById('dw-back').classList.contains('hidden'), 'P8 有上一步');
  // P8 缺联系方式 → 拦截
  demandWizardValidateStep(8);
  assert.equal(toasts().at(-1), '请填写家长与学生联系方式', '缺联系方式 toast');
  // Back 回退
  demandWizardBack();
  assert.deepEqual(active(), [7], 'Back 回 P7');
  assert.ok(doc.getElementById('dw-next').classList.contains('hidden') === false, 'P7 下一步恢复');
  teardown();
});

// 独立审计 F1（阻断）回归：勾选科目触发 change → updateDemandScores 必须替换占位文案（v1 replaceWith），
// 不得把成绩行 append 在「请先选择目标科目」提示之后。
test('F1 回归：勾选科目后占位文案被成绩行替换（hint 不残留）', () => {
  const { dom, doc, mountForm } = setup();
  mountForm('shanghai');
  doc.getElementById('d-grade').value = 'senior1';
  updateDemandSubjects(); // build pool → empty hint
  const scores = doc.getElementById('d-scores');
  assert.ok(scores.textContent.includes('请先选择目标科目'), '初始占位提示在位');
  const cb = [...doc.querySelectorAll('#d-subjects input')].find(c => c.value === 'math');
  assert.ok(cb, 'math 科目在位');
  cb.checked = true;
  cb.dispatchEvent(new dom.window.Event('change', { bubbles: true })); // 真实路径：change → updateDemandScores
  assert.ok(!scores.textContent.includes('请先选择目标科目'), '占位文案被替换（不残留）');
  assert.ok(scores.querySelector('.region-score-row[data-score-subject="math"]'), 'math 成绩行已渲染');
  teardown();
});

test('wizard 编辑模式：prefill 后回 P1 且字段值跨页保留', () => {
  const { doc, mountForm, active } = setup();
  mountForm('shanghai');
  prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    preferred_personality_tags: ['patience'], preferred_teacher_gender: 'female',
    teaching_method: 'offline', address: '黄浦区·南京东路街道', expected_time: '',
    budget_min: 100, budget_max: 150, submitter_type: 'self',
    parent_contact: '13800000000', student_contact: '13900000000', additional_info: '周末上课',
  });
  assert.deepEqual(active(), [1], '编辑回填后回到 P1');
  assert.equal(doc.getElementById('d-address').value, '黄浦区·南京东路街道', 'P1 地址回填保留');
  // 跨页值保留：跳到 P4 科目勾选仍在
  demandWizardGoTo(4);
  assert.deepEqual([...doc.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value), ['math'], 'P4 科目勾选跨页保留');
  // v0.31.7 R1：偏好移入 P6（教师偏好页）；教学目标回填
  demandWizardGoTo(6);
  assert.equal(doc.getElementById('d-pref-gender').value, 'female', 'P6 偏好性别回填（R1 移入教师偏好页）');
  // 跳到 P8 联系方式
  demandWizardGoTo(8);
  assert.equal(doc.getElementById('d-parent-contact').value, '13800000000', 'P8 联系方式回填');
  assert.equal(doc.getElementById('d-info').value, '周末上课', 'P8 补充说明回填');
  teardown();
});

// v0.31.7 R1/R2：教学目标 tag-pick 回填 + 非学科切换联动（P5 标题即时改「技能现状」+ 清成绩行 + 技能文本框）
test('R1/R2：教学目标回填；切非学科 → P5 标题改技能现状 + 成绩行清空 + 技能文本框按项目渲染', () => {
  const { doc, mountForm } = setup();
  mountForm('shanghai');
  // 非学科类型编辑数据：prefill 应渲染技能文本框并回填 note
  prefillDemandForm({
    id: 10, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'nonacademic', target_subjects: ['music', 'code'], current_scores: [],
    teaching_goal: ['interest', 'habit'], preferred_personality_tags: [], preferred_teacher_gender: '',
    teaching_method: 'online', address: '', expected_time: '', budget_min: 0, budget_max: 0,
    submitter_type: 'self', parent_contact: '13800000000', student_contact: '13900000000',
    additional_info: '', skill_notes: [{ project: 'music', note: '钢琴八级' }],
  });
  // R1：教学目标回填（P4 tag-pick selected）
  const goalSel = [...doc.querySelectorAll('#d-teaching-goals .tag-pick.selected')].map(b => b.dataset.id);
  assert.deepEqual(goalSel, ['interest', 'habit'], '教学目标 tag-pick 回填');
  // R2：P5 标题即时改技能现状
  assert.equal(doc.getElementById('d-scores-title').textContent, '技能现状', '非学科 P5 标题 = 技能现状');
  // R2：成绩行清空（学科成绩不残留）+ 技能文本框按勾选项目渲染 + note 回填
  assert.equal(doc.querySelectorAll('#d-scores .region-score-row').length, 0, '非学科成绩行清空');
  const noteRows = [...doc.querySelectorAll('#d-skill-notes .skill-note-row')];
  assert.deepEqual(noteRows.map(r => r.dataset.project), ['music', 'code'], '技能文本框按勾选项目渲染');
  const musicNote = noteRows.find(r => r.dataset.project === 'music').querySelector('textarea');
  assert.equal(musicNote.value, '钢琴八级', '技能 note 回填');
  // 切回学科 → 标题恢复 + 技能容器隐藏
  setDemandType('academic');
  assert.equal(doc.getElementById('d-scores-title').textContent, '各科当前大概成绩', '切回学科标题恢复');
  assert.ok(doc.getElementById('d-skill-notes').classList.contains('hidden'), '切回学科技能容器隐藏');
  teardown();
});

// v0.31.7 R3：完成态不跟当前页——新建 done 由校验通过驱动；编辑 visited 由翻到过驱动；连接线连续前缀
test('R3：完成态集合（done∪visited）驱动进度条，不跟当前停留页', () => {
  const { doc, mountForm } = setup();
  mountForm('shanghai');
  const chipState = (n) => {
    const ch = [...doc.querySelectorAll('#dw-stepper .dw-step-chip')].find(c => +c.dataset.step === n);
    return { done: ch.classList.contains('dw-step-chip--done'), lined: ch.classList.contains('dw-step-chip--lined') };
  };
  // 新建：P1 停留未填写 → 非 done；直接 GoTo(3)（翻页不驱动完成态）
  assert.equal(chipState(1).done, false, '新建 P1 停留未填写 → 非 done（不跟当前页）');
  demandWizardGoTo(3);
  assert.equal(chipState(1).done, false, '翻到 P3 不把 P1 标记完成（visited 仅编辑模式）');
  assert.equal(chipState(2).done, false, '未填写页非 done');
  // 校验通过（demandWizardNext）→ 该页 done
  demandWizardGoTo(1);
  doc.getElementById('d-province').value = 'shanghai';
  onDemandProvinceChange();
  demandWizardNext(); // P1 校验通过 → done + 到 P2
  assert.equal(chipState(1).done, true, 'P1 校验通过 → done');
  assert.equal(chipState(1).lined, true, 'P1 连接线（连续前缀起点）实紫');
  teardown();

  // 编辑模式：visited 由 GoTo 驱动（翻到过即实紫）
  const s2 = setup();
  const doc2 = s2.doc;
  s2.mountForm('shanghai');
  prefillDemandForm({ id: 11, province: 'shanghai', student_grade: 'senior1', target_type: 'academic', target_subjects: ['math'], current_scores: [] });
  const ch2 = (n) => [...doc2.querySelectorAll('#dw-stepper .dw-step-chip')].find(c => +c.dataset.step === n);
  assert.ok(ch2(1).classList.contains('dw-step-chip--done'), '编辑模式 P1（翻到过）→ done 实紫');
  demandWizardGoTo(4); // 翻到 P4 → visited
  assert.ok(ch2(4).classList.contains('dw-step-chip--done'), '编辑模式翻到 P4 → done 实紫');
  assert.ok(!ch2(2).classList.contains('dw-step-chip--done'), '未翻到的 P2 不实紫（连续前缀只到 P1）');
  assert.ok(ch2(2).classList.contains('dw-step-chip--lined') === false, 'P2 连接线不实紫（非连续前缀）');
  teardown();
});

// v0.31.8（生产验证抓出）：提交地址纵深防御须与 toggleAddressField 同口径「线下许可省+线下」——
// 曾只按省份判断 → toggleAddressField 线上清地址 → 上海+线上提交被误拦（v0.31.5 P3 改 gate 未同步提交兜底）。
// T-6-F4：口径改为 SUFE_REGIONS.allowsOffline(province) 单源（无 'shanghai' 字面量硬编码）。
test('v0.31.8 提交地址纵深防御含 method 判断（线下许可省+线上不拦）', () => {
  const src = readFileSync('./src/client/features/student/actions.js', 'utf8');
  assert.match(src,
    /SUFE_REGIONS\.allowsOffline\(province\) && document\.getElementById\('d-method'\)\.value === 'offline' && !document\.getElementById\('d-address'\)\.value\.trim\(\)/,
    'handleSubmitDemand 地址检查含 method==offline（与 toggleAddressField 同口径）');
  assert.doesNotMatch(src, /if \(province === 'shanghai' && !document\.getElementById\('d-address'\)\.value\.trim\(\)\)/,
    '无旧口径残留（仅省份判断的误拦分支）');
  assert.doesNotMatch(src, /province === 'shanghai'/,
    'T-6-F4：无省 id 字面量硬编码（allowsOffline 单源）');
});
