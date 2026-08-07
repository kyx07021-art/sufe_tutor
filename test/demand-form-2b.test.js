/**
 * 学生需求侧扩充前端回归（R2-b：需求类型分段切换 / 偏好性格 / 偏好性别 / 学生性别改造 / 非学科卡渲染）
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 tag-pick-ui.test.js）：
 *   - 需求表单顶部类型分段切换：学科/非学科 区块显隐（JS 只切 .active/.hidden 类）；
 *   - 偏好性格 tag-pick：上限 PERSONALITY_TAGS_MAX、超限 toast（复用 toggleTagPick）；
 *   - 学生性别 select：''=不愿透露（默认）/男/女，无 nonbinary，非必填；偏好老师性别：不限/男/女；
 *   - renderDemandCard：非学科卡渲染（类型徽章 + 项目名 + 无成绩行）、学科卡徽章；
 *   - prefillDemandForm：非学科需求回填非学科勾选 / 偏好性格 / 偏好性别 / 空学生性别。
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
  // 拦截 showToast：记录文案断言超限提示（__toasts 在沙箱 globalThis，经 ctx 读取）
  vm.runInContext(`globalThis.__toasts = []; showToast = (msg) => __toasts.push(msg);`, ctx);
  const fns = vm.runInContext(`({
    renderDemandModal, initDemandForm, prefillDemandForm, switchDemandType,
    toggleTagPick, renderDemandCard,
  })`, ctx);
  const toasts = () => vm.runInContext('globalThis.__toasts', ctx);
  return { dom, fns, toasts };
}

test('需求表单 type 切换：学科/非学科区块显隐（JS 切类）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  const ac = doc.getElementById('d-section-academic');
  const na = doc.getElementById('d-section-nonacademic');
  assert.equal(ac.classList.contains('hidden'), false, '初始学科区块可见');
  assert.equal(na.classList.contains('hidden'), true, '初始非学科区块隐藏');

  fns.switchDemandType(doc.querySelector('.demand-type-tab[data-type="nonacademic"]'));
  assert.equal(ac.classList.contains('hidden'), true, '切到非学科后学科隐藏');
  assert.equal(na.classList.contains('hidden'), false, '切到非学科后非学科可见');
  assert.equal(doc.querySelector('.demand-type-tab.active').dataset.type, 'nonacademic', 'tab 选中态切换');

  fns.switchDemandType(doc.querySelector('.demand-type-tab[data-type="academic"]'));
  assert.equal(ac.classList.contains('hidden'), false, '切回学科恢复');
  assert.equal(na.classList.contains('hidden'), true);
  assert.equal(doc.querySelector('.demand-type-tab.active').dataset.type, 'academic');
});

test('需求表单偏好性格 tag-pick：全量渲染、上限 3、超限 toast', () => {
  const { dom, fns, toasts } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  const buttons = [...doc.querySelectorAll('#d-personality-tags .tag-pick')];
  assert.equal(buttons.length, 10, '性格关键词全量渲染');
  buttons.slice(0, 3).forEach(b => fns.toggleTagPick(b, 'd-personality-tags', 3));
  assert.equal(doc.querySelectorAll('#d-personality-tags .tag-pick.selected').length, 3, '上限内全选成功');
  assert.equal(toasts().length, 0, '上限内无 toast');

  fns.toggleTagPick(buttons[3], 'd-personality-tags', 3);
  assert.equal(doc.querySelectorAll('#d-personality-tags .tag-pick.selected').length, 3, '超限仍为 3');
  assert.ok(!buttons[3].classList.contains('selected'), '超限项不选中');
  assert.equal(toasts()[0], '最多选 3 个', '超限 toast');
});

test('学生性别 select：空串=不愿透露默认/男/女，无 nonbinary，非必填；偏好老师性别 不限/男/女', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  const genderSel = doc.getElementById('d-gender');
  assert.equal(genderSel.required, false, '学生性别非必填（空串 = 不愿透露合法）');
  assert.deepEqual([...genderSel.options].map(o => o.value), ['', 'male', 'female'], '无 nonbinary');
  assert.equal(genderSel.options[0].textContent, '不愿透露', '默认项 = 不愿透露');
  const prefSel = doc.getElementById('d-pref-gender');
  assert.deepEqual([...prefSel.options].map(o => o.value), ['', 'male', 'female'], '偏好老师性别：不限/男/女');
});

test('renderDemandCard：非学科卡渲染（类型徽章 + 项目名 + 无成绩行）', () => {
  const { fns } = makeCtx();
  const d = {
    id: 3, user_id: 5, username: '学生B', student_grade: 'senior1', student_gender: '',
    target_type: 'nonacademic', target_subjects: ['music', 'chess'], current_scores: [],
    teaching_method: 'online', address: '', province: 'shanghai', budget_min: 0, budget_max: 0,
    status: 'open', display_id: 9, avatar: '', created_at: '2026-08-08 00:00:00',
    pending_intents: 0, intent_count: 0,
  };
  const html = fns.renderDemandCard(d, {});
  assert.ok(html.includes('非学科'), '类型徽章显示非学科');
  assert.ok(html.includes('乐器/音乐'), '显示非学科项目名');
  assert.ok(html.includes('棋类'), '显示第二个项目名');
  assert.ok(!html.includes('score'), '非学科无成绩行（current_scores 空天然不渲染）');
});

test('renderDemandCard：学科卡渲染（学科徽章 + 科目名，不含非学科）', () => {
  const { fns } = makeCtx();
  const d = {
    id: 4, user_id: 6, username: '学生A', student_grade: 'senior1', student_gender: 'male',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    teaching_method: 'offline', address: '', province: 'shanghai', budget_min: 0, budget_max: 0,
    status: 'open', display_id: 10, avatar: '', created_at: '2026-08-08 00:00:00',
    pending_intents: 0, intent_count: 0,
  };
  const html = fns.renderDemandCard(d, {});
  assert.ok(html.includes('学科'), '学科徽章');
  assert.ok(!html.includes('非学科'), '学科卡不含非学科徽章');
  assert.ok(html.includes('数学'), '科目名');
});

test('prefillDemandForm：非学科需求回填非学科勾选、偏好性格、偏好性别、空学生性别', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('shanghai');
  fns.prefillDemandForm({
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
});

test('R2-11 学生性别展示：demandStudentGenderName（网安 L2 修复）', () => {
  const { dom, fns } = makeCtx();
  // 经 renderDemandCard 快照断言：'' 与历史 nonbinary 都不渲染性别文字；male/female 正常显示
  const snapshot = (gender) => {
    const doc = dom.window.document;
    const card = fns.renderDemandCard({
      id: 1, username: 'stu', student_grade: 'junior1', student_gender: gender,
      target_type: 'academic', target_subjects: ['math'], current_scores: [],
      province: 'shanghai', teaching_method: 'offline', created_at: '2026-01-01 00:00:00',
      display_id: 7, status: 'open', intent_count: 0, pending_intents: 0,
      address: '', additional_info: '', budget_min: null, budget_max: null,
    }, {});
    doc.body.innerHTML = card;
    return doc.querySelector('.demand-info-row') ? doc.querySelector('.demand-info-row').textContent : '';
  };
  assert.equal(snapshot(''), '上海 · 初一 · 提交者: 学生', '空串(不愿透露)不渲染性别');
  assert.equal(snapshot('nonbinary'), '上海 · 初一 · 提交者: 学生', '历史 nonbinary 不渲染性别（视同未填）');
  assert.match(snapshot('male'), /男/, 'male 正常显示');
});
