/**
 * B4 redo：student 域动作全接线回归（独立审计断线点修复验证）——
 *   toggleDemandIntents 懒加载 + 红点消除、showMatchDetail 悬浮明细卡、
 *   编辑需求拉最新预填 + PUT merge-preserve（上海线下/非学科破坏性用例）、
 *   doSubmitIntent 乐观按钮翻转、toggleDemandFilters 面板 id 契约。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { closeAllModals } from '../src/client/core/ui.js';
import { toggleDemandIntents, showMatchDetail, closeMatchDetail, openDemandModal, handleSubmitDemand, doSubmitIntent, toggleDemandFilters, _wizardResetForTests } from '../src/client/features/student/actions.js';
import { renderDemandCard } from '../src/client/features/student/render.js';
import studentFeature from '../src/client/features/student/index.js';
import { TEXT } from '../src/client/constants/text.js';

class MOStub { observe() {} disconnect() {} takeRecords() { return []; } }

function setup(extraHtml = '') {
  const dom = new JSDOM(`<!doctype html><html><body><div id="modal-container"></div><div id="toast-container"></div>${extraHtml}</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = MOStub; // initDemandForm → initCustomSelects needs it
  setEnsureAuth(() => true);
  _dhResetForTests();
  _wizardResetForTests();
  closeAllModals();
  state.user = null; state.allTeachers = []; state.myDemands = []; state.browseDemands = [];
  return dom;
}
function teardown() {
  stopVersionProbe();
  closeAllModals();
  _wizardResetForTests();
  setEnsureAuth(null);
  delete globalThis.MutationObserver;
  delete globalThis.fetch;
  delete globalThis.document; delete globalThis.window;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  state.user = null; state.allTeachers = []; state.myDemands = []; state.browseDemands = [];
}

test('toggleDemandIntents：首次展开懒加载意向 + 红点消除；loaded 后收起/再开不重复拉取', async () => {
  setup(`<div id="intents-box-5" class="intents-box"><div class="intents-box-inner"></div></div>
    <button id="intent-toggle-5" class="btn-intent-toggle"></button><span id="intent-dot-5" class="corner-dot"></span>`);
  let intentsCalled = 0;
  globalThis.fetch = async url => {
    if (String(url) === '/api/demands/5/intents') {
      intentsCalled++;
      return { ok: true, status: 200, json: async () => ({ teachers: [{ user_id: 38, username: 'kkkk', rating: 4, province: 'shanghai', price_min: 150, price_max: 150, intent_id: 11, intent_status: 'pending', intent_message: '你好' }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await toggleDemandIntents(5);
  const box = document.getElementById('intents-box-5');
  assert.ok(box.classList.contains('open'), '展开');
  assert.ok(document.getElementById('intent-dot-5').classList.contains('hidden'), '红点消除');
  assert.equal(intentsCalled, 1, '懒加载一次');
  assert.ok(box.querySelector('.intents-box-inner').innerHTML.includes('kkkk'), '意向教师行已渲染');
  assert.equal(box.dataset.loaded, '1', '已标记 loaded');
  toggleDemandIntents(5); // collapse
  assert.ok(!box.classList.contains('open'), '收起');
  await toggleDemandIntents(5); // expand again
  assert.equal(intentsCalled, 1, 'loaded 后不重复拉取');
  teardown();
});

test('showMatchDetail：教师点匹配度徽章 → 明细悬浮卡挂 body；再点关闭', () => {
  setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  state.allTeachers = [{ user_id: 38, subjects: ['math'], province: 'shanghai', price_min: 150, price_max: 180, personality_tags: ['patience'], gender: 'male', nonacademic_projects: [] }];
  state.browseDemands = [{ id: 1, target_type: 'academic', target_subjects: ['math'], province: 'shanghai', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male' }];
  document.body.innerHTML = renderDemandCard(state.browseDemands[0], { teacher: true, myTeacher: state.allTeachers[0] });
  showMatchDetail(1);
  const float = document.querySelector('.match-detail');
  assert.ok(float, '悬浮明细卡渲染');
  assert.equal(float.parentElement, document.body, '挂 body（不被 .list-card containing block 困住）');
  assert.ok(float.innerHTML.includes(TEXT.MATCH_DETAIL_TITLE), '明细标题渲染');
  showMatchDetail(1); // toggle off
  assert.ok(!document.querySelector('.match-detail'), '再点关闭');
  closeMatchDetail();
  teardown();
});

test('openDemandModal 编辑分支：拉最新 + 预填表单 + 保存走 PUT', async () => {
  setup();
  state.user = { id: 40, username: '学生A', role: 'student' };
  state.myDemands = [{
    id: 2, display_id: 7, student_grade: 'senior1', target_type: 'academic', target_subjects: ['math'],
    current_scores: [], teaching_method: 'online', province: 'shanghai', budget_min: 100, budget_max: 200,
    parent_contact: '13800138000', student_contact: '13900139000', additional_info: '补基础',
    status: 'open', username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
  }];
  const calls = [];
  globalThis.fetch = async (url, config = {}) => {
    const u = String(url);
    if (u.includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: state.myDemands }) };
    if (u.includes('/api/student/demands')) {
      calls.push({ method: config.method, body: JSON.parse(config.body) });
      return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await openDemandModal(2);
  assert.equal(document.querySelector('#modal-container .modal-header h2').textContent, TEXT.MODAL_TITLE_DEMAND_EDIT, '编辑标题（非新建）');
  assert.equal(document.getElementById('d-province').value, 'shanghai', '省份预填');
  assert.equal(document.getElementById('d-grade').value, 'senior1', '年级预填');
  assert.equal(document.getElementById('d-method').value, 'online', '方式预填');
  assert.equal(document.getElementById('d-budget-min').value, '100', '预算下限预填');
  assert.equal(document.getElementById('d-budget-max').value, '200', '预算上限预填');
  assert.equal(document.getElementById('d-parent-contact').value, '13800138000', '家长联系方式预填');
  assert.ok([...document.querySelectorAll('#d-subjects input')].some(cb => cb.checked && cb.value === 'math'), '科目勾选预填');
  await handleSubmitDemand();
  assert.equal(calls[0].method, 'PUT', '编辑保存走 PUT /api/student/demands/:id');
  assert.equal(calls[0].body.demand.additional_info, '补基础', '表单值随提交');
  teardown();
});

// 上海线下需求编辑保存：全字段表单回填后随表单提交（地址/提交者/时间/标签/目标均来自表单，
// 不再需要 merge-preserve——8 步向导已收集全部字段）。时间槽 '[]' 源数据 → 空槽 → ''（v1 契约）。
// 注：openDemandModal 内部 invalidate('demands') 会把 state.myDemands 置 [] 再拉新，
// 测试 stub 必须返回捕获快照（生产服务端返回新数组，天然无此问题）。
test('编辑全字段表单：上海线下需求地址/提交者/标签/目标随表单回填提交', async () => {
  setup();
  state.user = { id: 40, username: '学生A', role: 'student' };
  const srcDemands = [{
    id: 3, display_id: 8, student_grade: 'senior1', target_type: 'academic', target_subjects: ['math'],
    current_scores: [], teaching_method: 'offline', province: 'shanghai',
    address: '黄浦区·南京东路街道', expected_time: '[]', submitter_type: 'parent',
    preferred_personality_tags: ['patience'], preferred_teacher_gender: 'female', teaching_goal: ['interest'],
    budget_min: 100, budget_max: 200, parent_contact: '13800138000', student_contact: '13900139000',
    additional_info: '补基础', status: 'open', username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
  }];
  state.myDemands = srcDemands;
  const calls = [];
  globalThis.fetch = async (url, config = {}) => {
    const u = String(url);
    if (u.includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: srcDemands }) };
    if (u.includes('/api/student/demands')) {
      calls.push({ method: config.method, body: JSON.parse(config.body) });
      return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await openDemandModal(3);
  document.getElementById('d-method').value = 'offline';
  await handleSubmitDemand();
  assert.equal(calls[0].method, 'PUT', '编辑保存走 PUT');
  assert.equal(calls[0].body.demand.address, '黄浦区·南京东路街道', '上海线下地址随表单提交');
  assert.equal(calls[0].body.demand.submitter_type, 'parent', '提交者类型随表单提交');
  assert.equal(calls[0].body.demand.expected_time, '', '时间槽空 → 空串（v1 契约：空槽不写 JSON）');
  assert.deepEqual(calls[0].body.demand.preferred_personality_tags, ['patience'], '偏好性格随表单提交');
  assert.equal(calls[0].body.demand.preferred_teacher_gender, 'female', '偏好老师性别随表单提交');
  assert.deepEqual(calls[0].body.demand.teaching_goal, ['interest'], '教学目标随表单提交');
  teardown();
});

// 非学科需求编辑保存：8 步向导的非学科区块回填项目勾选 + 技能现状，保存随表单提交
// （target_type 来自 P4 类型分段，skill_notes 来自 P5 技能文本框，不走合并回填）。
test('编辑非学科需求：target_type/skill_notes 随非学科表单回填提交', async () => {
  setup();
  state.user = { id: 40, username: '学生A', role: 'student' };
  const srcDemands = [{
    id: 4, display_id: 9, student_grade: 'senior1', target_type: 'nonacademic', target_subjects: ['music'],
    current_scores: [], teaching_method: 'online', province: 'zhejiang', address: '',
    expected_time: '', submitter_type: 'student', skill_notes: [{ project: 'music', note: '钢琴八级' }],
    budget_min: 0, budget_max: 0, parent_contact: '13800138000', student_contact: '13900139000',
    additional_info: '', status: 'open', username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
  }];
  state.myDemands = srcDemands;
  const calls = [];
  globalThis.fetch = async (url, config = {}) => {
    const u = String(url);
    if (u.includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: srcDemands }) };
    if (u.includes('/api/student/demands')) {
      calls.push({ method: config.method, body: JSON.parse(config.body) });
      return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await openDemandModal(4);
  assert.equal(document.getElementById('d-section-nonacademic').classList.contains('hidden'), false, '非学科区块回填可见');
  assert.deepEqual([...document.querySelectorAll('#d-nonacademic input:checked')].map(cb => cb.value), ['music'], '非学科项目勾选回填');
  await handleSubmitDemand();
  assert.equal(calls[0].method, 'PUT', '编辑保存走 PUT');
  assert.equal(calls[0].body.demand.target_type, 'nonacademic', 'target_type 来自 P4 类型分段');
  assert.deepEqual(calls[0].body.demand.target_subjects, ['music'], '非学科项目随表单提交');
  assert.deepEqual(calls[0].body.demand.skill_notes, [{ project: 'music', note: '钢琴八级' }], '技能现状随表单提交');
  teardown();
});

// 审计阻断 B：doSubmitIntent 乐观按钮替换——CTA 带 data-demand-id，提交后翻转「意向已提交」待处理态
test('doSubmitIntent：CTA 按钮提交后立即翻转待处理态（data-demand-id 契约）', async () => {
  setup();
  state.user = { id: 38, username: 'kkkk', role: 'teacher' };
  const demand = { id: 5, user_id: 39, username: '学生A', display_id: 8, target_subjects: ['math'], target_type: 'academic' };
  state.browseDemands = [demand];
  document.body.innerHTML = renderDemandCard(demand, { teacher: true, myTeacher: null });
  const cta = document.querySelector(`.btn-intent-cta[data-demand-id="5"]`);
  assert.ok(cta, 'CTA 带 data-demand-id（doSubmitIntent 选择器契约）');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ message: 'ok' }) });
  await doSubmitIntent(5);
  const wait = document.querySelector(`.btn-intent-wait[data-demand-id="5"]`);
  assert.ok(wait, '提交后按钮翻转为待处理态');
  assert.ok(!document.querySelector('.btn-intent-cta'), 'CTA 不再可重复点击');
  assert.equal(demand.my_intent_status, 'pending', '本地状态同步 pending');
  teardown();
});

test('toggleDemandFilters：折叠面板 id 与 v1 契约一致（demand-filter-panel）', () => {
  setup('<div id="demand-filter-panel" class="hidden"></div>');
  const p = document.getElementById('demand-filter-panel');
  assert.ok(p.classList.contains('hidden'), '初始隐藏');
  toggleDemandFilters();
  assert.ok(!p.classList.contains('hidden'), '展开');
  toggleDemandFilters();
  assert.ok(p.classList.contains('hidden'), '再折叠');
  teardown();
});

// 复审审计断线回归：student.editDemand 曾经包装 renderDemandModal(Number) → (n).id === undefined
// → 误开「新建」空表单。现在 ACTION_MAP 直调 openDemandModal(id)，点编辑按钮必须开「编辑」标题表单。
test('student.editDemand 接线：点编辑按钮经委托打开编辑表单（标题=编辑非新建）', async () => {
  setup();
  state.user = { id: 40, username: '学生A', role: 'student' };
  const srcDemands = [{
    id: 2, display_id: 7, student_grade: 'senior1', target_type: 'academic', target_subjects: ['math'],
    current_scores: [], teaching_method: 'online', province: 'shanghai', budget_min: 100, budget_max: 200,
    parent_contact: '13800138000', student_contact: '13900139000', additional_info: '补基础',
    status: 'open', username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
  }];
  state.myDemands = srcDemands;
  globalThis.fetch = async (url, config = {}) => {
    const u = String(url);
    if (u.includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: srcDemands }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  // NOTE: mount the card in a side host -- document.body.innerHTML would wipe #modal-container
  setup('<div id="card-host"></div>');
  state.user = { id: 40, username: '学生A', role: 'student' };
  state.myDemands = srcDemands;
  globalThis.fetch = async (url, config = {}) => {
    const u = String(url);
    if (u.includes('scope=mine')) return { ok: true, status: 200, json: async () => ({ demands: srcDemands }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const uninstall = studentFeature.onLoad(); // installs the data-action click delegation
  document.getElementById('card-host').innerHTML = renderDemandCard(srcDemands[0], { editable: true });
  const btn = document.querySelector('[data-action="student.editDemand"]');
  assert.ok(btn, '编辑按钮渲染（editable 学生卡）');
  btn.click();
  await new Promise(r => setTimeout(r, 10)); // openDemandModal edit branch fetches scope=mine first
  const title = document.querySelector('#modal-container .modal-header h2');
  assert.ok(title, '弹窗已打开');
  assert.equal(title.textContent, TEXT.MODAL_TITLE_DEMAND_EDIT, '编辑标题（非「提交学生需求」新建）');
  uninstall();
  teardown();
});
