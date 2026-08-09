/**
 * 需求四·4b 回归：屏蔽系统通知按钮重做（item5）+ 设置页两区颠倒（item8）+ 侧边栏模块 i 信息按钮（item9）
 *
 * 在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 onboarding-tour.test.js）：
 *   - 通知页右上角标准按钮：默认全显；点按隐藏广播通知并持久化 localStorage；
 *     再点恢复；屏蔽后全为广播 → 空态；
 *   - 进通知页按持久化偏好自动应用过滤并同步按钮态；
 *   - 侧边栏每个模块渲染「i」信息按钮，点击打开标准信息浮窗（内容来自 constants UI.MODULE_INFO）；
 *   - 设置页两区颠倒：账户信息在上、外观在下；
 *   - 会话列表「会话」title 专属类在位。
 *
 * 沙箱细节同 onboarding-tour.test.js：内联 onclick 在 jsdom window 作用域解析函数名，
 * 需把沙箱函数桥接到 window（toggleNotifBlock / openModuleInfo / enterNotifications 等）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeCtx({ notifRows = [], demandRows = [], failRead = false } = {}) {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  const fetched = []; // #151：记录 fetch 调用（断言「进入不再批量全读 / 点击上报单条」）
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console,
    fetch: async (url, opts = {}) => {
      const u = String(url);
      fetched.push({ u, method: (opts && opts.method) || 'GET' });
      if (/\/api\/notifications\/\d+\/read$/.test(u) && failRead) return { ok: false, status: 500, json: async () => ({ error: 'server down' }) };
      if (u === '/api/notifications') return { ok: true, status: 200, json: async () => ({ notifications: notifRows }) };
      if (u.includes('/api/student/demands')) return { ok: true, status: 200, json: async () => ({ demands: demandRows }) };
      if (/\/api\/demands\/\d+\/intents$/.test(u)) return { ok: true, status: 200, json: async () => ({ teachers: [{ user_id: 38, username: 'kkkk', rating: 4, avatar: '', province: 'guangdong', price_min: 150, price_max: 150, intent_status: 'accepted', intent_id: 5 }] }) };
      return { ok: true, status: 200, json: async () => ({}) }; // 已读上报 / 会话 / 设备会话等一律空对象
    },
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
  // 桥接内联 onclick 引用的全局函数到 jsdom window（vm 沙箱与 jsdom window 是两个 realm）
  vm.runInContext(`
    ['showView','renderSidebar','selectPage','ensureAuth','toggleNotifBlock','openModuleInfo',
     'enterNotifications','enterAccountSettings','enterMyChats','closeModal','toggleDemandIntents',
     'markNotifRead'].forEach(function (k) {
      if (typeof globalThis[k] === 'function') window[k] = globalThis[k];
    });
  `, ctx);
  const UI = vm.runInContext('UI', ctx);
  return { dom, ctx, UI, fetched };
}

/** 等 jsdom DOMContentLoaded 跑完，再进客户端（sufe_returning 屏蔽首访浮窗） */
async function setup(ctx, { user = null, guestRole = null } = {}) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30);
  const userStr = user ? JSON.stringify(user) : 'null';
  const guestStr = JSON.stringify(guestRole);
  vm.runInContext(`state.user = ${userStr}; state.guestRole = ${guestStr}; renderSidebar(); showView('client');`, ctx);
}

const BROADCAST = '【系统通知】';
const rows = [
  { id: 1, text: `${BROADCAST}维护公告\n今晚维护`, is_read: 1, created_at: '2026-08-08 10:00:00' },
  { id: 2, text: '关于「数学」的需求，学生已选择其他老师', is_read: 0, created_at: '2026-08-08 09:00:00' },
  { id: 3, text: `${BROADCAST}新版本上线`, is_read: 0, created_at: '2026-08-08 08:00:00' },
  { id: 4, text: '你的意向已被学生同意', is_read: 0, created_at: '2026-08-08 07:00:00' },
];

test('item5 屏蔽系统通知按钮：默认全显，点按隐藏广播并持久化，再点恢复', async () => {
  const { dom, ctx } = makeCtx({ notifRows: rows });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 4, '默认展示全部 4 条');
  const btn = doc.getElementById('btn-notif-block');
  assert.ok(btn, '屏蔽按钮在位');
  assert.equal(btn.textContent, '屏蔽系统通知', '默认文案');
  assert.equal(btn.classList.contains('notif-block-btn--on'), false, '默认未选中');

  btn.click(); // 屏蔽
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '屏蔽后只显非广播 2 条');
  assert.equal(btn.textContent, '已屏蔽系统通知', '选中文案');
  assert.equal(btn.classList.contains('notif-block-btn--on'), true, '选中态类');
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_block_broadcast')`, ctx), '1', '偏好持久化');

  btn.click(); // 恢复
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 4, '恢复后全显');
  assert.equal(btn.textContent, '屏蔽系统通知', '恢复文案');
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_block_broadcast')`, ctx), '0', '偏好已清除');
});

test('item5 屏蔽后全为广播 → 空态文案（NOTIF_FILTER_EMPTY）', async () => {
  const { dom, ctx, UI } = makeCtx({ notifRows: [
    { id: 1, text: `${BROADCAST}维护公告`, is_read: 1, created_at: '2026-08-08 10:00:00' },
    { id: 2, text: `${BROADCAST}新版本上线`, is_read: 1, created_at: '2026-08-08 08:00:00' },
  ] });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '未屏蔽时 2 条广播都显示');
  doc.getElementById('btn-notif-block').click();
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 0, '屏蔽后广播全隐');
  assert.ok(doc.getElementById('notifications-content').textContent.includes(UI.NOTIF_FILTER_EMPTY), '显示空态文案');
});

test('item5 进通知页按 localStorage 偏好应用过滤并同步按钮态（跨会话持久化）', async () => {
  const { dom, ctx } = makeCtx({ notifRows: rows });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  vm.runInContext(`localStorage.setItem('sufe_block_broadcast', '1')`, ctx);
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '屏蔽偏好进页只显非广播');
  assert.equal(doc.getElementById('btn-notif-block').textContent, '已屏蔽系统通知', '按钮为选中态');
});

test('页面顶部 title 旁「i」信息按钮：selectPage 注入、幂等、点击打开浮窗（文案单源 constants）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  // 用户反馈（2026-08-08）：i 按钮位置是「页面内顶上 title 的旁边」，侧边栏内已删——selectPage 按当前页注入页头
  await vm.runInContext(`selectPage('my-demands')`, ctx);
  const info = doc.querySelector('#client-main .client-page:not(.hidden) .page-header .page-header-info');
  assert.ok(info, '页头 title 旁 i 按钮已注入');
  assert.equal(doc.querySelectorAll('.page-header-info').length, 1, '切页后幂等，只一个 i 按钮');
  assert.equal(doc.querySelectorAll('.sidebar-item-info').length, 0, '侧边栏内 i 按钮已连根删');
  info.click();
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '信息浮窗打开');
  assert.equal(doc.querySelector('#modal-container .modal-header h2').textContent, '我的需求', '浮窗标题 = 模块名');
  const bodyText = doc.querySelector('#modal-container .modal-body').textContent;
  assert.ok(bodyText.length > 50, '结构化介绍内容可观');
  // v0.25.12（反馈 #95）：介绍是 Markdown 渲染（## 小标题 + 段落），正文文本不含 '## ' 语法
  assert.ok(bodyText.includes('这是什么'), '渲染出 Markdown 小标题（这是什么）');
  assert.ok(!bodyText.includes('## '), 'Markdown 语法已解析，不残留原文标记');
  const infoText = vm.runInContext(`UI.MODULE_INFO['my-demands']`, ctx);
  assert.ok(infoText.startsWith('## '), 'constants 源文案为结构化 Markdown');
  // 所有模块都有介绍文案（防漏配；跨 realm 数组用 length 断言避免原型不匹配）
  const missing = vm.runInContext(
    `Object.values(ROLE_PAGES).flat().filter(p => !UI.MODULE_INFO[p.id]).map(p => p.id)`, ctx);
  assert.equal(missing.length, 0, `每个 ROLE_PAGES 模块都配了介绍文案（缺失：${missing.join(',') || '无'}）`);
});

test('item9 会话列表「会话」title 专属类在位（放大后的标题）', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'my-chats'; enterMyChats()`, ctx);
  const title = doc.querySelector('.chats-list-title');
  assert.ok(title, '会话 title 元素在位');
  assert.equal(title.textContent, '会话', '文案 = UI.CHAT_TITLE');
});

test('item6 意向行结构：用户名+星级包 intent-row-user、状态 tag 独立（移动端 CSS 据此纵向排布）', async () => {
  const { dom, ctx } = makeCtx({ demandRows: [{
    id: 7, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
    target_subjects: ['math'], current_scores: [], teaching_method: 'offline', address: '杨浦区',
    province: 'shanghai', budget_min: 0, budget_max: 0, status: 'open', display_id: 7,
    intent_locked: 0, my_intent_status: '', avatar: '', created_at: '2026-08-07 04:27:09',
    pending_intents: 1, intent_count: 1,
  }] });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'my-demands'; loadMyDemands()`, ctx);
  await tick(60);
  const toggle = doc.getElementById('intent-toggle-7');
  assert.ok(toggle, '意向开关在位');
  toggle.click();
  await tick(60);
  const line = doc.querySelector('.intent-row-line');
  assert.ok(line, '意向行带 intent-row-line 专属类');
  assert.ok(line.querySelector('.intent-row-user strong'), '用户名在 intent-row-user 内');
  assert.ok(line.querySelector('.intent-row-user .stars') || line.querySelector('.intent-row-user b'), '星级在 intent-row-user 内');
  const tag = line.querySelector('.tag');
  assert.ok(tag, '状态 tag 在位');
  assert.equal(tag.textContent, '已同意', 'mock 意向为 accepted → 已同意');
  assert.equal(line.lastElementChild, tag, 'tag 是意向行末子元素（独立成行，置用户名下方）');
});

test('item8 设置页两区颠倒：账户信息在上、外观在下', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'account-settings'; enterAccountSettings()`, ctx);
  const titles = [...doc.querySelectorAll('.settings-section-title')].map(e => e.textContent);
  assert.deepEqual(titles, ['账户信息', '外观设置', '隐私设置'], '账户区在前、外观区在后、隐私区收尾（#163 新增）');
  // 主题选中态刷新依赖元素 id 而非顺序，确认主题选项仍渲染
  assert.equal(doc.querySelectorAll('.theme-opt').length, 3, '外观主题三项仍在');
  assert.equal(doc.querySelectorAll('.settings-row').length >= 4, true, '账户行（头像/用户名/角色/电话/邮箱）在位');
});

// #151（v0.25.59）：未读提醒由左红竖线改为整卡呼吸遮罩；点击/键盘消除——单条标记已读
test('#151 未读项渲染呼吸遮罩与点击消除入口；已读项无交互', async () => {
  const { dom, ctx } = makeCtx({ notifRows: rows });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  const unread = doc.querySelectorAll('.notif-item.unread');
  assert.equal(unread.length, 3, '3 条未读项带 unread 类（呼吸遮罩）');
  const first = unread[0];
  assert.ok(first.getAttribute('data-id'), '未读项带 data-id 供 markNotifRead 定位');
  assert.ok((first.getAttribute('onclick') || '').includes('markNotifRead('), '未读项可点击消除');
  assert.equal(first.getAttribute('role'), 'button', '未读项键盘可达');
  assert.equal(first.querySelector('.notif-dot').classList.contains('read'), false, '未读红点保留');
  const readItem = doc.querySelector('.notif-item:not(.unread)');
  assert.ok(readItem, '有已读项');
  assert.equal(readItem.getAttribute('onclick'), null, '已读项无点击消除入口');
});

test('#151 点击未读项 → 单条已读上报 + 遮罩/红点就地消除', async () => {
  const { dom, ctx, fetched } = makeCtx({ notifRows: rows });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  const reads = fetched.filter(f => f.u.startsWith('/api/notifications/') && f.u.endsWith('/read'));
  assert.equal(reads.length, 0, '进入通知页不再批量全读上报');
  const target = doc.querySelector('.notif-item.unread');
  const id = target.getAttribute('data-id');
  target.click();
  await tick(); await tick(); // 等异步 API 回包
  assert.ok(fetched.some(f => f.u === `/api/notifications/${id}/read` && f.method === 'POST'), '点击上报单条已读');
  assert.equal(target.classList.contains('unread'), false, '遮罩就地消除');
  assert.equal(target.querySelector('.notif-dot').classList.contains('read'), true, '红点消除');
  assert.equal(target.getAttribute('onclick'), null, '已读后交互属性移除');
});

test('#151 呼吸遮罩样式在位（style.css 含 keyframes 与 .unread::after，左竖线已删）', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('@keyframes notif-breathe'), '呼吸遮罩关键帧在位');
  assert.ok(css.includes('.notif-item.unread::after'), '未读遮罩伪元素规则在位');
  assert.ok(!css.includes('.notif-item.unread { --g-surface: inset 3px 0 0 var(--danger);'),
    '左侧红竖线提醒已删（#151 取代）');
});

test('#151 单条已读上报失败 → 回滚：遮罩与点击入口恢复（可重试）', async () => {
  const { dom, ctx } = makeCtx({ notifRows: rows, failRead: true });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  const target = doc.querySelector('.notif-item.unread');
  target.click();
  await tick(); await tick(); // 等失败回包
  assert.equal(target.classList.contains('unread'), true, '失败回滚：遮罩恢复');
  assert.equal(target.querySelector('.notif-dot').classList.contains('read'), false, '红点恢复');
  assert.ok((target.getAttribute('onclick') || '').includes('markNotifRead('), '失败回滚：点击入口恢复可重试');
});

// 2026-08-09 反馈三项：呼吸加速 + 竖线连根删 + 离开通知页批量已读（看过即消）
test('反馈-呼吸加速：notif-breathe 时长 1.4s（原 2.4s 太慢）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const m = css.match(/animation: notif-breathe ([0-9.]+)s/);
  assert.ok(m, '呼吸动画时长在位');
  assert.equal(Number(m[1]), 1.4, '时长加快到 1.4s');
});

test('反馈-竖线连根删：.about-funds 与 .funds-note 不再带 border-left 强调', () => {
  const css = readFileSync('./style.css', 'utf8');
  for (const cls of ['.about-funds', '.funds-note']) {
    const rule = css.split(cls + ' {')[1] || '';
    const block = '{' + rule.split('}')[0] + '}';
    assert.ok(!block.includes('border-left'), `${cls} 左竖线已删（无强调）`);
  }
});

test('反馈-离开通知页批量已读：看过即消，POST /api/notifications/read-all + 本地全翻', async () => {
  // 字面新建 fixture：早期 #151 点击测试会就地 mutate 共享 rows 对象（fetch 回同一引用），复用必被污染
  const freshRows = [
    { id: 11, text: `${BROADCAST}维护公告`, is_read: 1, created_at: '2026-08-08 10:00:00' },
    { id: 12, text: '需求被选走', is_read: 0, created_at: '2026-08-08 09:00:00' },
    { id: 13, text: `${BROADCAST}新版本上线`, is_read: 0, created_at: '2026-08-08 08:00:00' },
    { id: 14, text: '意向已同意', is_read: 0, created_at: '2026-08-08 07:00:00' },
  ];
  const { dom, ctx, fetched } = makeCtx({ notifRows: freshRows });
  const doc = dom.window.document;
  await setup(ctx, { user: { role: 'student', id: 1, username: 's', avatar: '' } });
  await vm.runInContext(`state.page = 'notifications'; enterNotifications()`, ctx);
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item.unread').length, 3, '进页未读呼吸仍展示（不自动全读）');
  assert.ok(!fetched.some(f => f.u === '/api/notifications/read-all'), '进页不发批量已读');
  // 切到设置页 → 触发批量已读
  await vm.runInContext(`selectPage('account-settings')`, ctx);
  await tick(); await tick();
  assert.ok(fetched.some(f => f.u === '/api/notifications/read-all' && f.method === 'POST'), '离开通知页发批量已读');
  assert.equal(doc.querySelectorAll('.notif-item.unread').length, 0, '遮罩就地消除');
  const allRead = vm.runInContext(`_notifList.every(n => n.is_read)`, ctx);
  assert.equal(allRead, true, '本地 _notifList 全翻已读');
});
