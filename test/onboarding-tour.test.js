/**
 * 新手引导多步走回归（需求三）：引导引擎 + 四份引导脚本完整性 + 主页简化首访浮窗
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 demand-form-2b.test.js）：
 *   - runTour 步进：点击亮区 → 进入下一步（真实点击透传给目标本体）；
 *   - closeModal 步自动关闭当前弹窗；
 *   - 目标未挂载（.hidden 祖先内）rAF 轮询等待后定位；彻底缺失超时自动跳过继续下一步；
 *   - 跳过按钮收尾整个引导；
 *   - startOnboardingTour 按登录态 + 角色选脚本（学生登录后 / 教师访客 / 管理员不引导）；
 *   - studentUser 全流程：我的需求 → 新建需求按钮 → 弹窗自动关闭 → 后续栏目；
 *   - 四份引导脚本完整性：非空、target.page 引用存在的 ROLE_PAGES id、每步有文案、
 *     登录前后末步均为个人信息栏（self）；
 *   - 主页首访浮窗简化文案回归。
 *
 * 沙箱细节：
 *   - jsdom 的 DOMContentLoaded 会在本测试脚本同步加载完毕后异步触发，app-shell 初始化会
 *     showView('landing')（重新隐藏 client 壳）+ 首访弹窗。故 setupClient 先等该事件跑完、
 *     并写 sufe_returning 屏蔽首访弹窗，再 showView('client')。
 *   - 内联 onclick 在 jsdom window 作用域解析函数名：把沙箱函数桥接到 window（真实浏览器
 *     <script> 顶层函数天然挂 window，vm 沙箱与 jsdom window 是两个 realm）。
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

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

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
    console, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  // 桥接内联 onclick 引用的全局函数到 jsdom window
  vm.runInContext(`
    ['showView','renderSidebar','selectPage','ensureAuth','skipTour','startOnboardingTour',
     'openOnboarding','openUsageGuide','closeModal','openDemandModal'].forEach(function (k) {
      if (typeof globalThis[k] === 'function') window[k] = globalThis[k];
    });
  `, ctx);
  const fns = vm.runInContext(`({
    startOnboardingTour, runTour, skipTour, openOnboarding,
    TOUR_SCRIPTS, renderSidebar, selectPage, openModal, closeModal,
  })`, ctx);
  const UI = vm.runInContext('UI', ctx);
  return { dom, ctx, fns, UI };
}

/** 等 jsdom DOMContentLoaded（app-shell 初始化 showView('landing') + 首访弹窗）跑完，再进客户端 */
async function setupClient(ctx, { user = null, guestRole = null, page = null } = {}) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30); // jsdom DOMContentLoaded 是异步任务，先放它跑完（showView('landing') 重藏 client 壳）
  const userStr = user ? JSON.stringify(user) : 'null';
  const guestStr = JSON.stringify(guestRole);
  vm.runInContext(
    `state.user = ${userStr}; state.guestRole = ${guestStr}; renderSidebar(); showView('client');${page ? ` selectPage('${page}');` : ''}`,
    ctx,
  );
}

test('runTour 步进：点亮区 → 进入下一步（真实点击透传给侧边栏 tab）', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  fns.runTour([
    { target: { page: 'browse-teachers' }, text: '第一步' },
    { target: { page: 'about' }, text: '第二步' },
  ]);
  assert.ok(doc.querySelector('.tour-overlay'), '引导层已挂载');
  assert.ok(doc.querySelector('.tour-hole--show'), '亮区就位');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '第一步', '初始为第一步文案');

  doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '第二步', '点击亮区进入下一步');
  assert.ok(doc.querySelector('.tour-hole--show'), '第二步亮区就位（about tab 存在）');
  assert.equal(vm.runInContext('state.page', ctx), 'browse-teachers', '透传点击真实切页');
});

test('closeModal 步：点击亮区自动关闭当前弹窗并进入下一步', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  fns.openModal({ title: '测试弹窗', body: '内容' });
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '弹窗已打开');

  fns.runTour([
    { target: { closeModal: true }, text: '关闭弹窗' },
    { target: { page: 'about' }, text: '之后' },
  ]);
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '关闭弹窗', '亮区在弹窗上');
  doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, '弹窗已自动关闭');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '之后', '进入下一步');
});

test('目标未挂载：.hidden 祖先内等待 rAF 定位；彻底缺失超时自动跳过继续', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });

  // 案例一：目标在 .hidden 祖先内 → 轮询等待，移除 hidden 后定位（目标点击无害）
  fns.runTour([
    { target: { sel: '#profile-page-title' }, text: '等待目标' },
    { target: { page: 'about' }, text: '之后' },
  ]);
  assert.equal(doc.querySelector('.tour-hole--show'), null, 'edit-profile 未展开，亮区暂不定位');
  vm.runInContext(`document.querySelector('.client-page[data-page="edit-profile"]').classList.remove('hidden');`, ctx);
  await tick();
  assert.ok(doc.querySelector('.tour-hole--show'), '目标出现后亮区定位');
  doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '之后', '点击后进入下一步');

  // 案例二：目标不存在 → 超时自动跳过继续下一步
  vm.runInContext(`APP_CONSTANTS.CONFIG.TOUR_TARGET_TIMEOUT_MS = 80;`, ctx);
  fns.runTour([
    { target: { sel: '#definitely-not-here' }, text: '缺失目标' },
    { target: { page: 'about' }, text: '跳过之后' },
  ]);
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '缺失目标');
  await tick(240); // rAF 轮询 + 80ms 超时
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '跳过之后', '超时自动跳过继续下一步');
});

test('跳过按钮：收尾整个引导（拆除蒙层与气泡）', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  fns.runTour([
    { target: { page: 'browse-teachers' }, text: '第一步' },
    { target: { page: 'about' }, text: '第二步' },
  ]);
  assert.ok(doc.querySelector('.tour-overlay'), '引导运行中');
  doc.querySelector('.tour-skip-btn').click();
  assert.equal(doc.querySelector('.tour-overlay'), null, '跳过即收尾');
  assert.equal(doc.querySelector('.tour-bubble-pos'), null, '气泡一并拆除');
});

test('startOnboardingTour：按登录态 + 角色选脚本（学生登录后 / 教师访客 / 管理员不引导）', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;

  // 学生登录后 → studentUser 首步 = 我的需求
  await setupClient(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_MY_DEMANDS, '学生登录后走 studentUser');
  doc.querySelector('.tour-skip-btn').click();

  // 教师访客 → teacherGuest 首步 = 需求大厅
  await setupClient(ctx, { guestRole: 'teacher' });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_BROWSE_DEMANDS, '教师访客走 teacherGuest');
  doc.querySelector('.tour-skip-btn').click();

  // 管理员不引导
  await setupClient(ctx, { user: { role: 'admin', id: 9, username: 'a', avatar: '' } });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-overlay'), null, '管理员不引导');
});

test('studentUser 全流程：我的需求 → 新建需求按钮 → 弹窗自动关闭 → 后续栏目', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' }, page: 'my-demands' });

  fns.runTour('studentUser');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_MY_DEMANDS, '第 1 步：我的需求');

  doc.querySelector('.tour-hole').click(); // 透传切到我的需求
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_NEW_DEMAND_BTN, '第 2 步：新建需求按钮');
  assert.ok(doc.getElementById('btn-new-demand'), '新建需求按钮存在');

  doc.querySelector('.tour-hole').click(); // 透传打开表单
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_NEW_DEMAND_MODAL, '第 3 步：表单弹窗');
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '弹窗已打开');

  doc.querySelector('.tour-hole').click(); // closeModal + next
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, '弹窗自动关闭');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_BROWSE_TEACHERS, '第 4 步：教师广场');
});

test('teacherUser 全流程：需求大厅 → … → 编辑资料页签 → .profile-form 表单步 → 通知 → … → 个人信息栏末步', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { user: { role: 'teacher', id: 1, username: 't', avatar: '' }, page: 'my-chats' });
  fns.runTour('teacherUser');

  const steps = fns.TOUR_SCRIPTS.teacherUser();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, steps[0].text, '第 1 步');
  // 走到 edit-profile（第 6 步，index 5）——每步点击亮区透传真实切页
  for (let i = 0; i < 5; i++) doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, steps[5].text, '第 6 步：编辑资料页签');
  doc.querySelector('.tour-hole').click(); // 切到 edit-profile 页
  assert.equal(vm.runInContext('state.page', ctx), 'edit-profile', '透传切到编辑资料');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, steps[6].text, '第 7 步：.profile-form 表单步');
  await tick(60);
  const hole = doc.querySelector('.tour-hole');
  assert.ok(hole.classList.contains('tour-hole--show'), '.profile-form 步亮区就位（表单已渲染）');
  assert.ok(doc.querySelector('.profile-form'), '.profile-form 存在于编辑页');
  // 继续走完：通知 → 设置 → 关于 → 个人信息栏末步（含末步收尾，共需点满 steps.length 次）
  for (let i = 7; i <= steps.length; i++) doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('.tour-overlay'), null, '末步后蒙层拆除（收尾）');
});

test('四份引导脚本完整性：非空、page id 存在、每步有文案、sel/closeModal 步结构合法、登录前后末步为个人信息栏', () => {
  const { ctx, fns } = makeCtx();
  const pageIds = vm.runInContext(`Object.values(ROLE_PAGES).flat().map(p => p.id)`, ctx);
  const scripts = {
    teacherGuest: fns.TOUR_SCRIPTS.teacherGuest(),
    studentGuest: fns.TOUR_SCRIPTS.studentGuest(),
    teacherUser: fns.TOUR_SCRIPTS.teacherUser(),
    studentUser: fns.TOUR_SCRIPTS.studentUser(),
  };
  for (const [name, steps] of Object.entries(scripts)) {
    assert.ok(steps.length > 0, `${name} 非空`);
    steps.forEach((s, i) => {
      assert.ok(s.text && s.text.length > 0, `${name} 第 ${i + 1} 步有文案`);
      const t = s.target || {};
      if (t.page) assert.ok(pageIds.includes(t.page), `${name} 第 ${i + 1} 步引用存在的 page id: ${t.page}`);
      if (t.sel) assert.ok(typeof t.sel === 'string' && /^[.#]/.test(t.sel), `${name} 第 ${i + 1} 步 sel 为合法选择器: ${t.sel}`);
    });
  }
  assert.equal(scripts.teacherGuest[scripts.teacherGuest.length - 1].target.self, true, '教师登录前末步去登录');
  assert.equal(scripts.studentGuest[scripts.studentGuest.length - 1].target.self, true, '学生登录前末步去登录');
  assert.equal(scripts.teacherUser[scripts.teacherUser.length - 1].target.self, true, '教师登录后末步个人信息栏');
  assert.equal(scripts.studentUser[scripts.studentUser.length - 1].target.self, true, '学生登录后末步个人信息栏');
  // 静态 sel 选择器出现在 index.html（防笔误：'#btn-new-demand' / '.profile-form'）
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes('id="btn-new-demand"'), '新建需求按钮 id 在位');
  assert.ok(html.includes('profile-form'), 'profile-form 类在位');
});

test('主页首访浮窗简化：ONBOARD_POLICY 精简且聚焦基本流程', () => {
  const { dom, fns, UI } = makeCtx();
  const doc = dom.window.document;
  assert.ok(UI.ONBOARD_POLICY.length <= 4, `简化后首访策略条目 ≤4（当前 ${UI.ONBOARD_POLICY.length}）`);
  fns.openOnboarding();
  const bodyText = doc.querySelector('#modal-container .modal-body').textContent;
  assert.ok(bodyText.includes('学生：发布需求'), '简化文案含学生基本流程');
  assert.ok(bodyText.includes('教师：浏览需求'), '简化文案含教师基本流程');
  assert.ok(bodyText.includes('我的会话'), '简化文案提到站内沟通/签约');
});
