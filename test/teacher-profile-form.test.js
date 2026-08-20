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
