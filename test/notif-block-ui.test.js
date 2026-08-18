/**
 * D-1 notif feature + v2 shell 回归（原 vm 沙箱测试转直接 import ESM）：
 *   - 屏蔽系统通知按钮：默认全显 / 点按隐藏广播并持久化 / 再点恢复 / 全广播空态 / 进页按偏好过滤
 *   - 模块 i 信息按钮：selectPage 注入、幂等、点击开 md 浮窗、所有注册模块都有介绍文案
 *   - 会话列表「会话」title 专属类在位（shell 静态提供）
 *   - 意向行结构（学生自己需求卡走 loadMyDemands，editable 契约）
 *   - 设置页两区颠倒（账户/外观/隐私顺序）
 *   - #151 未读项呼吸遮罩 + 点击/键盘单条已读 + 失败回滚 + 离开通知页批量已读
 *   - 屏蔽系统通知：广播未读不计入侧边栏红点（refreshBadges 同过滤口径）
 *   - shell 完整性（审计 F1/F2/F3 回归）：注册页容器全覆盖 + 落地页入口 + 筛选折叠默认态
 *   - CSS 断言（style.css：呼吸动画 0.9s + 中间关键帧 + 竖线连根删）保持文件直读
 *
 * 清理纪律：feature onLoad 的 installed 标志是模块级单例——测试中途断言失败会跳过 uninstall，
 * 后续测试的 onLoad 变 no-op（委托静默失效）。因此每个用 enterNotifPage 的测试都必须挂
 * t.after 清理（断言失败也执行），杜绝「installed 卡死」级联。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests, stopVersionProbe } from '../src/client/core/datahub.js';
import { setEnsureAuth } from '../src/client/core/api.js';
import { closeAllModals } from '../src/client/core/ui-modal.js';
import { mountShell } from '../src/client/core/shell.js';
import { renderSidebar, selectPage, refreshBadges, stopBadgePoll, pagesForRole } from '../src/client/core/router.js';
import { CONFIG } from '../src/shared/config.js';
import { TEXT } from '../src/client/constants/text.js';
import { enterNotifications, _notifList } from '../src/client/features/notif/actions.js';
import notifFeature from '../src/client/features/notif/index.js';
import studentFeature from '../src/client/features/student/index.js';
import { loadMyDemands } from '../src/client/features/student/actions.js';
import { enterAccountSettings } from '../src/client/features/settings/actions.js';
import settingsFeature from '../src/client/features/settings/index.js';
import teacherFeature from '../src/client/features/teacher/index.js';
import chatFeature from '../src/client/features/chat/index.js';
import contractFeature from '../src/client/features/contract/index.js';
import postsFeature from '../src/client/features/posts/index.js';
import adminFeature from '../src/client/features/admin/index.js';
import complaintsFeature from '../src/client/features/complaints/index.js';
import { STYLE_CSS } from './_css.js';

class MOStub { observe() {} disconnect() {} takeRecords() { return []; } }

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const BROADCAST = '【系统通知】';
const USER = { role: 'student', id: 1, username: 's', avatar: '' };

/** 全量 feature onLoad（router registerPage 填充），返回卸载函数 */
function installAll() {
  return [notifFeature, studentFeature, settingsFeature, teacherFeature, chatFeature,
    contractFeature, postsFeature, adminFeature, complaintsFeature]
    .map(f => (f && typeof f.onLoad === 'function' ? f.onLoad() : () => {}));
}

function baseSetup({ notifRows = [], demandRows = [], failRead = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.MutationObserver = MOStub;
  setEnsureAuth(() => true);
  _dhResetForTests();
  closeAllModals();
  state.user = null; state.guestRole = null; state.page = null;
  state.myDemands = []; state.browseDemands = []; state.allTeachers = [];
  mountShell(); // #view-client + #modal-container + #toast-container + per-page sections
  const fetched = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    fetched.push({ u, method });
    if (/\/api\/notifications\/\d+\/read$/.test(u) && failRead) return { ok: false, status: 500, json: async () => ({ error: 'server down' }) };
    if (u === '/api/notifications') return { ok: true, status: 200, json: async () => ({ notifications: notifRows }) };
    if (u === '/api/conversations') return { ok: true, status: 200, json: async () => ({ conversations: [] }) };
    if (u.includes('/api/student/demands')) return { ok: true, status: 200, json: async () => ({ demands: demandRows }) };
    if (/\/api\/demands\/\d+\/intents$/.test(u)) return { ok: true, status: 200, json: async () => ({ teachers: [{ user_id: 38, username: 'kkkk', rating: 4, avatar: '', province: 'guangdong', price_min: 150, price_max: 150, intent_status: 'accepted', intent_id: 5 }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { dom, fetched };
}
function teardown() {
  stopVersionProbe();
  if (typeof document !== 'undefined') { stopBadgePoll(); closeAllModals(); } // 幂等：重复 teardown（如 badge 测试双 enterNotifPage）安全
  setEnsureAuth(null);
  delete globalThis.fetch;
  delete globalThis.MutationObserver;
  delete globalThis.localStorage; delete globalThis.sessionStorage;
  delete globalThis.document; delete globalThis.window;
  state.user = null; state.guestRole = null; state.page = null;
  state.myDemands = []; state.browseDemands = []; state.allTeachers = [];
}

/** 挂 t.after 清理（断言失败也执行）——防 installed 标志卡死级联 */
function registerCleanup(t, uninstall) {
  t.after(() => { uninstall.forEach(f => f()); teardown(); });
}

async function enterNotifPage(t, { notifRows = [], demandRows = [], failRead = false } = {}) {
  const { dom, fetched } = baseSetup({ notifRows, demandRows, failRead });
  const uninstall = installAll();
  registerCleanup(t, uninstall);
  state.user = USER;
  renderSidebar();
  state.page = 'notifications';
  await enterNotifications();
  await tick();
  return { dom, fetched };
}

const rows = [
  { id: 1, text: `${BROADCAST}维护公告\n今晚维护`, is_read: 1, created_at: '2026-08-08 10:00:00' },
  { id: 2, text: '关于「数学」的需求，学生已选择其他老师', is_read: 0, created_at: '2026-08-08 09:00:00' },
  { id: 3, text: `${BROADCAST}新版本上线`, is_read: 0, created_at: '2026-08-08 08:00:00' },
  { id: 4, text: '你的意向已被学生同意', is_read: 0, created_at: '2026-08-08 07:00:00' },
];

test('item5 屏蔽系统通知按钮：默认全显，点按隐藏广播并持久化，再点恢复', async (t) => {
  const { dom, fetched } = await enterNotifPage(t, { notifRows: rows });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.notif-item').length, 4, '默认展示全部 4 条');
  const btn = doc.getElementById('btn-notif-block');
  assert.ok(btn, '屏蔽按钮在位');
  assert.equal(btn.textContent, TEXT.NOTIF_BLOCK_OFF, '默认文案');
  assert.equal(btn.classList.contains('notif-block-btn--on'), false, '默认未选中');

  const notifFetches = () => fetched.filter(f => f.u === '/api/notifications').length;
  assert.equal(notifFetches(), 1, '进页只请求一次通知列表');
  btn.click(); // 屏蔽
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '屏蔽后只显非广播 2 条');
  assert.equal(btn.textContent, TEXT.NOTIF_BLOCK_ON, '选中文案');
  assert.equal(btn.classList.contains('notif-block-btn--on'), true, '选中态类');
  assert.equal(globalThis.localStorage.getItem('sufe_block_broadcast'), '1', '偏好持久化');
  assert.equal(notifFetches(), 1, 'toggle 重排不重新请求（_notifList 复用）');

  btn.click(); // 恢复
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 4, '恢复后全显');
  assert.equal(btn.textContent, TEXT.NOTIF_BLOCK_OFF, '恢复文案');
  assert.equal(globalThis.localStorage.getItem('sufe_block_broadcast'), '0', '偏好已清除');
});

test('item5 屏蔽后全为广播 → 空态文案（NOTIF_FILTER_EMPTY）', async (t) => {
  const { dom } = await enterNotifPage(t, { notifRows: [
    { id: 1, text: `${BROADCAST}维护公告`, is_read: 1, created_at: '2026-08-08 10:00:00' },
    { id: 2, text: `${BROADCAST}新版本上线`, is_read: 1, created_at: '2026-08-08 08:00:00' },
  ] });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '未屏蔽时 2 条广播都显示');
  doc.getElementById('btn-notif-block').click();
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 0, '屏蔽后广播全隐');
  assert.ok(doc.getElementById('notifications-content').textContent.includes(TEXT.NOTIF_FILTER_EMPTY), '显示空态文案');
});

test('item5 进通知页按 localStorage 偏好应用过滤并同步按钮态（跨会话持久化）', async (t) => {
  const { dom } = await enterNotifPage(t, { notifRows: rows });
  const doc = dom.window.document;
  globalThis.localStorage.setItem('sufe_block_broadcast', '1');
  state.page = 'notifications';
  await enterNotifications();
  await tick();
  assert.equal(doc.querySelectorAll('.notif-item').length, 2, '屏蔽偏好进页只显非广播');
  assert.equal(doc.getElementById('btn-notif-block').textContent, TEXT.NOTIF_BLOCK_ON, '按钮为选中态');
});

test('页面顶部 title 旁「i」信息按钮：selectPage 注入、幂等、点击打开浮窗（文案单源 constants）', async (t) => {
  const { dom } = await enterNotifPage(t);
  const doc = dom.window.document;
  state.user = USER;
  renderSidebar();
  await selectPage('my-demands'); // injectPageHeaderInfo 按当前页注入页头
  const info = doc.querySelector('#client-main .client-page:not(.hidden) .page-header .page-header-info');
  assert.ok(info, '页头 title 旁 i 按钮已注入');
  assert.equal(doc.querySelectorAll('.page-header-info').length, 1, '切页后幂等，只一个 i 按钮');
  assert.equal(doc.querySelectorAll('.sidebar-item-info').length, 0, '侧边栏内 i 按钮已连根删');
  info.click();
  assert.ok(doc.querySelector('#modal-container .modal-overlay'), '信息浮窗打开');
  assert.equal(doc.querySelector('#modal-container .modal-header h2').textContent, TEXT.PAGE_MY_DEMANDS, '浮窗标题 = 模块名');
  const bodyText = doc.querySelector('#modal-container .modal-body').textContent;
  assert.ok(bodyText.length > 50, '结构化介绍内容可观');
  assert.ok(bodyText.includes('这是什么'), '渲染出 Markdown 小标题（这是什么）');
  assert.ok(!bodyText.includes('## '), 'Markdown 语法已解析，不残留原文标记');
  assert.ok(TEXT.MODULE_INFO['my-demands'].startsWith('## '), 'constants 源文案为结构化 Markdown');
  // 所有注册模块都有介绍文案（防漏配；v2 pagesForRole 覆盖三角色可见页）
  for (const role of ['student', 'teacher', 'admin']) {
    state.user = { role, id: 1, username: 's', avatar: '' };
    const missing = pagesForRole().filter(p => !TEXT.MODULE_INFO[p.id]).map(p => p.id);
    assert.equal(missing.length, 0, `${role} 可见模块都配了介绍文案（缺失：${missing.join(',') || '无'}）`);
  }
});

test('shell 完整性（审计 F1/F2/F3 回归）：注册页容器全覆盖 + 落地页入口 + 筛选折叠默认态', async (t) => {
  const { dom } = await enterNotifPage(t);
  const doc = dom.window.document;
  // F1：每个已注册页在 shell 都有对应 client-page 区（防 admin-complaint 类断线再发）
  state.user = { role: 'admin', id: 1, username: 's', avatar: '' };
  renderSidebar();
  for (const p of pagesForRole()) {
    const section = doc.querySelector(`#client-main .client-page[data-page="${p.id}"]`);
    assert.ok(section, `已注册页 ${p.id} 在 shell 有 client-page 容器`);
  }
  assert.ok(doc.querySelector('.client-page[data-page="admin-complaint"] #admin-complaint-list'), 'admin-complaint 容器在位');
  await selectPage('admin-complaint');
  await tick(80); // 等 complaints 页 async enter（loadAdminComplaints→loadInto）在测试内落定，防测试结束后 unhandledRejection
  assert.ok(!doc.querySelector('.client-page[data-page="admin-complaint"]').classList.contains('hidden'), 'admin-complaint 可进入（非空白页）');
  // F2：筛选面板默认折叠 + 折叠开关按钮在位（v1 parity）
  assert.ok(doc.getElementById('demand-filter-panel').classList.contains('hidden'), '需求筛选面板默认收起');
  assert.ok(doc.getElementById('demand-filter-toggle-btn'), '需求筛选折叠按钮在位');
  assert.ok(doc.getElementById('filter-toggle-btn'), '教师筛选折叠按钮在位');
  // F3：落地页有登录/注册/访客入口（v1 landing parity，data-action 委托无内联）
  const landing = doc.querySelector('#view-landing');
  assert.ok(landing.querySelector('[data-action="auth.viewLogin"]'), '落地页登录按钮');
  assert.ok(landing.querySelector('[data-action="auth.viewRegister"]'), '落地页注册按钮');
  assert.ok(landing.querySelector('[data-action="auth.enterGuest"][data-role="student"]'), '学生访客入口');
  assert.ok(landing.querySelector('[data-action="auth.enterGuest"][data-role="teacher"]'), '教师访客入口');
  assert.equal(landing.querySelector('[onclick]'), null, '落地页零内联 onclick');
});

test('item9 会话列表「会话」title 专属类在位（shell 静态提供）', async (t) => {
  const { dom } = await enterNotifPage(t);
  const doc = dom.window.document;
  const title = doc.querySelector('.chats-list-title');
  assert.ok(title, '会话 title 元素在位');
  assert.equal(title.textContent, TEXT.CHAT_TITLE, '文案 = CHAT_TITLE');
});

test('item6 意向行结构：学生自己需求卡（loadMyDemands editable 契约）展开意向，用户名+星级包 intent-row-user、状态 tag 独立', async (t) => {
  const { dom } = await enterNotifPage(t, { demandRows: [{
    id: 7, user_id: 39, username: '学生A', student_grade: 'senior1', student_gender: 'female',
    target_subjects: ['math'], current_scores: [], teaching_method: 'offline', address: '杨浦区',
    province: 'shanghai', budget_min: 0, budget_max: 0, status: 'open', display_id: 7,
    intent_locked: 0, my_intent_status: '', avatar: '', created_at: '2026-08-07 04:27:09',
    pending_intents: 1, intent_count: 1,
  }] });
  const doc = dom.window.document;
  state.user = USER;
  renderSidebar();
  await loadMyDemands(); // 学生自己列表 → editable 卡（意向开关 + 编辑按钮）
  await tick(60);
  const toggle = doc.getElementById('intent-toggle-7');
  assert.ok(toggle, '意向开关在位（editable 契约）');
  assert.ok(doc.querySelector('[data-action="student.editDemand"]'), '编辑按钮在位（editable 契约）');
  toggle.click();
  await tick(60);
  const line = doc.querySelector('.intent-row-line');
  assert.ok(line, '意向行带 intent-row-line 专属类');
  assert.ok(line.querySelector('.intent-row-user strong'), '用户名在 intent-row-user 内');
  assert.ok(line.querySelector('.intent-row-user .stars'), '星级在 intent-row-user 内');
  const tag = line.querySelector('.tag');
  assert.ok(tag, '状态 tag 在位');
  assert.equal(tag.textContent, TEXT.INTENT_STATUS_ACCEPTED, 'mock 意向为 accepted → 已同意');
  assert.equal(line.lastElementChild, tag, 'tag 是意向行末子元素（独立成行，置用户名下方）');
});

test('item8 设置页两区颠倒：账户信息在上、外观在下', async (t) => {
  const { dom } = await enterNotifPage(t);
  const doc = dom.window.document;
  await enterAccountSettings();
  const titles = [...doc.querySelectorAll('.settings-section-title')].map(e => e.textContent);
  assert.deepEqual(titles, ['账户设置', '外观设置', '隐私设置'], '账户区在前、外观区在后、隐私区收尾');
  assert.equal(doc.querySelectorAll('.theme-opt').length, 3, '外观主题三项仍在');
  assert.equal(doc.querySelectorAll('.settings-row').length >= 4, true, '账户行（头像/用户名/角色/电话/邮箱）在位');
});

// #151（v0.25.59）：未读提醒由左红竖线改为整卡呼吸遮罩；点击/键盘消除——单条标记已读
test('#151 未读项渲染呼吸遮罩与点击消除入口；已读项无交互', async (t) => {
  const { dom } = await enterNotifPage(t, { notifRows: rows });
  const doc = dom.window.document;
  const unread = doc.querySelectorAll('.notif-item.unread');
  assert.equal(unread.length, 3, '3 条未读项带 unread 类（呼吸遮罩）');
  const first = unread[0];
  assert.ok(first.getAttribute('data-id'), '未读项带 data-id 供 markNotifRead 定位');
  assert.equal(first.getAttribute('data-action'), 'notif.markRead', '未读项可点击消除（data-action 委托）');
  assert.equal(first.getAttribute('role'), 'button', '未读项键盘可达');
  assert.equal(first.getAttribute('tabindex'), '0', '未读项 tabindex 可聚焦');
  assert.equal(first.querySelector('.notif-dot').classList.contains('read'), false, '未读红点保留');
  const readItem = doc.querySelector('.notif-item:not(.unread)');
  assert.ok(readItem, '有已读项');
  assert.equal(readItem.getAttribute('data-action'), null, '已读项无点击消除入口');
});

test('#151 点击未读项 → 单条已读上报 + 遮罩/红点就地消除；键盘 Enter 同效', async (t) => {
  const { dom, fetched } = await enterNotifPage(t, { notifRows: rows });
  const doc = dom.window.document;
  const reads = fetched.filter(f => f.u.startsWith('/api/notifications/') && f.u.endsWith('/read'));
  assert.equal(reads.length, 0, '进入通知页不再批量全读上报');
  const target = doc.querySelector('.notif-item.unread');
  const id = target.getAttribute('data-id');
  target.click();
  await tick(); await tick(); // 等异步 API 回包
  assert.ok(fetched.some(f => f.u === `/api/notifications/${id}/read` && f.method === 'POST'), '点击上报单条已读');
  assert.equal(target.classList.contains('unread'), false, '遮罩就地消除');
  assert.equal(target.querySelector('.notif-dot').classList.contains('read'), true, '红点消除');
  assert.equal(target.getAttribute('data-action'), null, '已读后交互属性移除');
  // 键盘 Enter：对另一条未读项派发 keydown → 单条已读（keydown 委托）
  const kb = doc.querySelectorAll('.notif-item.unread')[0];
  const kbId = kb.getAttribute('data-id');
  kb.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.ok(fetched.some(f => f.u === `/api/notifications/${kbId}/read`), 'Enter 键同样上报单条已读');
});

test('#151 呼吸遮罩样式在位（style.css 含 keyframes 与 .unread::after，左竖线已删）', () => {
  const css = STYLE_CSS;
  assert.ok(css.includes('@keyframes notif-breathe'), '呼吸遮罩关键帧在位');
  assert.ok(css.includes('.notif-item.unread::after'), '未读遮罩伪元素规则在位');
  assert.ok(!css.includes('.notif-item.unread { --g-surface: inset 3px 0 0 var(--danger);'),
    '左侧红竖线提醒已删（#151 取代）');
});

test('#151 单条已读上报失败 → 回滚：遮罩与点击入口恢复（可重试）', async (t) => {
  const { dom, fetched } = await enterNotifPage(t, { notifRows: rows, failRead: true });
  const doc = dom.window.document;
  const target = doc.querySelector('.notif-item.unread');
  const id = target.getAttribute('data-id');
  target.click();
  await tick(); await tick(); // 等失败回包
  assert.ok(fetched.some(f => f.u === `/api/notifications/${id}/read` && f.method === 'POST'), '失败路径也发起上报');
  assert.equal(target.classList.contains('unread'), true, '失败回滚：遮罩恢复');
  assert.equal(target.querySelector('.notif-dot').classList.contains('read'), false, '红点恢复');
  assert.equal(target.getAttribute('data-action'), 'notif.markRead', '失败回滚：点击入口恢复可重试');
  assert.equal(target.getAttribute('role'), 'button', '失败回滚：键盘入口恢复');
});

// 2026-08-09 反馈三项：呼吸加速 + 竖线连根删 + 离开通知页批量已读（看过即消）
test('反馈-呼吸加速：notif-breathe 时长 0.9s + 中间关键帧', () => {
  const css = STYLE_CSS;
  const m = css.match(/animation: notif-breathe ([0-9.]+)s/);
  assert.ok(m, '呼吸动画时长在位');
  assert.equal(Number(m[1]), 0.9, '时长加快到 0.9s');
  assert.ok(css.includes('25%, 75% { opacity: .09; }'), '加 25/75 中间关键帧');
});

test('反馈-竖线连根删：.about-funds 与 .funds-note 不再带 border-left 强调', () => {
  const css = STYLE_CSS;
  for (const cls of ['.about-funds', '.funds-note']) {
    const rule = css.split(cls + ' {')[1] || '';
    const block = '{' + rule.split('}')[0] + '}';
    assert.ok(!block.includes('border-left'), `${cls} 左竖线已删（无强调）`);
  }
});

test('反馈-离开通知页批量已读：看过即消，POST /api/notifications/read-all + 本地全翻', async (t) => {
  const freshRows = [
    { id: 11, text: `${BROADCAST}维护公告`, is_read: 1, created_at: '2026-08-08 10:00:00' },
    { id: 12, text: '需求被选走', is_read: 0, created_at: '2026-08-08 09:00:00' },
    { id: 13, text: `${BROADCAST}新版本上线`, is_read: 0, created_at: '2026-08-08 08:00:00' },
    { id: 14, text: '意向已同意', is_read: 0, created_at: '2026-08-08 07:00:00' },
  ];
  const { dom, fetched } = await enterNotifPage(t, { notifRows: freshRows });
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.notif-item.unread').length, 3, '进页未读呼吸仍展示（不自动全读）');
  assert.ok(!fetched.some(f => f.u === '/api/notifications/read-all'), '进页不发批量已读');
  // 切到设置页 → registerPage leave 钩子触发批量已读
  await selectPage('account-settings');
  await tick(); await tick();
  assert.ok(fetched.some(f => f.u === '/api/notifications/read-all' && f.method === 'POST'), '离开通知页发批量已读');
  assert.equal(doc.querySelectorAll('.notif-item.unread').length, 0, '遮罩就地消除');
  assert.equal(_notifList.every(n => n.is_read), true, '本地 _notifList 全翻已读');
});

// v0.25.95（用户反馈）：屏蔽系统通知后，被屏蔽的广播公告未读不再计入侧边栏红点（refreshBadges 同过滤口径）
test('屏蔽系统通知：广播公告未读不再唤起侧边栏红点（非广播未读仍计数）', async (t) => {
  const { dom } = await enterNotifPage(t, { notifRows: [
    { id: 1, text: `${BROADCAST}维护公告`, is_read: 0, created_at: '2026-08-08 10:00:00' },
    { id: 2, text: '关于「数学」的需求，学生已选择其他老师', is_read: 0, created_at: '2026-08-08 09:00:00' },
    { id: 3, text: `${BROADCAST}新版本上线`, is_read: 1, created_at: '2026-08-08 08:00:00' },
  ] });
  const doc = dom.window.document;
  state.user = USER;
  renderSidebar();
  const dot = doc.getElementById('sidebar-notifications-dot');
  assert.ok(dot, '通知红点元素在位');

  // 未屏蔽：未读 = 广播1(未读) + 非广播1(未读) = 2 → 红点亮
  globalThis.localStorage.removeItem(CONFIG.NOTIF_BLOCK_KEY);
  state.page = 'my-demands';
  await refreshBadges();
  await tick(); await tick();
  assert.equal(dot.classList.contains('hidden'), false, '未屏蔽：有未读（含广播）红点亮');

  // 屏蔽：广播未读被过滤 → 未读 = 仅非广播1 = 1 → 红点仍亮（非广播未读正常计数）
  globalThis.localStorage.setItem(CONFIG.NOTIF_BLOCK_KEY, '1');
  await refreshBadges();
  await tick(); await tick();
  assert.equal(dot.classList.contains('hidden'), false, '屏蔽后非广播未读仍计数红点亮');

  // 全为广播未读 + 屏蔽 → 未读 = 0 → 红点灭（系统通知不再唤红点）
  const { dom: dom2 } = await enterNotifPage(t, { notifRows: [
    { id: 4, text: `${BROADCAST}维护公告`, is_read: 0, created_at: '2026-08-08 10:00:00' },
    { id: 5, text: `${BROADCAST}新版本上线`, is_read: 0, created_at: '2026-08-08 08:00:00' },
  ] });
  const doc2 = dom2.window.document;
  state.user = USER;
  renderSidebar();
  globalThis.localStorage.setItem(CONFIG.NOTIF_BLOCK_KEY, '1');
  state.page = 'my-demands';
  await refreshBadges();
  await tick(); await tick();
  assert.equal(doc2.getElementById('sidebar-notifications-dot').classList.contains('hidden'), true,
    '屏蔽后广播公告未读不唤红点（核心诉求）');
});
