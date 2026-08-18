/**
 * 学生需求侧扩充前端回归（R2-b：需求类型分段切换 / 偏好性格 / 偏好性别 / 学生性别改造 / 非学科卡渲染）
 * B4：vm 沙箱 → 直接 import student/region feature ESM（真实 index.html 壳替换为最小 jsdom 壳）。
 *
 * 覆盖：
 *   - 需求表单顶部类型分段切换：学科/非学科 区块显隐（JS 只切 .active/.hidden 类）；
 *   - 偏好性格 tag-pick：上限 PERSONALITY_TAGS_MAX、超限 toast（复用 toggleTagPick）；
 *   - 学生性别 select：''=不愿透露（默认）/男/女，无 nonbinary，非必填；偏好老师性别：不限/男/女；
 *   - renderDemandCard：非学科卡渲染（类型徽章 + 项目名 + 无成绩行）、学科卡徽章；
 *   - prefillDemandForm：非学科需求回填非学科勾选 / 偏好性格 / 偏好性别 / 空学生性别；
 *   - 上海精细地址选择（区→镇/街道二级联动，组合值写 #d-address）、非上海锁线上、编辑回填、旧文本清空。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { stopVersionProbe } from '../src/client/core/datahub.js';
import { toggleTagPick } from '../src/client/core/ui.js';
import { demandStudentGenderName } from '../src/client/core/display.js';
import {
  initDemandForm, prefillDemandForm, setDemandType,
  onDemandProvinceChange, toggleAddressField, _wizardResetForTests,
} from '../src/client/features/student/actions.js';
import { renderDemandModalHtml as renderDemandModal } from '../src/client/features/student/render.js';
import { renderDemandCard } from '../src/client/features/student/render.js';

// jsdom 无原生 MutationObserver / canvas：Node 侧提供惰性替身（initCustomSelects 用到 MO）。
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
  _wizardResetForTests(); // module-level wizard state must not leak across tests
  const doc = dom.window.document;
  const mountForm = (prov) => { doc.getElementById('modal-container').innerHTML = renderDemandModal(null); initDemandForm(prov); };
  const toasts = () => [...(doc.getElementById('toast-container')?.children || [])].map(t => t.textContent);
  return { dom, doc, mountForm, toasts };
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

test('需求表单 type 切换：学科/非学科区块显隐（JS 切类）', () => {
  const { doc, mountForm } = setup();
  mountForm('');
  const ac = doc.getElementById('d-section-academic');
  const na = doc.getElementById('d-section-nonacademic');
  assert.equal(ac.classList.contains('hidden'), false, '初始学科区块可见');
  assert.equal(na.classList.contains('hidden'), true, '初始非学科区块隐藏');

  setDemandType('nonacademic');
  assert.equal(ac.classList.contains('hidden'), true, '切到非学科后学科隐藏');
  assert.equal(na.classList.contains('hidden'), false, '切到非学科后非学科可见');
  assert.equal(doc.querySelector('#d-type-tabs .seg-tab.active').dataset.type, 'nonacademic', 'tab 选中态切换');

  setDemandType('academic');
  assert.equal(ac.classList.contains('hidden'), false, '切回学科恢复');
  assert.equal(na.classList.contains('hidden'), true);
  assert.equal(doc.querySelector('#d-type-tabs .seg-tab.active').dataset.type, 'academic');
  teardown();
});

test('需求表单偏好性格 tag-pick：全量渲染、上限 3、超限 toast', () => {
  const { doc, mountForm, toasts } = setup();
  mountForm('');
  const buttons = [...doc.querySelectorAll('#d-personality-tags .tag-pick')];
  assert.equal(buttons.length, 10, '性格关键词全量渲染');
  buttons.slice(0, 3).forEach(b => toggleTagPick(b, 'd-personality-tags', 3));
  assert.equal(doc.querySelectorAll('#d-personality-tags .tag-pick.selected').length, 3, '上限内全选成功');
  assert.equal(toasts().length, 0, '上限内无 toast');

  toggleTagPick(buttons[3], 'd-personality-tags', 3);
  assert.equal(doc.querySelectorAll('#d-personality-tags .tag-pick.selected').length, 3, '超限仍为 3');
  assert.ok(!buttons[3].classList.contains('selected'), '超限项不选中');
  assert.equal(toasts()[0], '最多选 3 个', '超限 toast');
  teardown();
});

test('学生性别 select：空串=不愿透露默认/男/女，无 nonbinary，非必填；偏好老师性别 不限/男/女', () => {
  const { doc, mountForm } = setup();
  mountForm('');
  const genderSel = doc.getElementById('d-gender');
  assert.equal(genderSel.required, false, '学生性别非必填（空串 = 不愿透露合法）');
  assert.deepEqual([...genderSel.options].map(o => o.value), ['', 'male', 'female'], '无 nonbinary');
  assert.equal(genderSel.options[0].textContent, '不愿透露', '默认项 = 不愿透露');
  const prefSel = doc.getElementById('d-pref-gender');
  assert.deepEqual([...prefSel.options].map(o => o.value), ['', 'male', 'female'], '偏好老师性别：不限/男/女');
  teardown();
});

test('renderDemandCard：非学科卡渲染（类型徽章 + 项目名 + 无成绩行）', () => {
  const d = {
    id: 3, user_id: 5, username: '学生B', student_grade: 'senior1', student_gender: '',
    target_type: 'nonacademic', target_subjects: ['music', 'chess'], current_scores: [],
    teaching_method: 'online', address: '', province: 'shanghai', budget_min: 0, budget_max: 0,
    status: 'open', display_id: 9, avatar: '', created_at: '2026-08-08 00:00:00',
    pending_intents: 0, intent_count: 0,
  };
  const html = renderDemandCard(d, {});
  assert.ok(html.includes('非学科'), '类型徽章显示非学科');
  assert.ok(html.includes('乐器/音乐'), '显示非学科项目名');
  assert.ok(html.includes('棋类'), '显示第二个项目名');
  assert.ok(!html.includes('score'), '非学科无成绩行（current_scores 空天然不渲染）');
});

test('renderDemandCard：学科卡渲染（学科徽章 + 科目名，不含非学科）', () => {
  const d = {
    id: 4, user_id: 6, username: '学生A', student_grade: 'senior1', student_gender: 'male',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    teaching_method: 'offline', address: '', province: 'shanghai', budget_min: 0, budget_max: 0,
    status: 'open', display_id: 10, avatar: '', created_at: '2026-08-08 00:00:00',
    pending_intents: 0, intent_count: 0,
  };
  const html = renderDemandCard(d, {});
  assert.ok(html.includes('学科'), '学科徽章');
  assert.ok(!html.includes('非学科'), '学科卡不含非学科徽章');
  assert.ok(html.includes('数学'), '科目名');
});

test('prefillDemandForm：非学科需求回填非学科勾选、偏好性格、偏好性别、空学生性别', () => {
  const { doc, mountForm } = setup();
  mountForm('shanghai');
  prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'nonacademic', target_subjects: ['music', 'chess'], current_scores: [],
    preferred_personality_tags: ['patience', 'strict'], preferred_teacher_gender: 'female',
    teaching_method: 'online', address: '', expected_time: '', budget_min: 100, budget_max: 150,
    submitter_type: 'parent', parent_contact: 'x', student_contact: 'y', additional_info: '',
  });
  assert.equal(doc.getElementById('d-section-academic').classList.contains('hidden'), true, '非学科回填后学科隐藏');
  assert.equal(doc.getElementById('d-section-nonacademic').classList.contains('hidden'), false, '非学科区块可见');
  assert.deepEqual([...doc.querySelectorAll('#d-nonacademic input:checked')].map(cb => cb.value), ['music', 'chess'], '非学科项目勾选回填');
  assert.deepEqual([...doc.querySelectorAll('#d-personality-tags .tag-pick.selected')].map(b => b.dataset.id), ['patience', 'strict'], '偏好性格回填');
  assert.equal(doc.getElementById('d-pref-gender').value, 'female', '偏好老师性别回填');
  assert.equal(doc.getElementById('d-gender').value, '', '学生性别空串回填（不愿透露）');
  teardown();
});

test('R2-11 学生性别展示：demandStudentGenderName（网安 L2 修复）', () => {
  const { doc } = setup();
  // v1.0.3 卡面海报化后性别收进详情浮窗——断言改为两层：
  // ①卡面零性别泄漏（信息取舍天然满足）②demandStudentGenderName 口径正确（male→男、''/nonbinary→空）
  const snapshot = (gender) => {
    const card = renderDemandCard({
      id: 1, username: 'stu', student_grade: 'junior1', student_gender: gender,
      target_type: 'academic', target_subjects: ['math'], current_scores: [],
      province: 'shanghai', teaching_method: 'offline', created_at: '2026-01-01 00:00:00',
      display_id: 7, status: 'open', intent_count: 0, pending_intents: 0,
      address: '', additional_info: '', budget_min: null, budget_max: null,
    }, {});
    doc.body.innerHTML = card;
    return doc.querySelector('.list-card--demand').textContent;
  };
  assert.ok(!snapshot('').includes('男') && !snapshot('').includes('女'), '空串(不愿透露)卡面不渲染性别');
  assert.ok(!snapshot('nonbinary').includes('男') && !snapshot('nonbinary').includes('女'), '历史 nonbinary 卡面不渲染性别（视同未填）');
  assert.equal(demandStudentGenderName('male'), '男', 'male 口径正确（详情浮窗展示用）');
  teardown();
});

// ============================================================
// 需求五：上海精细地址选择组件（区→镇/街道二级联动；组合值写 #d-address 保持提交签名不变）
// ============================================================
test('需求五 地址区：仅「上海+线下」显示精细选择并组装值（v0.31.5 P3 gate）', () => {
  const { dom, doc, mountForm } = setup();
  mountForm('');
  const section = doc.getElementById('d-address-section');
  const addr = doc.getElementById('d-address');
  const method = doc.getElementById('d-method');
  const prov = doc.getElementById('d-province');
  assert.ok(section.classList.contains('hidden'), '无省份 → 地址区隐藏');
  assert.equal(addr.value, '', '隐藏时地址值清空');
  // v0.31.5（P3 用户返工）：授课区域移入 P2 期望教学方式，仅「上海+线下」显示——线上不强行报地址。
  prov.value = 'shanghai';
  onDemandProvinceChange();
  assert.ok(section.classList.contains('hidden'), '上海+默认线上 → 地址区隐藏（线上不要求地址）');
  assert.equal([...method.options].filter(o => o.disabled).length, 0, '上海放开线下（offline/both 不锁）');
  // 切线下 → 地址区显示必填
  method.value = 'offline';
  toggleAddressField();
  assert.ok(!section.classList.contains('hidden'), '上海+线下 → 地址区可见');
  assert.equal(addr.required, true, '上海+线下地址必填');
  // 切回线上 → 隐藏 + 清值（防残留带进提交）
  method.value = 'online';
  toggleAddressField();
  assert.ok(section.classList.contains('hidden'), '上海+线上 → 地址区隐藏');
  assert.equal(addr.value, '', '线上隐藏清空地址值');
  // 再切线下 → 显示，picker 正常
  method.value = 'offline';
  toggleAddressField();
  assert.ok(!section.classList.contains('hidden'), '上海+线下再显示');
  const dSel = doc.getElementById('d-district');
  const uSel = doc.getElementById('d-unit');
  assert.ok(dSel && uSel, '区/镇两个下拉渲染');
  assert.equal(uSel.disabled, true, '未选区 → 镇下拉禁用');
  assert.equal(dSel.options.length, 17, '占位 + 16 区');
  // 选区 → 镇下拉启用并重建
  dSel.value = 'huangpu';
  dSel.dispatchEvent(new dom.window.Event('change'));
  assert.equal(uSel.disabled, false, '选区后镇下拉启用');
  assert.equal(uSel.options.length, 11, '占位 + 黄浦 10 街道');
  // 选镇 → 组合值写隐藏 #d-address
  uSel.value = '南京东路街道';
  uSel.dispatchEvent(new dom.window.Event('change'));
  assert.equal(addr.value, '黄浦区·南京东路街道', '组合值 = 区名·镇/街道');
  // 清空区 → 镇禁用、地址值清空
  dSel.value = '';
  dSel.dispatchEvent(new dom.window.Event('change'));
  assert.equal(uSel.disabled, true, '区清空 → 镇禁用');
  assert.equal(addr.value, '', '区清空 → 地址值清空');
  teardown();
});

test('需求五 地址区：非上海省份锁线上且地址区隐藏（线下许可数据驱动）', () => {
  const { doc, mountForm } = setup();
  mountForm('beijing'); // 非上海：初始即锁线上
  const method = doc.getElementById('d-method');
  const section = doc.getElementById('d-address-section');
  const addr = doc.getElementById('d-address');
  assert.equal(method.value, 'online', '非上海初始锁线上');
  assert.ok(section.classList.contains('hidden'), '非上海 → 地址区隐藏');
  assert.equal(addr.required, false, '非上海地址非必填');
  teardown();
});

test('需求五 地址区：编辑回填——先写隐藏地址值再挂 picker，区/镇预选', () => {
  const { doc, mountForm } = setup();
  mountForm('shanghai');
  prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    preferred_personality_tags: [], preferred_teacher_gender: '',
    teaching_method: 'offline', address: '黄浦区·南京东路街道', expected_time: '',
    budget_min: 100, budget_max: 150, submitter_type: 'self',
    parent_contact: 'x', student_contact: 'y', additional_info: '',
  });
  const section = doc.getElementById('d-address-section');
  const addr = doc.getElementById('d-address');
  assert.ok(!section.classList.contains('hidden'), '上海线下编辑回填 → 地址区可见');
  assert.equal(doc.getElementById('d-district').value, 'huangpu', '区下拉回填');
  assert.equal(doc.getElementById('d-unit').value, '南京东路街道', '镇下拉回填');
  assert.equal(addr.value, '黄浦区·南京东路街道', '隐藏值保留组合地址');
  teardown();
});

test('需求五 地址区：旧自由文本地址回填被清空重选（存量兼容，防保存 400 卡死）', () => {
  const { doc, mountForm } = setup();
  mountForm('shanghai');
  prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    preferred_personality_tags: [], preferred_teacher_gender: '',
    teaching_method: 'offline', address: '浦东新区杨高中路1234号', expected_time: '',
    budget_min: 100, budget_max: 150, submitter_type: 'self',
    parent_contact: 'x', student_contact: 'y', additional_info: '',
  });
  const addr = doc.getElementById('d-address');
  assert.equal(addr.value, '', '旧自由文本地址 → 清空（编辑保存时须重新选择，避免 ADDRESS_REQUIRED 卡死）');
  assert.equal(doc.getElementById('d-district').value, '', '区下拉未预选');
  assert.equal(doc.getElementById('d-unit').disabled, true, '镇下拉禁用（未选区）');
  teardown();
});
