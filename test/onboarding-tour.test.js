/**
 * 新手引导多步走回归（需求三重构版）：引导引擎 + 五份引导脚本完整性与深度 + 主页简化首访浮窗
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 demand-form-2b.test.js）：
 *   - runTour 步进：点击亮区 → 进入下一步（真实点击透传给目标本体）；
 *   - closeModal 步自动关闭当前弹窗（亮区指向弹窗本体 .modal，不再指向全屏 overlay —— 修复背景灰化消失 bug）；
 *   - 目标未挂载（.hidden 祖先内）rAF 轮询等待后定位；彻底缺失超时自动跳过继续下一步；
 *   - 右上角全局「跳过引导」按钮：引导全程常亮，点击整个引导收尾（跳过按钮新机制）；
 *   - 气泡内不再有「跳过」按钮（连根删）；
 *   - 每脚本每模块交互步数 ≥3（硬性要求：深度引导，探进模块真实转一圈）；
 *   - 全脚本 walk-through：逐脚本点亮区走完整流程，验证每步 target 的 page/sel 都存在且可解析；
 *   - startOnboardingTour 按登录态 + 角色选脚本（学生登录后 / 教师访客 / 管理员不引导）；
 *   - 「重温新手引导」入口迁移：侧边栏 .sidebar-revisit-btn 连根删，仅「关于平台」页保留；
 *   - 主页首访浮窗简化文案回归。
 *
 * 沙箱细节：
 *   - jsdom 的 DOMContentLoaded 会在本测试脚本同步加载完毕后异步触发，app-shell 初始化会
 *     showView('landing')（重新隐藏 client 壳）+ 首访弹窗。故 setupClient 先等该事件跑完、
 *     并写 sufe_returning 屏蔽首访弹窗，再 showView('client')。
 *   - 内联 onclick 在 jsdom window 作用域解析函数名：把沙箱函数桥接到 window（真实浏览器
 *     <script> 顶层函数天然挂 window，vm 沙箱与 jsdom window 是两个 realm）。
 *   - 多模块列表（教师/需求/会话/合同/通知/帖子）数据依赖 API：makeCtx 的 fetch 按 endpoint
 *     回灌 API_DATA，使各模块列表真实渲染出卡片/条目，从而完整校验每步 target 选择器存在。
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

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// 各模块列表数据（使卡片/条目真实渲染，供每步 target 存在性校验）
const teacher = {
  user_id: 3, username: '张老师', avatar: '',
  province: 'shanghai', school: '示例大学', grade: 'freshman', gender: 'female',
  subjects: ['math'], gaokao_scores: [], price_min: 100, price_max: 200,
  teaching_method: 'online', time_slots: [], rating: 4.5, verified: 0,
  intro: '认真负责，耐心细致',
};
const demand = {
  id: 1, display_id: 1, user_id: 2, username: '学生小李', avatar: '',
  province: 'shanghai', student_grade: 'grade10', student_gender: '',
  target_type: 'academic', target_subjects: ['math'], teaching_method: 'offline',
  budget_min: 100, budget_max: 150, expected_time: [], current_scores: [],
  address: '', additional_info: '', status: 'open', my_intent_status: '',
  created_at: '2026-08-01T00:00:00Z', intent_count: 0, pending_intents: 0,
  submitter_type: 'student',
};
const conv = {
  id: 1, student_user_id: 9, student_name: '学生小李', teacher_user_id: 3, teacher_name: '张老师',
  last_body: '你好，请问周末有空吗', last_kind: 'text', last_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z', unread_count: 0, status: 'active',
};
const msg = { id: 1, sender_user_id: 9, kind: 'text', body: '你好', created_at: '2026-08-01T00:00:00Z' };
const contract = {
  id: 1, student_user_id: 9, student_name: '学生小李', teacher_user_id: 3, teacher_name: '张老师',
  drafter_user_id: 3, status: 'signing', method: 'online', hourly_rate: 120,
  demand_display_id: 1, contract_md: '', prev_business: '', updated_at: '2026-08-01T00:00:00Z',
};
const notif = { id: 1, text: '有新的试课意向，请及时处理', is_read: 0, created_at: '2026-08-01T00:00:00Z' };
const post = { id: 1, title: '高中数学笔记', body_md: '分享一份函数专题笔记', username: '张老师', user_id: 3, like_count: 2, liked: false, created_at: '2026-08-01T00:00:00Z' };

const API_DATA = {
  '/api/teachers': { teachers: [teacher] },
  '/api/users/3': { user: { id: 3, username: '张老师', role: 'teacher', avatar: '' } },
  '/api/reviews?teacherUserId=3': { reviews: [] },
  '/api/teacher/profile?userId=3': { profile: {} },
  '/api/student/demands?scope=mine': { demands: [demand] },
  '/api/student/demands?scope=for-teacher': { demands: [demand] },
  '/api/student/demands': { demands: [demand] },
  '/api/demand-pushes': { pushes: [] },
  '/api/demands/1/intents': { teachers: [] },
  '/api/conversations': { conversations: [conv] },
  '/api/conversations/1/messages': { messages: [msg] },
  '/api/contracts/my': { contracts: [contract] },
  '/api/notifications': { notifications: [notif] },
  '/api/posts?sort=new': { posts: [post] },
  '/api/data-version': { versions: {} },
};

function makeCtx(apiData = API_DATA) {
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
    console,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => apiData[url] ?? {} }),
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
  // 桥接内联 onclick 引用的全局函数到 jsdom window（真实浏览器 <script> 顶层函数天然挂 window；
  // 引导 walk-through 会真实点击多种内联 handler，故把 vm 全局函数全量桥接——除注入的运行期依赖）。
  // 排除注入 globals（它们已有正确绑定，覆盖会改变 jsdom 行为，如 window.setTimeout 换成 node 版）。
  vm.runInContext(`
    var _INJECTED = ['window','document','getComputedStyle','localStorage','sessionStorage','console',
      'fetch','setTimeout','clearTimeout','setInterval','clearInterval','Request','AbortController',
      'performance','MutationObserver','Image','requestAnimationFrame','cancelAnimationFrame','matchMedia'];
    Object.keys(globalThis).forEach(function (k) {
      if (_INJECTED.indexOf(k) !== -1) return;
      if (typeof globalThis[k] === 'function' && typeof window[k] !== 'function') {
        try { window[k] = globalThis[k]; } catch (e) {}
      }
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
  await tick(30); // 放默认页数据加载（loadInto）落定，避免首步目标与数据竞态
}

function waitFor(fn, timeoutMs = 9000) {
  const start = Date.now();
  return new Promise(resolve => {
    const poll = () => {
      if (fn()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(poll, 15);
    };
    poll();
  });
}

/** 按模块统计某脚本的交互步数（末步 self 不计入模块） */
function moduleCounts(steps) {
  const counts = {};
  for (const s of steps) {
    if (!s.module || s.module === 'end') continue;
    counts[s.module] = (counts[s.module] || 0) + 1;
  }
  return counts;
}

/** 逐脚本 walk-through：点亮区走完每一步，断言气泡文案 + 亮区就位（= target 可解析、sel 存在） */
async function walkScript(ctx, fns, dom, scriptName) {
  const steps = fns.TOUR_SCRIPTS[scriptName]();
  const doc = dom.window.document;
  fns.runTour(scriptName);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const ok = await waitFor(() => {
      const b = doc.querySelector('.tour-bubble-text');
      return b && b.textContent === step.text && doc.querySelector('.tour-hole--show');
    });
    assert.ok(ok, `${scriptName} 第 ${i + 1}/${steps.length} 步亮区就位（${step.module}：${step.text.slice(0, 18)}…）`);
    const hole = doc.querySelector('.tour-hole');
    hole.click();
    await tick(20);
  }
  assert.equal(doc.querySelector('.tour-overlay'), null, `${scriptName} 末步后蒙层拆除`);
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
  assert.ok(doc.querySelector('.tour-global-skip'), '全局「跳过引导」按钮常亮');
  assert.ok(!doc.querySelector('.tour-skip-btn'), '气泡内无「跳过」按钮（已连根删）');

  doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '第二步', '点击亮区进入下一步');
  assert.ok(doc.querySelector('.tour-hole--show'), '第二步亮区就位（about tab 存在）');
  assert.equal(vm.runInContext('state.page', ctx), 'browse-teachers', '透传点击真实切页');
});

test('closeModal 步：亮区指向弹窗本体 .modal（修复背景灰化消失）并自动关闭', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  fns.openModal({ title: '测试弹窗', body: '内容' });
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '弹窗已打开');

  fns.runTour([
    { target: { closeModal: true }, text: '关闭弹窗' },
    { target: { page: 'about' }, text: '之后' },
  ]);
  // 修复点：closeModal 步的亮区必须落在弹窗本体上（.modal 非全屏 overlay），
  // 否则亮区=整个视口 → box-shadow 压暗被推出屏幕外 → 背景灰化消失
  assert.equal(vm.runInContext('_tourResolve({ target: { closeModal: true } }) !== null', ctx), true, 'closeModal 解析到弹窗本体');
  assert.ok(doc.querySelector('.tour-hole--show'), '亮区在弹窗上');
  doc.querySelector('.tour-hole').click();
  assert.equal(doc.querySelector('#modal-container .modal-overlay'), null, '弹窗已自动关闭');
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, '之后', '进入下一步');
});

test('目标未挂载：.hidden 祖先内等待 rAF 定位；彻底缺失超时自动跳过继续', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });

  // 案例一：目标在 .hidden 祖先内 → 轮询等待，移除 hidden 后定位
  fns.runTour([
    { target: { sel: '#profile-page-title' }, text: '等待目标' },
    { target: { page: 'about' }, text: '之后' },
  ]);
  assert.equal(doc.querySelector('.tour-hole--show'), null, 'edit-profile 未展开，亮区暂不定位');
  vm.runInContext(`document.querySelector('.client-page[data-page="edit-profile"]').classList.remove('hidden');`, ctx);
  await tick(60);
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

test('全局「跳过引导」按钮：全程常亮，点击即收尾整个引导', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  fns.runTour([
    { target: { page: 'browse-teachers' }, text: '第一步' },
    { target: { page: 'about' }, text: '第二步' },
  ]);
  assert.ok(doc.querySelector('.tour-overlay'), '引导运行中');
  const skipBtn = doc.querySelector('.tour-global-skip');
  assert.ok(skipBtn, '全局跳过按钮在引导全程存在');
  assert.equal(skipBtn.textContent, UI.TOUR_SKIP_GLOBAL, '按钮文案单源');
  doc.querySelector('.tour-global-skip').click();
  assert.equal(doc.querySelector('.tour-overlay'), null, '点全局跳过即收尾');
  assert.equal(doc.querySelector('.tour-bubble-pos'), null, '气泡一并拆除');
});

test('startOnboardingTour：按登录态 + 角色选脚本（学生登录后 / 教师访客 / 管理员不引导）', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;

  // 学生登录后 → studentUser 首步 = 我的需求
  await setupClient(ctx, { user: { role: 'student', id: 9, username: 's', avatar: '' } });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_MY_DEMANDS, '学生登录后走 studentUser');
  doc.querySelector('.tour-global-skip').click();

  // 教师访客 → teacherGuest 首步 = 需求大厅
  await setupClient(ctx, { guestRole: 'teacher' });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-bubble-text').textContent, UI.TOUR_STEP_BROWSE_DEMANDS, '教师访客走 teacherGuest');
  doc.querySelector('.tour-global-skip').click();

  // 管理员不引导
  await setupClient(ctx, { user: { role: 'admin', id: 9, username: 'a', avatar: '' } });
  fns.startOnboardingTour();
  assert.equal(doc.querySelector('.tour-overlay'), null, '管理员不引导');
});

test('「重温新手引导」入口迁移：侧边栏连根删，仅「关于平台」页保留', async () => {
  const { dom, ctx, fns, UI } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { user: { role: 'student', id: 9, username: 's', avatar: '' } });
  assert.equal(doc.querySelector('.sidebar-revisit-btn'), null, '侧边栏个人信息栏无重温按钮');
  assert.equal(doc.querySelector('.tour-revisit-btn'), null, '无任何残留重温按钮类');
  // 关于页内容区仍保留入口（app-pages enterAbout 渲染）
  vm.runInContext(`selectPage('about');`, ctx);
  await tick(60);
  const revisitBtns = [...doc.querySelectorAll('#about-content button')]
    .filter(b => b.textContent.includes(UI.ONBOARD_REVISIT_BTN));
  assert.ok(revisitBtns.length === 1, `关于页内容区恰有 1 个重温新手引导入口（实际 ${revisitBtns.length}）`);
});

test('每脚本每模块交互步数 ≥3（深度引导硬性要求）', () => {
  const { ctx, fns } = makeCtx();
  const expected = {
    teacherGuest: ['browse-demands', 'browse-teachers', 'resource-share', 'about'],
    studentGuest: ['browse-teachers', 'about'],
    teacherUser: ['browse-demands', 'browse-teachers', 'resource-share', 'my-chats', 'my-contracts', 'edit-profile', 'notifications', 'account-settings', 'about'],
    studentUser: ['my-demands', 'browse-teachers', 'my-chats', 'my-contracts', 'notifications', 'account-settings', 'about'],
  };
  for (const [name, modules] of Object.entries(expected)) {
    const steps = fns.TOUR_SCRIPTS[name]();
    const counts = moduleCounts(steps);
    for (const m of modules) {
      assert.ok(counts[m] >= 3, `${name} 模块 ${m} 交互步数 ${counts[m] || 0} ≥3（实际 ${counts[m] || 0}）`);
    }
    // 该脚本不存在的模块不应出现
    for (const m of Object.keys(counts)) {
      assert.ok(modules.includes(m), `${name} 不应出现模块 ${m}`);
    }
  }
});

test('脚本完整性：非空、target 形状合法、page id 存在于 ROLE_PAGES、末步为个人信息栏', () => {
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
      assert.ok(s.module, `${name} 第 ${i + 1} 步带模块标记`);
      const t = s.target || {};
      const shape = Object.keys(t).length === 1 && (t.page || t.sel || t.closeModal === true || t.self === true);
      assert.ok(shape, `${name} 第 ${i + 1} 步 target 形状合法`);
      if (t.page) assert.ok(pageIds.includes(t.page), `${name} 第 ${i + 1} 步引用存在的 page id: ${t.page}`);
      if (t.sel) assert.ok(typeof t.sel === 'string' && /^[.#]/.test(t.sel), `${name} 第 ${i + 1} 步 sel 为合法选择器: ${t.sel}`);
    });
  }
  assert.equal(scripts.teacherGuest[scripts.teacherGuest.length - 1].target.self, true, '教师登录前末步去登录');
  assert.equal(scripts.studentGuest[scripts.studentGuest.length - 1].target.self, true, '学生登录前末步去登录');
  assert.equal(scripts.teacherUser[scripts.teacherUser.length - 1].target.self, true, '教师登录后末步个人信息栏');
  assert.equal(scripts.studentUser[scripts.studentUser.length - 1].target.self, true, '学生登录后末步个人信息栏');
});

// —— 四份脚本 walk-through：逐步点亮区，完整校验每步 target 的 page/sel 在真实 DOM 中可解析 ——
test('teacherGuest 全流程 walk-through：需求大厅 → 教师同行 → 资料共享 → 关于 → 末步登录', async () => {
  const { dom, ctx, fns } = makeCtx();
  await setupClient(ctx, { guestRole: 'teacher' });
  await walkScript(ctx, fns, dom, 'teacherGuest');
});

test('studentGuest 全流程 walk-through：教师广场 → 关于 → 末步登录', async () => {
  const { dom, ctx, fns } = makeCtx();
  await setupClient(ctx, { guestRole: 'student' });
  await walkScript(ctx, fns, dom, 'studentGuest');
});

test('teacherUser 全流程 walk-through：全部模块逐个深入 + 末步个人信息栏', async () => {
  const { dom, ctx, fns } = makeCtx();
  await setupClient(ctx, { user: { role: 'teacher', id: 3, username: 't', avatar: '' } });
  await walkScript(ctx, fns, dom, 'teacherUser');
});

test('studentUser 全流程 walk-through：我的需求 → 教师广场 → 其余模块 + 末步个人信息栏', async () => {
  const { dom, ctx, fns } = makeCtx();
  await setupClient(ctx, { user: { role: 'student', id: 9, username: 's', avatar: '' } });
  await walkScript(ctx, fns, dom, 'studentUser');
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

// ============ v0.25.38 引导架构升级：点击拦截 + 整卡亮区 + 功能栏介绍 + 滚动/动画稳定化 ============

/** 教师导向需求大厅（渲染出「提交试课意向」按钮） */
async function setupTeacherDemands(ctx) {
  vm.runInContext(`
    state.user = { id: 3, role: 'teacher', username: '张老师' };
    renderSidebar(); showView('client'); selectPage('browse-demands');
  `, ctx);
  await tick(60);
}

test('点击拦截（pass:false）：提交试课意向/屏蔽系统通知不透传真实请求', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'teacher' });
  await setupTeacherDemands(ctx);
  // 打桩真实请求入口（vm 全局 + jsdom window 双桥，覆盖内联 onclick 路径）
  vm.runInContext(`
    window.__intentCalls = 0; window.__notifBlockCalls = 0;
    submitIntent = function () { window.__intentCalls++; };
    toggleNotifBlock = function () { window.__notifBlockCalls++; };
    try { window.submitIntent = submitIntent; window.toggleNotifBlock = toggleNotifBlock; } catch (e) {}
  `, ctx);
  // 意向步骤（pass:false）：点亮区推进，但真实按钮不被点击
  fns.runTour([
    { module: 'x', target: { sel: '#demands-list .btn-intent-cta' }, text: '试课意向', pass: false },
    { module: 'x', target: { page: 'about' }, text: '之后' },
  ]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(vm.runInContext('window.__intentCalls', ctx), 0, 'pass:false 不触发 submitIntent');
  // 对照：透传步骤仍真实点击（打开/切换页面类保留）
  doc.querySelector('.tour-hole').click(); // about tab
  await tick(20);
  assert.equal(vm.runInContext('state.page', ctx), 'about', '透传步骤仍真实切页');
});

test('点击拦截：屏蔽系统通知步骤（pass:false）不透传开关', async () => {
  const { dom, ctx, fns } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { user: { role: 'teacher', id: 3, username: 't', avatar: '' } });
  vm.runInContext(`
    selectPage('notifications');
  `, ctx);
  await tick(60);
  vm.runInContext(`
    window.__notifBlockCalls = 0;
    toggleNotifBlock = function () { window.__notifBlockCalls++; };
    try { window.toggleNotifBlock = toggleNotifBlock; } catch (e) {}
  `, ctx);
  fns.runTour([
    { module: 'notifications', target: { sel: '#btn-notif-block' }, text: '屏蔽通知', pass: false },
    { module: 'notifications', target: { page: 'about' }, text: '之后' },
  ]);
  await waitFor(() => doc.querySelector('.tour-hole--show'));
  doc.querySelector('.tour-hole').click();
  await tick(20);
  assert.equal(vm.runInContext('window.__notifBlockCalls', ctx), 0, '屏蔽系统通知不透传（真实偏好开关）');
});

test('教师名字步骤：target 为整卡（可点性移交整卡），亮区覆盖整卡', async () => {
  const { ctx, fns, UI } = makeCtx();
  const step = fns.TOUR_SCRIPTS.teacherGuest().find(s => s.text === UI.TOUR_STEP_TEACHER_USERNAME);
  assert.ok(step, '教师名字步骤存在');
  assert.equal(step.target.sel, '#teachers-list .list-card--teacher', '亮区指整卡而非用户名文本');
  // 解析结果确为整卡元素（先渲染教师列表页）
  await setupClient(ctx, { guestRole: 'student' });
  vm.runInContext(`selectPage('browse-teachers');`, ctx);
  await tick(80);
  const resolved = vm.runInContext(`(() => { const el = _tourResolve(${JSON.stringify(step)}); return el ? el.className : null; })()`, ctx);
  assert.ok(resolved && String(resolved).includes('list-card--teacher'), '解析到整卡元素（实际: ' + resolved + '）');
});

test('会话 + 号功能栏：四个项目逐一聚焦介绍（pass:false 不透传）', async () => {
  const { ctx, fns, UI } = makeCtx();
  const steps = fns.TOUR_SCRIPTS.teacherUser();
  const idx = steps.findIndex(s => s.text === UI.TOUR_STEP_CHAT_PLUS);
  assert.ok(idx >= 0, '存在 + 号步骤');
  const items = steps.slice(idx + 1, idx + 5);
  assert.equal(items.length, 4, '+ 号后接四个功能栏项目步骤');
  const texts = [UI.TOUR_STEP_CHAT_PLUS_IMAGE, UI.TOUR_STEP_CHAT_PLUS_FILE, UI.TOUR_STEP_CHAT_PLUS_SIGNING, UI.TOUR_STEP_CHAT_PLUS_DRAFT];
  items.forEach((s, i) => {
    assert.equal(s.text, texts[i], `第 ${i + 1} 项文案`);
    assert.equal(s.pass, false, '功能栏项目不透传（真实点击开弹窗/文件选择器）');
    assert.equal(s.target.sel, `.chat-plus-pop .chat-pop-item:nth-child(${i + 1})`, '选择器指向第 N 个项目');
  });
});

test('滚动架构：视口外目标自动滚入再定位；已可见目标不滚（jsdom 打桩验证）', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    window.__scrolled = 0;
    window.Element.prototype.scrollIntoView = function () { window.__scrolled++; };
  `, ctx);
  // 视口外目标 → 滚入（__scrolled +1）
  vm.runInContext(`
    const t1 = document.createElement('div'); t1.id = 'scroll-far';
    Object.defineProperty(t1, 'getBoundingClientRect', { value: () => ({ top: 3000, left: 0, bottom: 3100, right: 120, width: 120, height: 100 }) });
    document.body.appendChild(t1);
  `, ctx);
  vm.runInContext('_tourScrollToEl(document.getElementById("scroll-far"))', ctx);
  assert.equal(vm.runInContext('window.__scrolled', ctx), 1, '视口外目标被滚入');
  // 已完全可见目标 → 不滚（侧栏/常驻元素天然命中，防无谓跳页）
  vm.runInContext(`
    const t2 = document.createElement('div'); t2.id = 'scroll-near';
    Object.defineProperty(t2, 'getBoundingClientRect', { value: () => ({ top: 10, left: 10, bottom: 100, right: 200, width: 190, height: 90 }) });
    document.body.appendChild(t2);
  `, ctx);
  vm.runInContext('_tourScrollToEl(document.getElementById("scroll-near"))', ctx);
  assert.equal(vm.runInContext('window.__scrolled', ctx), 1, '已可见目标不重复滚动');
});

test('动画稳定化：目标祖先链动画运行中 → 延迟到动画结束才定位亮区（修卡屏幕外）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setupClient(ctx, { guestRole: 'student' });
  // 打桩：目标自身 getAnimations 首查运行中、之后空 → 亮区应先隐藏、rAF 后再定位
  vm.runInContext(`
    window.__animQueries = 0;
    const t = document.createElement('div'); t.id = 'anim-target';
    t.getAnimations = function () { window.__animQueries++; return window.__animQueries === 1 ? [{ playState: 'running' }] : []; };
    Object.defineProperty(t, 'getBoundingClientRect', { value: () => ({ top: 20, left: 20, bottom: 80, right: 200, width: 180, height: 60 }) });
    document.body.appendChild(t);
  `, ctx);
  vm.runInContext('runTour([{ module: "x", target: { sel: "#anim-target" }, text: "动画目标" }])', ctx);
  assert.equal(vm.runInContext('window.__animQueries', ctx), 1, '首次检查检测到动画（进入等待）');
  assert.equal(doc.querySelector('.tour-hole--show'), null, '动画运行中：亮区不定位（避免中间帧几何卡屏幕外）');
  await tick(60); // rAF 后再查：动画结束 → 定位
  assert.ok(doc.querySelector('.tour-hole--show'), '动画结束后亮区定位');
});

// 需求五十三（v0.25.61）：遮罩常置 + 亮区延时——overlay 恒压暗底（步骤间/目标等待不再闪回亮屏）、
// 亮区延迟淡入、气泡随亮区延迟入场、reduced-motion 归零延迟
test('需求五十三：遮罩常置 + 亮区延时（CSS 在位）', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('.tour-overlay {') && css.includes('rgba(17, 17, 20, .28)'),
    'overlay 常置压暗底（遮罩全程恒在）');
  assert.ok(css.includes('transition: opacity .26s ease-out .16s'),
    '亮区延迟淡入（洞 opacity transition）');
  assert.ok(css.includes('animation-delay: .18s') && css.includes('animation-fill-mode: backwards'),
    '气泡随亮区延迟入场');
  assert.ok(css.includes('.tour-hole { transition-delay: 0s; }'),
    'reduced-motion 归零亮区延迟');
});
