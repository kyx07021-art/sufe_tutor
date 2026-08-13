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
  // 拦截 showToast：记录文案断言超限提示（__toasts 在沙箱 globalThis，经 ctx 读取）
  vm.runInContext(`globalThis.__toasts = []; showToast = (msg) => __toasts.push(msg);`, ctx);
  const fns = vm.runInContext(`({
    renderDemandModal, initDemandForm, prefillDemandForm, switchDemandType,
    toggleTagPick, renderDemandCard,
    onDemandProvinceChange, toggleAddressField,
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

  fns.switchDemandType(doc.querySelector('#d-type-tabs .seg-tab[data-type="nonacademic"]'));
  assert.equal(ac.classList.contains('hidden'), true, '切到非学科后学科隐藏');
  assert.equal(na.classList.contains('hidden'), false, '切到非学科后非学科可见');
  assert.equal(doc.querySelector('#d-type-tabs .seg-tab.active').dataset.type, 'nonacademic', 'tab 选中态切换');

  fns.switchDemandType(doc.querySelector('#d-type-tabs .seg-tab[data-type="academic"]'));
  assert.equal(ac.classList.contains('hidden'), false, '切回学科恢复');
  assert.equal(na.classList.contains('hidden'), true);
  assert.equal(doc.querySelector('#d-type-tabs .seg-tab.active').dataset.type, 'academic');
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

// ============================================================
// 需求五：上海精细地址选择组件（区→镇/街道二级联动；组合值写 #d-address 保持提交签名不变）
// ============================================================
test('需求五 地址区：无省份/非上海 隐藏；上海（不限教学方式）显示精细选择并组装值', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('');
  const section = doc.getElementById('d-address-section');
  const addr = doc.getElementById('d-address');
  const method = doc.getElementById('d-method');
  const prov = doc.getElementById('d-province');
  assert.ok(section.classList.contains('hidden'), '无省份 → 地址区隐藏');
  assert.equal(addr.value, '', '隐藏时地址值清空');
  // v0.31.0 任务三 wizard：教学方式归 P2、地址归 P1——上海即显示精细选择（不 gate 方式），
  // 线上需求由服务端清空兜底。注：inline onchange 在 JSDOM window 域解析，测试直调函数（既有模式）
  prov.value = 'shanghai';
  fns.onDemandProvinceChange();
  assert.ok(!section.classList.contains('hidden'), '上海（方式未选/默认线上）→ 地址区可见');
  assert.equal([...method.options].filter(o => o.disabled).length, 0, '上海放开线下（offline/both 不锁）');
  assert.equal(addr.required, true, '上海地址必填');
  // 方式切线上/线下都不影响 P1 地址区可见性（地址是 P1 字段）
  method.value = 'online';
  fns.toggleAddressField();
  assert.ok(!section.classList.contains('hidden'), '上海+线上 → 地址区仍可见（P1 字段不随 P2 方式隐藏）');
  const dSel = doc.getElementById('d-district');
  const uSel = doc.getElementById('d-unit');
  assert.ok(dSel && uSel, '区/镇两个下拉渲染');
  assert.equal(uSel.disabled, true, '未选区 → 镇下拉禁用');
  assert.equal(dSel.options.length, 17, '占位 + 16 区');
  // 选区 → 镇下拉启用并重建（addEventListener 监听在 vm 域注册，dispatch 直触）
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
});

test('需求五 地址区：非上海省份锁线上且地址区隐藏（线下许可数据驱动）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('beijing'); // 非上海：初始即锁线上
  const method = doc.getElementById('d-method');
  const section = doc.getElementById('d-address-section');
  const addr = doc.getElementById('d-address');
  assert.equal(method.value, 'online', '非上海初始锁线上');
  assert.ok(section.classList.contains('hidden'), '非上海 → 地址区隐藏');
  assert.equal(addr.required, false, '非上海地址非必填');
});

test('需求五 地址区：编辑回填——先写隐藏地址值再挂 picker，区/镇预选', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('shanghai');
  fns.prefillDemandForm({
    id: 9, province: 'shanghai', student_grade: 'senior1', student_gender: '',
    target_type: 'academic', target_subjects: ['math'], current_scores: [],
    preferred_personality_tags: [], preferred_teacher_gender: '',
    teaching_method: 'offline', address: '黄浦区·南京东路街道', expected_time: '',
    budget_min: 100, budget_max: 150, submitter_type: 'self',
    parent_contact: 'x', student_contact: 'y', additional_info: '',
  });
  const doc2 = doc;
  const section = doc2.getElementById('d-address-section');
  const addr = doc2.getElementById('d-address');
  assert.ok(!section.classList.contains('hidden'), '上海线下编辑回填 → 地址区可见');
  assert.equal(doc2.getElementById('d-district').value, 'huangpu', '区下拉回填');
  assert.equal(doc2.getElementById('d-unit').value, '南京东路街道', '镇下拉回填');
  assert.equal(addr.value, '黄浦区·南京东路街道', '隐藏值保留组合地址');
});

test('需求五 地址区：旧自由文本地址回填被清空重选（存量兼容，防保存 400 卡死）', () => {
  const { dom, fns } = makeCtx();
  const doc = dom.window.document;
  doc.getElementById('modal-container').innerHTML = fns.renderDemandModal(null);
  fns.initDemandForm('shanghai');
  fns.prefillDemandForm({
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
});
