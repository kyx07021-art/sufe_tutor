/**
 * Z-3-F1 F1c：教师档案编辑表单渲染 + 预填 + 进入链路（jsdom 直测 ESM）。
 *
 * 覆盖：
 *   - renderTeacherProfileForm：四区结构（基本/学科/非学科/私密）字段全部在位，
 *     必填标记、白名单选项（TEACHER_GRADES/GENDERS/TEACHING_METHODS/SUBJECTS）、
 *     已有档案回显（value/selected/checked 预填）、零内联事件/样式、服务端值 escHtml 转义；
 *   - profile null（无档案教师）→ 空表单默认值；
 *   - enterTeacherProfile：GET /api/teacher/profile → 渲染表单 → time_slots 预填 →
 *     Shanghai address picker 挂载（hidden 值同步）→ 失败路径错误态。
 *
 * 测试夹具必须用生产形状（G3）：time_slots = sanitizeTimeSlots 输出
 *   [{type:'week',dow,start,end}]（缺 type 会被 prefillTimeSlots 过滤 → 断言空转）。
 * 断言锁真实行为（G2）：删掉 prefillTimeSlots 调用测试必须变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTeacherProfileForm } from '../src/client/features/teacher/render.js';
import * as actions from '../src/client/features/teacher/actions.js';
import { state } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { TEXT } from '../src/client/constants/text.js';

const dom = new JSDOM('<!doctype html><html><body><div id="teacher-profile-content"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
// F1d2: initCustomSelects wraps the ZJ/Beijing 21-tier gk-grade-select with a MutationObserver —
// the global must exist in jsdom or wrapping throws and the whole form init fails.
globalThis.MutationObserver = dom.window.MutationObserver;
setEnsureAuth(() => true);

function setup() {
  state.user = { id: 40, role: 'teacher', username: 'teacher' };
  const el = dom.window.document.getElementById('teacher-profile-content');
  el.innerHTML = '';
  return el;
}
function teardown() {
  state.user = null;
  delete globalThis.fetch;
}

const FULL_PROFILE = {
  user_id: 40, username: 'teacher',
  province: 'shanghai', grade: 'sophomore', gender: 'female',
  school: '上海财经大学', real_name: '王老师', graduation_year: 2022,
  subjects: ['math', 'english'], price_min: 100, price_max: 150,
  teaching_method: 'online',
  // PROD 形状：sanitizeTimeSlots 输出含 type:'week'（缺 type 会被 prefill 过滤）
  time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
  personality_tags: ['patience'], nonacademic_projects: ['music'],
  nonacademic_prices: [{ project: 'music', price_min: 200, price_max: 300 }],
  intro: '多年教学经验', address: '浦东新区·张江镇',
  wechat: 'wx_teacher', email: 'teacher@example.com',
  gaokao_scores: [{ subject: 'math', score: 145 }],
};

test('F1c 渲染：四区结构 + 全部字段在位 + 零内联事件/样式', () => {
  const html = renderTeacherProfileForm(FULL_PROFILE);
  // 四区标题
  assert.ok(html.includes('profile-group-title'), '分区标题在位');
  assert.ok(html.includes('tp-province'), '省份下拉在位');
  assert.ok(html.includes('tp-grade'), '年级下拉在位');
  assert.ok(html.includes('tp-gender'), '性别下拉在位');
  assert.ok(html.includes('tp-school'), '学校输入在位');
  assert.ok(html.includes('tp-real-name'), '真实姓名在位');
  assert.ok(html.includes('tp-grad-year'), '毕业年份在位');
  assert.ok(html.includes('tp-subjects'), '科目勾选在位');
  assert.ok(html.includes('tp-price-min'), '报价下限在位');
  assert.ok(html.includes('tp-price-max'), '报价上限在位');
  assert.ok(html.includes('tp-method'), '授课方式在位');
  assert.ok(html.includes('tp-time-slots'), '可授课时间段在位');
  assert.ok(html.includes('tp-gaokao'), '高考成绩区在位');
  assert.ok(html.includes('tp-nonacademic'), '非学科项目在位');
  assert.ok(html.includes('tp-nonacademic-prices'), '非学科报价在位');
  assert.ok(html.includes('tp-intro'), '简介在位');
  assert.ok(html.includes('tp-addr-picker'), '上海地址 picker 容器在位');
  assert.ok(html.includes('tp-address'), '地址 hidden 在位');
  assert.ok(html.includes('tp-wechat'), '微信在位');
  assert.ok(html.includes('tp-email'), '邮箱在位');
  assert.ok(html.includes('teacher.saveProfile'), '保存按钮 data-action 在位');
  // 必填标记：province/grade/gender/subjects/price_min/method/time_slots
  const requiredFields = ['tp-province', 'tp-grade', 'tp-gender', 'tp-subjects', 'tp-price-min', 'tp-method', 'tp-time-slots'];
  for (const id of requiredFields) {
    assert.ok(html.includes(`<span class="req">*</span>`), `必填标记存在（${id}）`);
  }
  // 契约 6：零内联事件/样式属性
  assert.ok(!/onclick=/.test(html), '零内联 onclick');
  assert.ok(!/onchange=/.test(html), '零内联 onchange');
  assert.ok(!/style=/.test(html), '零内联 style 属性');
  assert.ok(html.startsWith('<form'), '根元素为 form');
});

test('F1c 回显：已有档案预填 value/selected/checked', () => {
  const html = renderTeacherProfileForm(FULL_PROFILE);
  assert.ok(html.includes('value="2022"'), '毕业年份回显');
  assert.ok(html.includes('value="上海财经大学"'), '学校回显');
  assert.ok(html.includes('value="王老师"'), '真实姓名回显');
  assert.ok(html.includes('value="wx_teacher"'), '微信回显');
  assert.ok(html.includes('value="teacher@example.com"'), '邮箱回显');
  assert.ok(html.includes('value="100"'), '报价下限回显');
  assert.ok(html.includes('value="150"'), '报价上限回显');
  assert.ok(html.includes('value="sophomore" selected'), '年级 selected 属性（锁 selected 非仅 option）');
  assert.ok(html.includes('value="female" selected'), '性别 selected 属性');
  assert.ok(html.includes('value="online" selected'), '授课方式 selected 属性');
  assert.ok(html.includes('value="math" checked'), '科目 math checked 属性');
  assert.ok(html.includes('value="english" checked'), '科目 english checked 属性');
});

test('F1c 转义：恶意服务端值 escHtml 后插值（XSS 纵深）', () => {
  const evil = { school: '"><script>alert(1)</script>', real_name: '" onfocus=alert(1)', intro: '<img src=x onerror=alert(1)>', wechat: '"><svg onload=alert(1)>' };
  const html = renderTeacherProfileForm(evil);
  assert.ok(html.includes('&quot; onfocus=alert(1)'), '引号被转义（无法逃逸属性）');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script 标签被转义');
  assert.ok(!html.includes('<img src=x'), 'img 标签被转义');
  assert.ok(!html.includes('<svg onload'), 'svg 标签被转义');
});

test('F1c 空档案：profile null → 空表单默认值（无 undefined/null 注入）', () => {
  const html = renderTeacherProfileForm(null);
  assert.ok(html.includes('id="tp-province"'), '空表单省份在位');
  assert.ok(!html.includes('undefined'), '零 undefined 注入');
  assert.ok(!html.includes('value="null"'), '零 null 注入');
});

test('F1c 进入链路：GET profile → 渲染表单 → time_slots 预填 → 地址 picker 挂载', async () => {
  setup();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ profile: FULL_PROFILE }) });
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  assert.ok(el.querySelector('#teacher-profile-form'), '表单已渲染');
  assert.ok(el.querySelector('#tp-province'), '省份 select 在');
  // time_slots 预填：PROD 形状（type:week）→ 真实行渲染（G2：删 prefill 必红）
  const rows = el.querySelectorAll('#tp-time-slots .time-slot');
  assert.equal(rows.length, 1, 'time-slot 行真实渲染 1 行（非空容器空转）');
  assert.equal(rows[0].querySelector('.slot-dow').value, '1', '星期 select 预填 dow=1');
  assert.ok(rows[0].querySelector('.time-range'), '起止时间输入在位');
  assert.ok(rows[0].querySelector('.time-slot-del'), '删除按钮在位');
  // address picker 挂载：hidden 值 = 原地址
  assert.equal(el.querySelector('#tp-address').value, '浦东新区·张江镇', '地址 hidden 保留原值');
  assert.equal(el.querySelector('#tp-district').value, 'pudong', '区 select 已选中');
  assert.equal(el.querySelector('#tp-unit').value, '张江镇', '镇 select 已选中');
  teardown();
});

test('F1c 进入链路：加载失败 → 错误态渲染（零 JS 抛错）', async () => {
  setup();
  globalThis.fetch = async () => { throw new Error('boom'); };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  assert.ok(el.querySelector('.empty-state'), '错误态在位');
  assert.ok(el.textContent.includes(TEXT.ERROR_LOAD_PREFIX), '错误前缀展示（api 包装层统一文案）');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1 F1d1：字段联动交互（省份→地址区显隐 + method 无条件锁定、personality/非学科
// 标签点选 + 上限钳制、非学科报价行重渲染保留已填值、毕业年份钳制）。
// F1d1-4 修复：直调 actions.*（不依赖点击委托）；被测 profile 初始不预选被测标签
// （否则 toggle 不可观察 → 断言空转）。
// ─────────────────────────────────────────────────────────────

async function setupForm(profile) {
  setup();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ profile: profile || null }) });
  await actions.enterTeacherProfile();
  return dom.window.document.getElementById('teacher-profile-content');
}

test('F1d1 联动：method 无条件锁定（非上海强制 online，切上海恢复可选）', async () => {
  // 非法保存态：beijing + offline（服务端无 province 门禁，前端是 parity guard）
  const el = await setupForm({ province: 'beijing', teaching_method: 'offline' });
  const method = el.querySelector('#tp-method');
  const offlineOpt = method.querySelector('option[value="offline"]');
  assert.equal(method.value, 'online', 'init 即强制 online（非法 offline 态被锁定）');
  assert.ok(offlineOpt.disabled, 'offline 选项禁用（非上海）');
  // 切上海 → offline 恢复可选且不翻转当前值
  const prov = el.querySelector('#tp-province');
  prov.value = 'shanghai';
  prov.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(!offlineOpt.disabled, '上海恢复 offline 可选');
  assert.equal(method.value, 'online', '上海不强制翻转当前值');
  method.value = 'offline';
  // 切回北京 → 无条件强制 online
  prov.value = 'beijing';
  prov.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(method.value, 'online', '切回非上海强制 online');
  teardown();
});

test('F1d1 联动：地址区显隐 + 上海地址 picker 挂载 + hidden 同步', async () => {
  const el = await setupForm({ province: 'shanghai', address: '浦东新区·张江镇' });
  const addrSection = el.querySelector('#tp-addr-picker');
  assert.ok(!addrSection.classList.contains('hidden'), '上海地址区可见');
  assert.ok(el.querySelector('#tp-district'), '上海地址 picker 已挂载区 select');
  assert.equal(el.querySelector('#tp-district').value, 'pudong', '区已选中');
  assert.equal(el.querySelector('#tp-unit').value, '张江镇', '镇已选中');
  // 切非上海 → 隐藏 + 清空 hidden
  const prov = el.querySelector('#tp-province');
  prov.value = 'beijing';
  prov.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(addrSection.classList.contains('hidden'), '非上海地址区隐藏');
  assert.equal(el.querySelector('#tp-address').value, '', 'hidden 地址清空');
  teardown();
});

test('F1d1 标签：personality 点选 + 上限钳制（toast 提示不选中）', async () => {
  const el = await setupForm({}); // 初始不预选被测标签（F1d1-4）
  const host = el.querySelector('#tp-personality');
  assert.ok(host.querySelectorAll('.tag-pick').length > 0, 'personality 容器标签已注入（非死 UI）');
  const tags = [...host.querySelectorAll('.tag-pick')];
  assert.ok(tags.length > 3, '标签数多于上限，可测钳制');
  for (const t of tags.slice(0, 3)) actions.teacherTagPick(t);
  assert.equal(host.querySelectorAll('.tag-pick.selected').length, 3, '3 个选中（上限内）');
  const overflow = tags[3];
  actions.teacherTagPick(overflow);
  assert.ok(!overflow.classList.contains('selected'), '超上限不选中');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('最多选 3 个'), 'toast 提示上限');
  // 取消一个 → 可再选
  actions.teacherTagPick(tags[0]);
  assert.ok(!tags[0].classList.contains('selected'), '取消选中');
  actions.teacherTagPick(overflow);
  assert.ok(overflow.classList.contains('selected'), '腾位后可再选');
  teardown();
});

test('F1d1 非学科报价行：标签点选生成行 + 重渲染保留已填值（G2：删保留逻辑必红）', async () => {
  const el = await setupForm({});
  const host = el.querySelector('#tp-nonacademic-prices');
  const music = el.querySelector('#tp-nonacademic .tag-pick[data-id="music"]');
  actions.teacherTagPick(music);
  let rows = host.querySelectorAll('.price-row');
  assert.equal(rows.length, 1, '选中 music 生成 1 行');
  rows[0].querySelector('[data-field="min"]').value = '200';
  rows[0].querySelector('[data-field="max"]').value = '300';
  // 再点 painting → 重渲染 → music 行已填值保留
  const painting = el.querySelector('#tp-nonacademic .tag-pick[data-id="painting"]');
  actions.teacherTagPick(painting);
  rows = host.querySelectorAll('.price-row');
  assert.equal(rows.length, 2, '两个选中项目两行');
  const musicRow = [...rows].find(r => r.dataset.project === 'music');
  assert.ok(musicRow, 'music 行在位');
  assert.equal(musicRow.querySelector('[data-field="min"]').value, '200', 'min 已填值保留');
  assert.equal(musicRow.querySelector('[data-field="max"]').value, '300', 'max 已填值保留');
  // 取消 music → 行移除
  actions.teacherTagPick(music);
  rows = host.querySelectorAll('.price-row');
  assert.equal(rows.length, 1, '取消后行移除');
  teardown();
});

test('F1d1 毕业年份钳制 [1980, 2030]', async () => {
  const el = await setupForm({});
  const gradYear = el.querySelector('#tp-grad-year');
  gradYear.value = '1900';
  gradYear.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(gradYear.value, '1980', '下界钳制');
  gradYear.value = '2050';
  gradYear.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(gradYear.value, '2030', '上界钳制');
  gradYear.value = '2022';
  gradYear.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(gradYear.value, '2022', '范围内不变');
  gradYear.value = '';
  gradYear.dispatchEvent(new dom.window.Event('blur'));
  assert.equal(gradYear.value, '', '空值保留空');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1 F1d2：gaokao 高考成绩编辑器（渲染 / 收集 shape / 交互）。
// 收集 shape 与服务端契约（teacher/api.js sanitize）一致：
// [{subject, score?} | {subject, grade?}]，subject 白名单含浙江技术，
// 主科原始分 / 再选等第，空行跳过，hidden track 行跳过。
// ─────────────────────────────────────────────────────────────

const GK_312_PROFILE = {
  province: 'hebei', teaching_method: 'online',
  subjects: ['chinese', 'math', 'english', 'physics', 'chemistry', 'biology', 'history'],
  gaokao_scores: [{ subject: 'physics', score: 92 }, { subject: 'chemistry', grade: 'A' }],
};

test('F1d2 3+1+2 渲染：主科分数 + 首选 pill + 再选等第（收集 shape 契约）', async () => {
  const el = await setupForm(GK_312_PROFILE);
  const gk = el.querySelector('#tp-gaokao');
  assert.ok(gk.querySelector('input[data-gk-subject="chinese"][data-gk-type="score"]'), '语文分数输入在位');
  assert.equal(gk.querySelector('input[data-gk-subject="chinese"]').getAttribute('max'), '150', '主科满分 150');
  const firstPills = [...gk.querySelectorAll('[data-gk-role="first"] .gk-pill')];
  assert.equal(firstPills.length, 2, '首选两门 pill（物理/历史）');
  const physPill = firstPills.find(p => p.dataset.gkFirst === 'physics');
  assert.ok(physPill.classList.contains('selected'), 'physics pill 选中（有存量分）');
  assert.equal(gk.querySelector('input[data-gk-role="first-score"]').value, '92', '首选分数回显');
  const chemSel = gk.querySelector('.grade-selector[data-gk-subject="chemistry"]');
  assert.ok(chemSel.querySelector('.grade-option[data-grade="A"]').classList.contains('selected'), 'chemistry 等第 A 选中');
  // 收集 shape：主科空跳过 → physics 分数 + chemistry 等第（服务端契约形状）
  assert.deepEqual(actions.collectTeacherGaokao(),
    [{ subject: 'physics', score: 92 }, { subject: 'chemistry', grade: 'A' }]);
  teardown();
});

test('F1d2 浙江 3+3：技术 extraElective 在位 + 20 区间 select 档位', async () => {
  const el = await setupForm({
    province: 'zhejiang', graduation_year: 2023, teaching_method: 'online',
    subjects: ['chinese', 'math', 'english', 'physics', 'chemistry', 'technology'],
  });
  const gk = el.querySelector('#tp-gaokao');
  assert.ok(gk.querySelector('[data-gk-check-row="technology"]'), '浙江技术科目行在位（extraElective）');
  const techCtl = gk.querySelector('[data-gk-check-row="technology"] .gk-grade-select');
  assert.ok(techCtl, '技术等第用 select（20 区间 > 11 档）');
  assert.ok(techCtl.querySelector('option[value="I1"]'), '浙江 20 区间 I1 档在');
  teardown();
});

test('F1d2 收集 shape：主科填分 + 首选换 pill 分数跟随（v1 误归属修复）', async () => {
  const el = await setupForm(GK_312_PROFILE);
  const gk = el.querySelector('#tp-gaokao');
  gk.querySelector('input[data-gk-subject="chinese"]').value = '140';
  gk.querySelector('input[data-gk-subject="math"]').value = '135';
  const historyPill = [...gk.querySelectorAll('[data-gk-role="first"] .gk-pill')].find(p => p.dataset.gkFirst === 'history');
  actions.pickGkPill(historyPill);
  assert.ok(historyPill.classList.contains('selected'), 'history pill 选中');
  const firstScore = gk.querySelector('input[data-gk-role="first-score"]');
  assert.equal(firstScore.value, '', '切到无存量分 pill 分数清空');
  firstScore.value = '85';
  const physicsPill = gk.querySelector('[data-gk-role="first"] .gk-pill[data-gk-first="physics"]');
  actions.pickGkPill(physicsPill);
  assert.equal(firstScore.value, '92', '切回 physics 恢复存量分（不误归属 history 的 85）');
  assert.deepEqual(actions.collectTeacherGaokao(), [
    { subject: 'chinese', score: 140 }, { subject: 'math', score: 135 },
    { subject: 'physics', score: 92 }, { subject: 'chemistry', grade: 'A' },
  ]);
  teardown();
});

test('F1d2 等第不匹配警告 + 无效省份提示', async () => {
  const el = await setupForm({
    province: 'hebei', teaching_method: 'online',
    subjects: ['chinese', 'math', 'english', 'chemistry'],
    gaokao_scores: [{ subject: 'chemistry', grade: 'X' }], // X 不在 standard5 A-E
  });
  const gk = el.querySelector('#tp-gaokao');
  assert.ok(gk.querySelector('.gaokao-mismatch-warn'), '等第不匹配警告在位');
  assert.ok(gk.querySelector('.gaokao-mismatch-warn').textContent.includes('1'), '警告计数 n=1');
  teardown();
  const el2 = await setupForm({ teaching_method: 'online' }); // 无省份
  const gk2 = el2.querySelector('#tp-gaokao');
  assert.ok(gk2.textContent.includes(TEXT.REGION_HINT_PICK_PROVINCE), '未选省份提示');
  teardown();
});

test('F1d2 科目勾选变化 → 编辑器重渲染（首选 pill 出现）', async () => {
  const el = await setupForm({ province: 'hebei', teaching_method: 'online', subjects: ['chinese', 'math', 'english'] });
  assert.ok(el.querySelector('#tp-gaokao').textContent.includes(TEXT.REGION_HINT_FILL_ELECTIVE), '未勾再选科目 → 提示');
  const physCb = el.querySelector('#tp-subjects input[value="physics"]');
  physCb.checked = true;
  physCb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(el.querySelector('#tp-gaokao [data-gk-role="first"] .gk-pill'), '勾选 physics 后首选 pill 出现');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1 F1d3：收集/校验/提交。payload.profile 形状与服务端 handleSaveProfile 契约一致
// （province/grade/gender/subjects/price/method/time_slots JSON 串/gaokao_scores 数组/
// 非学科报价行/credential 回传）；必填校验失败零请求；成功回读刷新。
// ─────────────────────────────────────────────────────────────

const F3_SAVE_PROFILE = {
  province: 'shanghai', teaching_method: 'online', grade: 'sophomore', gender: 'female',
  subjects: ['math', 'english'], price_min: 100, price_max: 150,
  time_slots: JSON.stringify([{ type: 'week', dow: 1, start: '18:00', end: '20:00' }]),
  wechat: 'wx', email: 't@e.com', intro: 'hello', real_name: '王老师', school: '上财',
};

test('F1d3 提交：payload shape 与服务端契约一致 + 成功回读', async () => {
  setup();
  let postBody = null;
  globalThis.fetch = async (url, opts) => {
    if ((opts || {}).method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  el.querySelector('#tp-grad-year').value = '2022';
  el.querySelector('#tp-gaokao input[data-gk-subject="math"]').value = '145'; // shanghai 3+3 主科
  await actions.saveProfile();
  assert.ok(postBody, 'POST /api/teacher/profile 已发出');
  const p = postBody.profile;
  assert.equal(p.province, 'shanghai');
  assert.equal(p.grade, 'sophomore');
  assert.equal(p.gender, 'female');
  assert.deepEqual(p.subjects, ['math', 'english']);
  assert.equal(p.price_min, '100');
  assert.equal(p.price_max, '150');
  assert.equal(p.teaching_method, 'online');
  assert.equal(JSON.parse(p.time_slots)[0].dow, 1, 'time_slots JSON 串形状');
  assert.ok(Array.isArray(p.gaokao_scores) && p.gaokao_scores.some(g => g.subject === 'math' && g.score === 145), 'gaokao_scores 收集（数学 145）');
  assert.equal(p.credential_image, '', '空凭证回传空（不误清已有值）');
  assert.equal(p.wechat, 'wx');
  assert.equal(p.real_name, '王老师');
  assert.equal(p.address, '', '无地址回传空');
  teardown();
});

test('F1d3 必填校验：缺必填（空表单）→ toast + 零 POST', async () => {
  setup();
  let called = false;
  globalThis.fetch = async (url, opts) => {
    if ((opts || {}).method === 'POST') { called = true; return { ok: true, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ profile: null }) };
  };
  await actions.enterTeacherProfile();
  await actions.saveProfile();
  assert.equal(called, false, '零 POST 请求');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('请完善教师档案必填项'), '必填提示 toast');
  teardown();
});

test('F1d3 time_slots 必填：无时间段 → toast + 零 POST', async () => {
  setup();
  let called = false;
  const profile = { province: 'shanghai', teaching_method: 'online', grade: 'sophomore', gender: 'female', subjects: ['math', 'english'], price_min: 100, price_max: 150 };
  globalThis.fetch = async (url, opts) => {
    if ((opts || {}).method === 'POST') { called = true; return { ok: true, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ profile }) };
  };
  await actions.enterTeacherProfile();
  await actions.saveProfile();
  assert.equal(called, false, '零 POST 请求');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('可授课时间段'), '时间段必填提示');
  teardown();
});
