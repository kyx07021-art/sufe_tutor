/**
 * 需求六·前端表现试验 单测（node:vm 模拟浏览器经典脚本全局）
 *
 * 覆盖：
 *   - item5 UI 大小滑块纯逻辑：uiScaleClamp 钳制 [80,100]/非数回默认；getUiScale 读 localStorage；
 *     setUiScale 写 localStorage + 应用 --ui-scale CSS 变量；uiScaleFillPct 填充百分比（80→0%、100→100%）。
 *   - item1/2 教师资料卡分组渲染：renderProfileInfoCard 输出四组大 title 且顺序正确、
 *     评分行顶置、个人简介挪入「基本资料」组、分组内条目顺序、条目行无分隔线相关类；
 *   - item3 私密资料项两行式：真实姓名/学信网截图锁定态显「建立会话后展示」灰字提示，
 *     联系方式锁定态显「签约后展示联系方式」灰字提示（.profile-row-note）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
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
    }),
    dom,
  };
}

// 共享脚本加载序（同 index.html）：constants → region-data → app-display → app-state → app-api →
// app-datahub → app-anim → app-ui → app-style → app-demands → app-teachers（app-teachers 依赖 match 系列）
const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-demands.js', 'app-teachers.js'];
function loadCommon(ctx) {
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
}

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// ---- item5 UI 大小滑块纯逻辑 ----
test('uiScaleClamp：按 CONFIG 上下限钳制、非数/超界回默认（v0.25.12 上限 120）', () => {
  const { ctx } = makeCtx(); loadCommon(ctx);
  const min = vm.runInContext('CONFIG.UI_SCALE_MIN', ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  const def = vm.runInContext('CONFIG.UI_SCALE_DEFAULT', ctx);
  assert.equal(vm.runInContext('uiScaleClamp(90)', ctx), 90);
  assert.equal(vm.runInContext(`uiScaleClamp(${min - 10})`, ctx), min, `低于下限钳到 ${min}`);
  assert.equal(vm.runInContext(`uiScaleClamp(${max + 10})`, ctx), max, `高于上限钳到 ${max}`);
  assert.equal(vm.runInContext(`uiScaleClamp(${max})`, ctx), max, `上限 ${max} 本身合法`);
  assert.equal(vm.runInContext('uiScaleClamp("abc")', ctx), def, '非数字回默认');
  assert.equal(vm.runInContext('uiScaleClamp(85.6)', ctx), 86, '四舍五入整数');
});

test('getUiScale：localStorage 现值；无值回默认；非法值钳制', () => {
  const { ctx } = makeCtx(); loadCommon(ctx);
  const def = vm.runInContext('CONFIG.UI_SCALE_DEFAULT', ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  assert.equal(vm.runInContext('getUiScale()', ctx), def, '未存 → 默认');
  vm.runInContext("localStorage.setItem('sufe_ui_scale', '85')", ctx);
  assert.equal(vm.runInContext('getUiScale()', ctx), 85, '读现值 85');
  vm.runInContext("localStorage.setItem('sufe_ui_scale', '999')", ctx);
  assert.equal(vm.runInContext('getUiScale()', ctx), max, `非法 999 钳到上限 ${max}`);
});

test('setUiScale：写 localStorage + 应用 --ui-scale 系数，返回钳制值', () => {
  const { ctx, dom } = makeCtx(); loadCommon(ctx);
  const min = vm.runInContext('CONFIG.UI_SCALE_MIN', ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  const ret = vm.runInContext(`setUiScale(${min})`, ctx);
  assert.equal(ret, min);
  assert.equal(vm.runInContext("localStorage.getItem('sufe_ui_scale')", ctx), String(min));
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (min / 100).toFixed(3));
  const ret2 = vm.runInContext(`setUiScale(${max + 5})`, ctx);
  assert.equal(ret2, max, `超界钳到上限 ${max}`);
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (max / 100).toFixed(3));
});

test('uiScaleFillPct：min→0%、max→100%、中点→50%', () => {
  const { ctx } = makeCtx(); loadCommon(ctx);
  const min = vm.runInContext('CONFIG.UI_SCALE_MIN', ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  const mid = Math.round((min + max) / 2);
  assert.equal(vm.runInContext(`uiScaleFillPct(${min})`, ctx), '0.0');
  assert.equal(vm.runInContext(`uiScaleFillPct(${max})`, ctx), '100.0');
  assert.equal(vm.runInContext(`uiScaleFillPct(${mid})`, ctx), '50.0');
});

// ---- item1/2/3 教师资料卡分组渲染 ----
function seedProfileFixtures(ctx) {
  vm.runInContext(`
    state.user = { id: 999, role: 'student' };
    const PROF_T = { user_id: 1, rating: 4.5, province: 'shanghai', school: '上海财经大学',
      grade: 'freshman', gender: 'male', address: '上海市杨浦区', teaching_method: 'online',
      time_slots: [{ type: 'week', dow: 1, start: '18:00', end: '20:00' }],
      personality_tags: ['patience'], intro: '认真负责', subjects: ['math'],
      graduation_year: 2020, gaokao_scores: [{ subject: 'math', score: 135 }],
      price_min: 150, price_max: 180,
      nonacademic_projects: ['music'], nonacademic_prices: [{ project: 'music', price_min: 100, price_max: 120 }],
      real_name: '', credential_image: '', wechat: '', email: '', matched: false };
    window.PROF_T = PROF_T;
    window.PROF_HTML = renderProfileInfoCard(PROF_T, false);
  `, ctx);
}

test('资料卡渲染：四组大 title 顺序正确 + 评分行顶置 + 简介在基本资料组', () => {
  const { ctx } = makeCtx(); loadCommon(ctx); seedProfileFixtures(ctx);
  const html = vm.runInContext('window.PROF_HTML', ctx);
  const gTitles = ['基本资料', '学科类资料', '非学科类资料', '私密资料'];
  const idx = gTitles.map(t => html.indexOf(t));
  assert.ok(idx.every(i => i !== -1), '四个分组 title 都在');
  assert.ok(idx[0] < idx[1] && idx[1] < idx[2] && idx[2] < idx[3], '分组 title 按 基本→学科→非学科→私密 顺序');
  // 评分行顶置（在第一个分组 title 之前）
  assert.ok(html.indexOf('评分') < idx[0], '评分行在「基本资料」title 之前');
  // 个人简介挪入基本资料组：简介行出现在「学科类资料」title 之前
  assert.ok(html.indexOf('简介') < idx[1], '个人简介在「学科类资料」之前（已挪上边）');
  // 分组内条目顺序：地区在年级前、年级在学校前（按需求六 item2 列序）
  assert.ok(html.indexOf('地区') < html.indexOf('年级') && html.indexOf('年级') < html.indexOf('学校'), '基本资料条目顺序 地区→年级→学校');
});

test('资料卡渲染：私密资料项两行式灰字提示（item3）', () => {
  const { ctx } = makeCtx(); loadCommon(ctx); seedProfileFixtures(ctx);
  const html = vm.runInContext('window.PROF_HTML', ctx);
  // 锁定态（未匹配/未签约）→ 灰字提示 profile-row-note
  assert.ok(html.includes('profile-row-note'), '存在 .profile-row-note 两行式提示');
  assert.ok(html.includes('建立会话后展示'), '真实姓名/学信网截图锁定态提示「建立会话后展示」');
  assert.ok(html.includes('签约后展示联系方式'), '联系方式锁定态提示「签约后展示联系方式」');
  // 私密组三行都在「私密资料」title 之后
  const privIdx = html.indexOf('私密资料');
  ['真实姓名', '学信网截图', '联系方式'].forEach(l => {
    assert.ok(html.indexOf(l) > privIdx, `${l} 属于私密资料组`);
  });
});

test('资料卡渲染：条目无分隔线类、解锁态联系方式显示值+灰字提示', () => {
  const { ctx } = makeCtx(); loadCommon(ctx); seedProfileFixtures(ctx);
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher' };  // 本人视角 → 联系方式解锁
    window.PROF_T.wechat = 'wx_abc';
    window.PROF_T.matched = true;
    window.PROF_HTML2 = renderProfileInfoCard(window.PROF_T, false);
  `, ctx);
  const html = vm.runInContext('window.PROF_HTML2', ctx);
  // M2：联系方式改多行——子标题「微信」+ 值「wx_abc」分列（不再「微信：wx_abc · …」单行）
  assert.ok(html.includes('wx_abc'), '解锁态显示联系方式实际值');
  assert.ok(html.includes(vm.runInContext('UI.LABEL_WECHAT', ctx)), '微信子标题存在（科目式多行）');
  assert.ok(html.includes('签约后展示联系方式'), '值下方仍带灰字提示（两行式）');
  const rowCount = (html.match(/class="profile-row"/g) || []).length;
  assert.ok(rowCount > 0, '资料行以 .profile-row 渲染');
  // 去分隔线验证：JS 渲染层不再输出任何分隔线相关类/token
  assert.ok(!html.includes('g-line-row'), '渲染不引用 g-line-row 分隔线 token');
});

// ---- item5 设置页滑块集成（渲染 + 拖动实时生效 + 持久化） ----
const FILES_WITH_PAGES = [...FILES, 'app-pages.js'];
function seedSettingsPage(ctx) {
  vm.runInContext(`
    loadDeviceSessions = () => {};  // 桩掉异步拉设备（本测试只验滑块）
    const el = document.createElement('div'); el.id = 'account-settings-content';
    document.body.appendChild(el);
    state.user = { id: 1, username: 'u', role: 'teacher', avatar: '' };
    enterAccountSettings();
    window.SLIDER = document.querySelector('.ui-scale-slider');
    window.SLIDER_ROW = document.querySelector('.ui-scale-row');
  `, ctx);
}

test('设置页滑块：渲染 min/max/现值；拖动实时更新 --ui-scale、数值标签与 localStorage', async () => {
  const { ctx, dom } = makeCtx();
  for (const f of FILES_WITH_PAGES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  seedSettingsPage(ctx);
  const sliderMin = vm.runInContext('CONFIG.UI_SCALE_MIN', ctx);
  const sliderMax = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  assert.equal(vm.runInContext('window.SLIDER.min', ctx), String(sliderMin), '滑块下限 = CONFIG.UI_SCALE_MIN');
  assert.equal(vm.runInContext('window.SLIDER.max', ctx), String(sliderMax), '滑块上限 = CONFIG.UI_SCALE_MAX（v0.25.12 为 120）');
  assert.equal(vm.runInContext('window.SLIDER.step', ctx), '1', '步进 1（级差最小）');
  assert.equal(vm.runInContext('window.SLIDER.value', ctx), '100', '默认现值 100');
  assert.ok(vm.runInContext('!!window.SLIDER_ROW', ctx), '滑块行独立类 .ui-scale-row 存在（防作用域污染）');
  // 拖到上限 120：拖动走 setUiScaleLive——v0.25.110 二次返工改真实 reflow 预览：
  // 拖动期直接应用 --ui-scale（页边四边不动、组件真实重排：侧栏贴左/内容贴右），rAF 合并每帧一次；
  // 不再做 html transform 整页缩放（transform 必动页边——center 四边齐动/top-left 右下沉，
  // 用户两次返工拒绝，见 app-state.js 注释）。
  vm.runInContext(`window.SLIDER.value = '${sliderMax}'; setUiScaleFromSlider(window.SLIDER);`, ctx);
  const htmlEl = () => dom.window.document.documentElement;
  assert.equal(htmlEl().style.getPropertyValue('--ui-scale'), '', '拖动合并到 rAF：pending 未消费前 --ui-scale 未应用');
  assert.equal(htmlEl().style.transform, '', '无 transform 整页缩放残留（预览走 reflow 非缩放）');
  // 等 rAF 帧消费 → 真实 --ui-scale 应用（reflow 预览，不落盘）
  await tick(30);
  assert.equal(htmlEl().style.getPropertyValue('--ui-scale'), (sliderMax / 100).toFixed(3), 'rAF 帧后 --ui-scale 真实应用（reflow 预览）');
  assert.equal(htmlEl().style.transform, '', 'reflow 预览不做 html transform 缩放');
  // 松手 commit：落盘 + 确认 --ui-scale（无 transform 需清除）
  vm.runInContext(`window.SLIDER.value = '85'; commitUiScaleFromSlider(window.SLIDER);`, ctx);
  assert.equal(htmlEl().style.transform, '', '无 transform 残留');
  assert.equal(htmlEl().style.getPropertyValue('--ui-scale'), '0.850', 'commit 后 --ui-scale 同步');
  assert.equal(vm.runInContext("document.getElementById('ui-scale-val').textContent", ctx), '85%', '数值标签更新');
  assert.equal(vm.runInContext("localStorage.getItem('sufe_ui_scale')", ctx), '85', '松手后 localStorage 持久化');
  // 刷新等价：getUiScale 从 localStorage 读回 85
  assert.equal(vm.runInContext('getUiScale()', ctx), 85, '刷新后按 localStorage 现值应用');
});

// ---- v0.25.103 B1：UI 大小条拖动正反馈根治（pointer 差分拖动） ----
// 旧实现 oninput="setUiScaleFromSlider(this)" 由浏览器原生 range 拖动驱动——预览的
// html transform:scale 缩放滑块轨道，浏览器按缩放后轨道解析 value → scale 变 → 轨道几何变
// → value 变 → 正反馈鬼畜。新实现 pointerdown/move 差分（固定初始 clientWidth，不受
// transform 影响），value 只由差分驱动，鼠标静止即稳定。
test('B1 滑块：HTML 不再绑 oninput/onchange（拖动路径不依赖浏览器原生解析）', () => {
  const { ctx } = makeCtx();
  for (const f of FILES_WITH_PAGES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  seedSettingsPage(ctx);
  assert.equal(vm.runInContext('window.SLIDER.getAttribute("oninput")', ctx), null, '滑块无 oninput 属性（正反馈引擎移除）');
  assert.equal(vm.runInContext('window.SLIDER.getAttribute("onchange")', ctx), null, '滑块无 onchange 属性');
  assert.equal(vm.runInContext('!!document.getElementById("ui-scale-slider")', ctx), true, '滑块带稳定 id（bind 定位）');
});

test('B1 滑块：pointer 差分拖动——value 按固定初始几何差分，缩放后同位置稳定（无正反馈）', async () => {
  const { ctx, dom } = makeCtx();
  for (const f of FILES_WITH_PAGES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  seedSettingsPage(ctx);
  const min = vm.runInContext('CONFIG.UI_SCALE_MIN', ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  const span = max - min;
  // jsdom 无排版 → mock 轨道 layout 宽 200px（真实里 clientWidth 不受 html transform 影响）
  vm.runInContext(`Object.defineProperty(window.SLIDER, 'clientWidth', { value: 200, configurable: true });`, ctx);
  const fire = (type, x) => vm.runInContext(`
    (function(){
      var Ctor = (typeof window.PointerEvent !== 'undefined') ? window.PointerEvent : window.MouseEvent;
      var ev = new Ctor('${type}', { clientX: ${x}, pointerId: 1, bubbles: true, cancelable: true, button: 0 });
      window.SLIDER.dispatchEvent(ev);
    })();
  `, ctx);
  // 初始 100，pointerdown 在 100px，拖动到 150px → 差分 +50/200*span
  vm.runInContext("window.SLIDER.value = '100'", ctx);
  fire('pointerdown', 100);
  fire('pointermove', 150);
  const expect150 = 100 + Math.round(50 / 200 * span);
  assert.equal(vm.runInContext('window.SLIDER.value', ctx), String(expect150), `差分 50px → ${expect150}（初始几何映射）`);
  await tick(30); // rAF 消费 → 真实 reflow 预览应用（--ui-scale 生效，页面重排：四边不动、组件 reflow）
  assert.equal(dom.window.document.documentElement.style.transform, '', '预览走 reflow 无 html transform 缩放');
  assert.notEqual(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), '', '拖动中 --ui-scale 真实应用（页面重排预览）');
  // 核心正反馈判据：缩放生效后再发「同位置」move → value 必须不变（差分基于 startX，与缩放后几何无关）
  const before = vm.runInContext('window.SLIDER.value', ctx);
  fire('pointermove', 150);
  assert.equal(vm.runInContext('window.SLIDER.value', ctx), before, '缩放后同位置 move → value 稳定（无正反馈漂移）');
  fire('pointermove', 155);
  const expect155 = 100 + Math.round(55 / 200 * span);
  assert.equal(vm.runInContext('window.SLIDER.value', ctx), String(expect155), `继续差分 55px → ${expect155}`);
  // 松手 commit：落盘 + 落真排版 + 清预览
  fire('pointerup', 155);
  const finalVal = vm.runInContext('window.SLIDER.value', ctx);
  assert.equal(vm.runInContext("document.getElementById('ui-scale-val').textContent", ctx), finalVal + '%', '数值标签同步');
  assert.equal(dom.window.document.documentElement.style.transform, '', 'pointerup 后预览 transform 清除（commit 落真排版）');
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (Number(finalVal) / 100).toFixed(3), 'commit 落真 --ui-scale');
  assert.equal(vm.runInContext("localStorage.getItem('sufe_ui_scale')", ctx), finalVal, '松手持久化');
});

test('B1 滑块：input/change 事件兜底仍走预览/落盘（键盘与无障碍路径）', async () => {
  const { ctx, dom } = makeCtx();
  for (const f of FILES_WITH_PAGES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  seedSettingsPage(ctx);
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  // input（键盘改值）→ 真实 --ui-scale 预览（rAF），不落盘
  vm.runInContext(`window.SLIDER.value = '${max}'; window.SLIDER.dispatchEvent(new window.Event('input', { bubbles: true }));`, ctx);
  await tick(30);
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (max / 100).toFixed(3), 'input 兜底：真实 reflow 预览应用');
  assert.equal(dom.window.document.documentElement.style.transform, '', 'input 兜底：无 transform 整页缩放');
  // change（键盘松键/辅助）→ commit 落盘落真排版
  vm.runInContext(`window.SLIDER.value = '85'; window.SLIDER.dispatchEvent(new window.Event('change', { bubbles: true }));`, ctx);
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), '0.850', 'change 兜底：落真 --ui-scale');
  assert.equal(vm.runInContext("localStorage.getItem('sufe_ui_scale')", ctx), '85', 'change 兜底：持久化');
});

// #156（v0.25.64）：资料项行距压半 + PC资料卡加宽 + 表单去横线压紧（CSS+常量在位）
test('#156 资料紧凑化：行距压半 / PC资料卡加宽 / 表单压紧', () => {
  const css = readFileSync('./style.css', 'utf8');
  const constants = readFileSync('./constants.js', 'utf8');
  assert.ok(constants.includes('PROFILE_ROW_GAP: 11'), '资料卡条目行距压半（22→11）');
  assert.ok(css.includes('min(max(330px, 30vw), 460px)'), 'PC 资料卡加宽（30vw，460px 上限）');
  assert.ok(css.includes('align-items: flex-start; padding: 8px 0;'), '编辑表单组行距压紧（15→8px）');
  assert.ok(css.includes('margin: 14px 0 8px;'), '组标题行距压紧（22→14px）');
});

// ---- v0.25.103 M1：ctrl/cmd + 滚轮任意位置调整 UI 大小（复用 --ui-scale 体系） ----
test('M1 ctrl+滚轮调 UI 大小：上滚放大/下滚缩小/普通滚轮不触发/钳制上限', async () => {
  const { ctx, dom } = makeCtx(); loadCommon(ctx);
  const doc = dom.window.document;
  const fire = (ctrl, deltaY) => {
    const Ctor = typeof dom.window.MouseEvent !== 'undefined' ? dom.window.MouseEvent : dom.window.Event;
    const ev = new Ctor('wheel', { ctrlKey: ctrl, metaKey: false, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'deltaY', { value: deltaY });
    doc.dispatchEvent(ev);
  };
  const uiScale = () => doc.documentElement.style.getPropertyValue('--ui-scale');
  const stored = () => vm.runInContext("localStorage.getItem('sufe_ui_scale')", ctx);
  vm.runInContext("localStorage.setItem('sufe_ui_scale', '100')", ctx);
  // 上滚（deltaY<0）放大 +UI_SCALE_WHEEL_STEP（U5：4×滑块 step，用户实证一格太小拖沓）
  const step = vm.runInContext('CONFIG.UI_SCALE_WHEEL_STEP', ctx);
  fire(true, -100); await tick(30);
  assert.equal(uiScale(), (1 + step / 100).toFixed(3), `上滚放大 +${step}%`);
  assert.equal(stored(), String(100 + step), '落盘');
  // 下滚（deltaY>0）缩小回 100
  fire(true, 100); await tick(30);
  assert.equal(uiScale(), '1.000', '下滚缩小回 100');
  // 普通滚轮（无 ctrl）不触发缩放
  fire(false, -100); await tick(30);
  assert.equal(uiScale(), '1.000', '无 ctrl 不缩放（正常滚动保留）');
  // 连续上滚钳制到上限
  const max = vm.runInContext('CONFIG.UI_SCALE_MAX', ctx);
  for (let i = 0; i < 60; i++) fire(true, -100);
  await tick(30);
  assert.equal(Number(stored()), max, `连续上滚钳到上限 ${max}`);
});
