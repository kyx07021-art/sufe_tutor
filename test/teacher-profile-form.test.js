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
 * 测试夹具必须用生产形状（G3）：GET profile 的 time_slots = mapper 出口数组（T-6-F3 safeJsonArray）
 *   [{type:'week',dow,start,end}]（缺 type 会被 prefillTimeSlots 过滤 → 断言空转）；提交 body 仍为 JSON 串。
 * 断言锁真实行为（G2）：删掉 prefillTimeSlots 调用测试必须变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTeacherProfileForm, renderTeacherVerifySection, renderTeacherCard, renderProfilePanel } from '../src/client/features/teacher/render.js';
import * as actions from '../src/client/features/teacher/actions.js';
import { state } from '../src/client/core/state.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { TEXT } from '../src/client/constants/text.js';
import { LIMITS } from '../src/shared/config.js'; // ZX-1：INTRO_MAX 单源（maxlength 断言）

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
  // PROD 形状：mapper 出口数组（T-6-F3 safeJsonArray），含 type:'week'（缺 type 会被 prefill 过滤）
  time_slots: [{ type: 'week', dow: 1, start: '18:00', end: '20:00' }],
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
  assert.ok(html.includes('tp-real-name'), '平台内名称在位');
  assert.ok(html.includes('平台内名称'), 'F1c label 文本 = 平台内名称（ZR-B5 G2 锁定值而非 input id）');
  assert.ok(html.includes('高考省份'), 'F1c 省份 label = 高考省份（ZS-1 G2 锁定值而非 select id）');
  assert.ok(html.includes('tp-grad-year'), '毕业年份在位');
  assert.ok(html.includes('tp-subjects'), '科目勾选在位');
  assert.ok(html.includes('tp-price'), '报价单值输入在位（ZW-1：区间双输入→单值）');
  assert.ok(!html.includes('tp-price-min') && !html.includes('tp-price-max'), '区间双输入零残留（ZW-1）');
  assert.ok(html.includes('tp-method'), '授课方式在位');
  assert.ok(html.includes('tp-time-slots'), '可授课时间段在位');
  // ZI-1（2026-08-27）：高考成绩编辑器休眠——教师只需选擅长科目，无需填写高考成绩
  assert.ok(!html.includes('tp-gaokao') && !html.includes('高考成绩'), '高考成绩区休眠移除（变异：还原 form-group → 红）');
  assert.ok(html.includes('tp-nonacademic'), '非学科项目在位');
  assert.ok(html.includes('tp-nonacademic-prices'), '非学科报价在位');
  assert.ok(html.includes('tp-intro'), '简介在位');
  assert.ok(html.includes(`maxlength="${LIMITS.INTRO_MAX}"`), '简介 textarea maxlength=INTRO_MAX（ZX-1：输入即限制）');
  assert.ok(html.includes('tp-addr-picker'), '上海地址 picker 容器在位');
  assert.ok(html.includes('tp-address'), '地址 hidden 在位');
  // ZR-C1：联系方式只用于身份核验，表单零输入控件（变异守护：还原输入块必红）
  assert.ok(!html.includes('tp-wechat'), '微信输入已删除');
  assert.ok(!html.includes('tp-email'), '邮箱输入已删除');
  assert.ok(html.includes('teacher.saveProfile'), '保存按钮 data-action 在位');
  // 必填标记：province/grade/gender/subjects/price_min/method/time_slots
  const requiredFields = ['tp-province', 'tp-grade', 'tp-gender', 'tp-subjects', 'tp-price', 'tp-method', 'tp-time-slots'];
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
  assert.ok(html.includes('value="王老师"'), '平台内名称回显');
  assert.ok(html.includes('value="100"'), '报价单值回显（ZW-1：price_min=单值）');
  assert.ok(html.includes('value="sophomore" selected'), '年级 selected 属性（锁 selected 非仅 option）');
  assert.ok(html.includes('value="female" selected'), '性别 selected 属性');
  assert.ok(html.includes('value="online" selected'), '授课方式 selected 属性');
  assert.ok(html.includes('value="math" checked'), '科目 math checked 属性');
  assert.ok(html.includes('value="english" checked'), '科目 english checked 属性');
});

test('F1c 转义：恶意服务端值 escHtml 后插值（XSS 纵深）', () => {
  const evil = { school: '"><script>alert(1)</script>', real_name: '" onfocus=alert(1)', intro: '<img src=x onerror=alert(1)>' };
  const html = renderTeacherProfileForm(evil);
  assert.ok(html.includes('&quot; onfocus=alert(1)'), '引号被转义（无法逃逸属性）');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script 标签被转义');
  assert.ok(!html.includes('<img src=x'), 'img 标签被转义');
});

test('F1c 空档案：profile null → 空表单默认值（无 undefined/null 注入）', () => {
  const html = renderTeacherProfileForm(null);
  assert.ok(html.includes('id="tp-province"'), '空表单省份在位');
  assert.ok(!html.includes('undefined'), '零 undefined 注入');
  assert.ok(!html.includes('value="null"'), '零 null 注入');
});

test('F1c 进入链路：GET profile → 渲染表单 → time_slots 预填 → 地址 picker 挂载', async () => {
  setup();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    return { ok: true, status: 200, json: async () => ({ profile: FULL_PROFILE }) };
  };
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
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    return { ok: true, status: 200, json: async () => ({ profile: profile || null }) };
  };
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
  rows[0].querySelector('[data-field="price"]').value = '200'; // ZW-1: single-value price per project
  // 再点 painting → 重渲染 → music 行已填值保留
  const painting = el.querySelector('#tp-nonacademic .tag-pick[data-id="painting"]');
  actions.teacherTagPick(painting);
  rows = host.querySelectorAll('.price-row');
  assert.equal(rows.length, 2, '两个选中项目两行');
  const musicRow = [...rows].find(r => r.dataset.project === 'music');
  assert.ok(musicRow, 'music 行在位');
  assert.equal(musicRow.querySelector('[data-field="price"]').value, '200', '报价已填值保留（ZW-1 单值）');
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
// ZI-1/2（2026-08-27）：高考成绩编辑器休眠——教师只需选擅长科目，无需填写高考成绩。
// 表单零 gaokao 区（#tp-gaokao 移除）；collectTeacherGaokao 恒返回 []（保存提交空数组）；
// 渲染/收集函数保留导出（dormancy 非删除），无重渲染监听（F3 零累积）。
// ─────────────────────────────────────────────────────────────

test('ZI-1 高考编辑器休眠：表单零 gaokao 区 + collectTeacherGaokao 恒 [] + 函数保留导出', async () => {
  const el = await setupForm({ province: 'hebei', teaching_method: 'online', subjects: ['chinese', 'math'] });
  assert.equal(el.querySelector('#tp-gaokao'), null, '表单零 gaokao 区（变异：还原 form-group → 非 null 红）');
  assert.ok(!el.innerHTML.includes('高考成绩'), '零高考成绩文案');
  // G2 牙齿①：注入带值的假 #tp-gaokao（形状 = 旧收集器可读的 input[data-gk-type="score"][data-gk-subject]，
  // ZI 复审审计实证：data-gk-role 不在旧收集器任何读取分支 → 假 DOM 需真实形状）→ collect 仍必须恒 []
  //（锁 stub 而非「无 DOM 时自然为空」——还原旧收集器会读到该假 DOM 值返回非空 → 红）
  const gkEl = document.createElement('div');
  gkEl.id = 'tp-gaokao';
  gkEl.innerHTML = '<input type="text" data-gk-type="score" data-gk-subject="math" value="145">';
  el.appendChild(gkEl);
  assert.deepEqual(actions.collectTeacherGaokao(), [], 'collectTeacherGaokao 恒空数组（即便残留 gaokao DOM 带值）');
  assert.equal(typeof actions.refreshGaokaoEditor, 'function', 'refreshGaokaoEditor 保留导出（休眠）');
  // G2 牙齿②（F3）：勾选科目 change 不触发 gaokao 重渲染——若有人还原 subjects→refreshGaokaoEditor
  // 监听，change 会经 refreshGaokaoEditor 重写 #tp-gaokao 的 innerHTML（子节点 marker 丢失 → 红）。
  // marker 必须挂子节点而非容器 dataset（refreshGaokaoEditor 只重写 innerHTML 不碰容器 dataset，
  // 挂容器则变异不红——ZI 复审审计实证）
  const physCb = el.querySelector('#tp-subjects input[value="physics"]');
  assert.ok(physCb, '擅长科目复选框仍在（用户「只需选择自己擅长的科目」）');
  const markerEl = document.createElement('span');
  markerEl.dataset.marker = 'unchanged';
  gkEl.appendChild(markerEl);
  physCb.checked = true;
  physCb.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(el.querySelector('#tp-gaokao [data-marker="unchanged"]'), 'F3：勾选科目不触发 gaokao 重渲染（监听器已移除）');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1 F1d3：收集/校验/提交。payload.profile 形状与服务端 handleSaveProfile 契约一致
// （province/grade/gender/subjects/price/method/time_slots JSON 串/gaokao_scores 数组/
// 非学科报价行/credential 回传）；必填校验失败零请求；成功回读刷新。
// 注意：下方 F3_SAVE_PROFILE 是 GET 回读 fixture（:439 注入 profile 响应）——time_slots 为 mapper 出口数组；
// 提交 body 的 time_slots 才是 JSON 串（:455 断言）。
// ─────────────────────────────────────────────────────────────

const F3_SAVE_PROFILE = {
  province: 'shanghai', teaching_method: 'online', grade: 'sophomore', gender: 'female',
  subjects: ['math', 'english'], price_min: 100, price_max: 150,
  time_slots: [{ type: 'week', dow: 1, start: '18:00', end: '20:00' }],
  wechat: 'wx', email: 't@e.com', intro: 'hello', real_name: '王老师', school: '上财',
};

test('F1d3 提交：payload shape 与服务端契约一致 + 成功回读', async () => {
  setup();
  let postBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  el.querySelector('#tp-grad-year').value = '2022';
  await actions.saveProfile();
  assert.ok(postBody, 'POST /api/teacher/profile 已发出');
  const p = postBody.profile;
  assert.equal(p.province, 'shanghai');
  assert.equal(p.grade, 'sophomore');
  assert.equal(p.gender, 'female');
  assert.deepEqual(p.subjects, ['math', 'english']);
  assert.equal(p.price_min, '100', 'price_min = 单值');
  assert.equal(p.price_max, '100', 'price_max = 单值镜像（ZW-1）');
  assert.equal(p.teaching_method, 'online');
  assert.equal(JSON.parse(p.time_slots)[0].dow, 1, 'time_slots JSON 串形状');
  assert.deepEqual(p.gaokao_scores, [], 'gaokao_scores 休眠提交空数组（ZI-1）');
  assert.equal(p.credential_image, '', '空凭证回传空（不误清已有值）');
  // ZR-C1：保存 body 零联系方式字段（变异守护：还原 collect 行必红）
  assert.ok(!('wechat' in p), '保存 body 无 wechat 字段');
  assert.ok(!('email' in p), '保存 body 无 email 字段');
  assert.equal(p.real_name, '王老师');
  assert.equal(p.address, '', '无地址回传空');
  teardown();
});

test('F1d3 必填校验：缺必填（空表单）→ toast + 零 POST', async () => {
  setup();
  let called = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
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
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
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

// ZX-1（2026-08-27，用户：简介静默截断 bug——至少 500 字上限且超限必须 toast）：超限保存
// 必须 toast 拒绝零提交（不静默截断）。变异守护：删 actions.js intro 校验 → POST 发出断言红。

test('ZX-1 简介超限：>500 字 → toast + 零 POST（不静默截断）', async () => {
  setup();
  let called = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { called = true; return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  el.querySelector('#tp-intro').value = 'x'.repeat(501);
  await actions.saveProfile();
  assert.equal(called, false, '简介超限零 POST');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('简介最多 500 字'), '超限 toast 明确提示');
  teardown();
});

test('ZX-1 简介 500 字内：保存成功（上限边界放行）', async () => {
  setup();
  let postBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  el.querySelector('#tp-intro').value = 'x'.repeat(500);
  await actions.saveProfile();
  assert.ok(postBody, '500 字简介 POST 已发出');
  assert.equal(postBody.profile.intro.length, 500, '500 字原样提交');
  teardown();
});

// F1d3 审计 GAP 补齐（独立审计 PASS 后覆盖空洞：GAP-A 凭证回传 / GAP-B 报价必填 /
// GAP-C 回读刷新 / GAP-D 缓存失效——均锁真实行为，删逻辑必红）。

test('F1d3 GAP-A 凭证回传：有存量凭证原样回传（防保存清空）', async () => {
  setup();
  let postBody = null;
  const profile = { ...F3_SAVE_PROFILE, credential_image: 'data:image/png;base64,AAAA' };
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ message: 'ok' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile }) };
  };
  await actions.enterTeacherProfile();
  await actions.saveProfile();
  assert.equal(postBody.profile.credential_image, 'data:image/png;base64,AAAA', '存量凭证原样回传（G2：删回传行必红）');
  teardown();
});

test('F1d3 GAP-B 报价必填：tp-price 空 → toast + 零 POST（ZW-1 区间校验移除后替换）', async () => {
  setup();
  let called = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { called = true; return { ok: true, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  // ZW-1: range validation removed — replaced with single-value required guard (G2: drop required -> red)
  el.querySelector('#tp-price').value = '';
  await actions.saveProfile();
  assert.equal(called, false, '零 POST');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('请完善教师档案必填项'), '报价必填 toast');
  teardown();
});

test('F1d3 GAP-C 成功回读：保存后重拉档案并重渲染', async () => {
  setup();
  let getCount = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    getCount++;
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const before = getCount;
  await actions.saveProfile();
  assert.ok(getCount >= before + 1, '保存后重拉档案（GET 次数增加）');
  assert.ok(dom.window.document.getElementById('teacher-profile-content').querySelector('#teacher-profile-form'), '表单重渲染在位');
  teardown();
});

test('F1d3 GAP-D 缓存失效：保存后 invalidate(teachers) 清公开列表缓存', async () => {
  setup();
  state.allTeachers = [{ user_id: 40 }]; // 预置陈旧缓存（G4：测试后重置）
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') return { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    return { ok: true, status: 200, json: async () => ({ profile: F3_SAVE_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  await actions.saveProfile();
  assert.deepEqual(state.allTeachers, [], '保存后教师列表缓存被清空（F7）');
  state.allTeachers = [];
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1 F1e：核验区块（四态渲染 / chsi 格式预检 / admission 守卫 / 集成）。
// FileReader 在 jsdom 不可用，admission 的 FileReader 路径由代码审查 + F1g 浏览器 QA 覆盖；
// 这里锁四态渲染、chsi 预检（G2：删预检必红）、未选照片守卫、enterTeacherProfile 集成。
// ─────────────────────────────────────────────────────────────

test('F1e 核验四态渲染：none 双通道 / pending 按通道 / approved / rejected 可重提', () => {
  // none → 双通道
  let html = renderTeacherVerifySection(null);
  assert.ok(html.includes(TEXT.VERIF_NONE), 'none 状态 tag');
  assert.ok(html.includes('verify-chsi-pane') && html.includes('verify-admission-pane'), 'none 双通道');
  assert.ok(html.includes(TEXT.ADMISSION_SWITCH_LINK), 'admission 切换链接');
  // pending chsi → 等待文案，无表单
  html = renderTeacherVerifySection({ status: 'pending', verify_type: 'chsi' });
  assert.ok(html.includes(TEXT.VERIF_PENDING) && html.includes(TEXT.CHSI_GATE_PENDING), 'pending chsi 文案');
  assert.ok(!html.includes('verify-chsi-pane'), 'pending 不渲染表单');
  // pending admission → 录取通知书等待文案
  html = renderTeacherVerifySection({ status: 'pending', verify_type: 'admission' });
  assert.ok(html.includes(TEXT.ADMISSION_GATE_PENDING), 'pending admission 文案');
  // approved → 通过 tag + 开放提示，无表单
  html = renderTeacherVerifySection({ status: 'approved' });
  assert.ok(html.includes(TEXT.VERIF_APPROVED), 'approved tag');
  assert.ok(!html.includes('verify-chsi-pane'), 'approved 不渲染表单');
  // rejected → 拒绝 tag + 双通道可重提
  html = renderTeacherVerifySection({ status: 'rejected' });
  assert.ok(html.includes(TEXT.VERIF_REJECTED), 'rejected tag');
  assert.ok(html.includes('verify-chsi-pane'), 'rejected 可重提（双通道）');
  // 契约 6：零内联事件/样式
  assert.ok(!/onclick=/.test(html) && !/style=/.test(html), '零内联事件/样式');
});

test('F1e chsi 提交：空/非法格式 toast + 零 POST；合法 POST {code}', async () => {
  setup();
  let postBody = null;
  globalThis.fetch = async (url, opts) => {
    if ((opts || {}).method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: null }) };
  };
  await actions.enterTeacherProfile();
  // 空验证码
  await actions.submitVerifyChsi();
  let toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('请输入学信网在线验证码'), '空验证码提示');
  assert.equal(postBody, null, '空验证码零 POST');
  // 非法格式（<12 位）
  const codeInput = dom.window.document.getElementById('verify-chsi-code');
  codeInput.value = 'abc';
  await actions.submitVerifyChsi();
  toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('验证码格式不正确'), '非法格式提示');
  assert.equal(postBody, null, '非法格式零 POST');
  // 合法 12 位 → POST {code}
  codeInput.value = 'ABCD12345678';
  await actions.submitVerifyChsi();
  assert.ok(postBody, '合法验证码 POST');
  assert.equal(postBody.code, 'ABCD12345678', 'POST body {code}');
  teardown();
});

test('F1e admission 提交：未选照片 → toast + 零 POST', async () => {
  setup();
  let called = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    if ((opts || {}).method === 'POST') { called = true; return { ok: true, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ profile: null }) };
  };
  await actions.enterTeacherProfile();
  await actions.submitVerifyAdmission();
  assert.equal(called, false, '零 POST');
  const toast = dom.window.document.getElementById('toast-container');
  assert.ok(toast.textContent.includes('录取通知书图片格式不正确'), '未选照片提示（staged 空）');
  teardown();
});

test('F1e 集成：enterTeacherProfile 拉核验状态 + 渲染核验区块（pending）', async () => {
  setup();
  let verifyFetch = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('verify-status')) { verifyFetch = true; return { ok: true, status: 200, json: async () => ({ status: 'pending', verify_type: 'chsi' }) }; }
    return { ok: true, status: 200, json: async () => ({ profile: null }) };
  };
  await actions.enterTeacherProfile();
  assert.ok(verifyFetch, 'verify-status 已拉取');
  const el = dom.window.document.getElementById('teacher-profile-content');
  assert.ok(el.querySelector('#teacher-verify'), '核验区块渲染');
  assert.ok(el.querySelector('#teacher-verify').textContent.includes(TEXT.CHSI_GATE_PENDING), 'pending 文案在位');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// ZH-4（2026-08-26）：认证前置分流——非 approved（none/pending/rejected/拉取失败 null）
// 只渲染认证窗（表单零渲染、不 init），approved 才开放表单；横幅挂载点 #verify-banner-slot 恒在。
test('ZH-4 认证前置：none 态只渲染认证窗 + 横幅挂载点，零表单', async () => {
  setup();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'none' }) };
    return { ok: true, status: 200, json: async () => ({ profile: FULL_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  assert.ok(!el.querySelector('#teacher-profile-form'), 'none 态零表单');
  assert.ok(el.querySelector('#verify-banner-slot'), '横幅挂载点在位');
  assert.ok(el.querySelector('.verify-banner'), 'none 态渲染红色横栏（ZH-5）');
  assert.ok(el.querySelector('.verify-banner').textContent.includes('学信网认证'), '横栏文案 VERIF_BANNER');
  assert.ok(el.querySelector('#teacher-verify'), '认证窗在渲染');
  teardown();
});

test('ZH-4 认证前置：pending / rejected / verify 拉取失败(null) 同属非 approved → 零表单', async () => {
  for (const status of ['pending', 'rejected', null]) {
    setup();
    globalThis.fetch = async (url) => {
      if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => (status ? { status } : { status: 'none' }) };
      return { ok: true, status: 200, json: async () => ({ profile: FULL_PROFILE }) };
    };
    await actions.enterTeacherProfile();
    const el = dom.window.document.getElementById('teacher-profile-content');
    assert.ok(!el.querySelector('#teacher-profile-form'), `${String(status)} 态零表单`);
    assert.ok(el.querySelector('#verify-banner-slot'), `${String(status)} 横幅挂载点在位`);
    teardown();
  }
});

test('ZH-4 认证前置：approved 态开放表单 + 横幅挂载点', async () => {
  setup();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/teacher/verify-status')) return { ok: true, status: 200, json: async () => ({ status: 'approved' }) };
    return { ok: true, status: 200, json: async () => ({ profile: FULL_PROFILE }) };
  };
  await actions.enterTeacherProfile();
  const el = dom.window.document.getElementById('teacher-profile-content');
  assert.ok(el.querySelector('#teacher-profile-form'), 'approved 态开放表单');
  assert.ok(!el.querySelector('.verify-banner'), 'approved 态零红色横栏（ZH-5）');
  assert.ok(el.querySelector('#teacher-verify'), '认证窗仍在（状态展示）');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// ZR-B4（用户①）：教师缩略卡名称接入平台内名称（real_name），未填回落 username。
// ZR-C1/C3（用户②）：联系方式只用于身份核验——表单零输入控件、保存 body 零字段、
// 详情卡零联系方式引用。均为锁定测试：还原输入块/collect 行/渲染引用必红。
// ─────────────────────────────────────────────────────────────

test('ZR-B4 缩略卡名称：real_name 在位显示平台内名称，空/缺失回落 username', () => {
  state.user = null; // non-student view: no match hint / push btn noise
  const withName = renderTeacherCard({ user_id: 1, username: 'login_name_a', real_name: '王老师甲', subjects: [], rating: 5 }, 0);
  assert.ok(withName.includes('王老师甲'), '有 real_name → 显示平台内名称');
  assert.ok(!withName.includes('login_name_a'), 'real_name 在位时用户名不上屏');
  const emptyName = renderTeacherCard({ user_id: 2, username: 'login_name_b', real_name: '', subjects: [], rating: 5 }, 0);
  assert.ok(emptyName.includes('login_name_b'), 'real_name 空串回落 username');
  const missingName = renderTeacherCard({ user_id: 3, username: 'login_name_c', subjects: [], rating: 5 }, 0);
  assert.ok(missingName.includes('login_name_c'), 'real_name 缺失回落 username');
});

test('ZR-C1 表单零联系方式：档案带 wechat/email 值也零控件零回显（变异守护）', () => {
  const html = renderTeacherProfileForm({ wechat: 'wx_secret_val', email: 'mail_secret_val' });
  assert.ok(!html.includes('tp-wechat'), '零微信输入控件（还原输入块必红）');
  assert.ok(!html.includes('tp-email'), '零邮箱输入控件（还原输入块必红）');
  assert.ok(!html.includes('wx_secret_val'), '微信值零回显');
  assert.ok(!html.includes('mail_secret_val'), '邮箱值零回显');
});

test('ZR-C3 详情卡零联系方式引用：wechat/email/credential_image 值与字段名均不上屏', () => {
  const html = renderProfilePanel({
    user_id: 9, username: 't9', real_name: '张老师',
    wechat: 'wx_secret_9', email: 'secret9@example.com',
    credential_image: 'data:image/png;base64,SECRETIMG',
  }, '');
  assert.ok(html.includes('张老师'), '平台内名称正常渲染（对照面）');
  assert.ok(!html.includes('wx_secret_9'), 'wechat 值零渲染');
  assert.ok(!html.includes('secret9@example.com'), 'email 值零渲染');
  assert.ok(!html.includes('SECRETIMG'), 'credential_image 值零渲染');
  assert.ok(!/wechat|credential/i.test(html), '零 wechat/credential 字段引用');
  assert.ok(!html.includes('email'), '零 email 字段引用');
});
