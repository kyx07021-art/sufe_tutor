/**
 * 会话与需求/签约解耦 + 绑定需求下拉（需求四·第1/2/3/4条）前端回归
 *
 * 覆盖：
 *   1. renderChatFrame 不再渲染需求编号与「已签约」tag，但含签约确认灰字提示条（.chat-sign-tip）；
 *   2. renderConvItem 会话列表项不再含「已签约」tag；
 *   3. openSigningModal 请求 phase=signing 需求、下拉每项含 #编号 · 目标名；
 *   4. openContractDraftModal 请求 phase=contract、含「仅已签约需求」提示文案、下拉含 #编号；
 *   5. submitSigning / submitContractDraft 提交时带 demandId 且未选需求被校验拦截。
 *
 * 采用 boot.test.js 同款：真实 index.html DOM + 全脚本 vm 沙箱，mock api/ensureAuth。
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
  // 屏蔽首访欢迎弹窗（app-shell DOMContentLoaded → showOnboardingIfNeeded 会覆盖 #modal-container，
  // 干扰本文件对弹窗内容的断言）；置 sufe_returning 标记即 isReturning()=true 早退
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  return { ctx, dom };
}

const baseConv = (extra = {}) => ({
  id: 1, student_user_id: 39, teacher_user_id: 40, demand_id: 7, status: 'active',
  student_name: '学生A', teacher_name: '教师B', student_avatar: '', teacher_avatar: '',
  contracted: true, demand_display_id: 7,
  last_kind: 'text', last_body: '你好', last_at: '2026-08-07 00:00:00', created_at: '2026-08-07 00:00:00',
  unread_count: 0, last_sender: 40,
  ...extra,
});

test('会话模块 title 旁 i 信息按钮（需求四·10 自查补漏：聊天自绘 title 也挂 i）', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    state.user = { id: 39, role: 'student' };
    api = async () => ({ conversations: [] });
    enterMyChats();
  `, ctx);
  const group = dom.window.document.querySelector('.chats-list-title-group');
  assert.ok(group, '会话 title 分组 .chats-list-title-group 存在');
  assert.ok(group.querySelector('.chats-list-title'), '分组含「会话」title');
  const info = group.querySelector('.page-header-info');
  assert.ok(info, '分组内挂 i 信息按钮（复用 createModuleInfoBtn）');
  assert.equal(info.textContent, 'i');
  info.click();
  const modal = dom.window.document.querySelector('#modal-container .modal');
  assert.ok(modal, '点击 i 应打开标准信息浮窗（openModuleInfo）');
  assert.ok(modal.textContent.includes('会话'), '浮窗含该模块介绍文案');
});

test('renderChatFrame：不再含需求编号与「已签约」tag，含签约灰字提示条', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    state.user = { id: 39, role: 'student' };
    window.__html = renderChatFrame(${JSON.stringify(baseConv())});
  `, ctx);
  const html = dom.window.__html;
  assert.ok(!html.includes('需求 #'), '会话头不得显示需求编号');
  assert.ok(!html.includes('chat-head-demand'), '不得渲染 .chat-head-demand');
  assert.ok(!html.includes('chat-head-signed'), '不得渲染 .chat-head-signed');
  assert.ok(!html.includes('已签约'), '会话头不得显示「已签约」tag');
  assert.ok(html.includes('chat-sign-tip'), '应渲染签约确认灰字提示条（.chat-sign-tip）');
  assert.ok(html.includes('id="chat-sign-tip"'), '提示条带稳定 id 供 JS 切类');
});

test('renderConvItem：会话列表项不再含「已签约」tag', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    state.user = { id: 39, role: 'student' };
    window.__html = renderConvItem(${JSON.stringify(baseConv())});
  `, ctx);
  const html = dom.window.__html;
  assert.ok(!html.includes('conv-signed-tag'), '会话项不得渲染 .conv-signed-tag');
  assert.ok(!html.includes('已签约'), '会话项不得含「已签约」文字');
});

test('openSigningModal：请求 phase=signing 需求，下拉每项含 #编号 · 目标名', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    ensureAuth = () => true;
    api = async (url) => { window.__requestedUrl = url; return { demands: [
      { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
      { id: 2, user_id: 39, display_id: 8, target_subjects: ['english'], target_type: 'academic', budget_min: 0, budget_max: 0 },
    ]}; };
  `, ctx);
  await vm.runInContext('openSigningModal(1)', ctx);
  const modal = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(dom.window.__requestedUrl.includes('phase=signing'), '发起签约应请求 signing 阶段需求');
  assert.ok(modal.includes('signing-demand'), '应有「选择需求」下拉');
  const sel = dom.window.document.getElementById('signing-demand');
  assert.ok(sel, 'signing-demand select 在 DOM');
  const optTexts = [...sel.options].map(o => o.textContent);
  assert.ok(optTexts.some(t => t.includes('#0007')), '下拉含需求编号 #0007');
  assert.ok(optTexts.some(t => t.includes('数学')), '下拉含目标名（数学）');
});

test('openContractDraftModal：请求 phase=contract，含「仅已签约需求」提示，下拉含 #编号', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    ensureAuth = () => true; // v0.25.15：openContractDraftModal 补 ensureAuth 守卫后测试须桩
    api = async (url) => { window.__requestedUrl = url; return { demands: [
      { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
    ]}; };
    chatConvById = () => ({ id: 1, student_user_id: 39, teacher_user_id: 40 });
  `, ctx);
  await vm.runInContext('openContractDraftModal(1)', ctx);
  const modal = dom.window.document.getElementById('modal-container').innerHTML;
  assert.ok(dom.window.__requestedUrl.includes('phase=contract'), '起草合同应请求 contract 阶段需求');
  assert.ok(modal.includes('contract-demand-hint'), '应有「仅已签约需求」提示元素');
  assert.ok(modal.includes('仅已签约需求'), '提示文案在位');
  const sel = dom.window.document.getElementById('contract-demand');
  assert.ok(sel, 'contract-demand select 在 DOM');
  assert.ok([...sel.options].some(o => o.textContent.includes('#0007')), '下拉含需求编号 #0007');
  assert.ok(![...sel.options].some(o => o.textContent.includes('不关联需求')), '不再提供「不关联需求」空选项');
});

test('openContractDraftModal：会话绑定需求不在可绑列表时置空占位（不静默回退首项，v0.25.15 审计修复）', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    ensureAuth = () => true;
    api = async () => ({ demands: [
      { id: 1, user_id: 39, display_id: 7, target_subjects: ['math'], target_type: 'academic', budget_min: 100, budget_max: 200 },
      { id: 2, user_id: 39, display_id: 8, target_subjects: ['physics'], target_type: 'academic', budget_min: 150, budget_max: 250 },
    ]});
    chatConvById = () => ({ id: 1, student_user_id: 39, teacher_user_id: 40, demand_id: 999 }); // 绑定的需求不在可绑列表
  `, ctx);
  await vm.runInContext('openContractDraftModal(1)', ctx);
  const sel = dom.window.document.getElementById('contract-demand');
  assert.ok(sel, 'contract-demand select 在 DOM');
  // 占位 option 存在且被选中（用户须显式选择，防与会话实际绑定需求不符）
  const opts = [...sel.options];
  assert.equal(opts[0].value, '', '首项为占位空值');
  assert.ok(opts[0].disabled && opts[0].selected, '占位 option 选中且禁选');
  assert.ok(!opts.some(o => o.selected && o.value !== ''), '无任何真实需求被静默预选');
});

test('submitSigning：未选需求被校验拦截，不发起请求；选中后携带 demandId', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    ensureAuth = () => true;
    showToast = (m) => { window.__toast = m; };
    api = async (url, opts) => { if (opts && opts.method === 'POST') window.__posted = { url, body: opts.body }; return { id: 1 }; };
    openSigningModal = async () => {};
    document.getElementById('modal-container').innerHTML = \`
      <div class="modal"><div class="modal-body">
        <select class="form-select" id="signing-demand"><option value="">请选择</option><option value="7">#0007</option></select>
        <input id="signing-price" value="150"><input id="signing-schedule" value="每周六"><select id="signing-method"><option value="offline" selected>线下</option></select>
      </div></div>\`;
  `, ctx);
  // 未选需求
  await vm.runInContext('submitSigning(1)', ctx);
  assert.ok(String(dom.window.__toast || '').includes('需求'), '未选需求应提示校验');
  assert.equal(dom.window.__posted, undefined, '未选需求不应发请求');
  // 选中后携带 demandId
  await vm.runInContext(`document.getElementById('signing-demand').value = '7'; submitSigning(1)`, ctx);
  assert.ok(dom.window.__posted, '选中需求后应发请求');
  assert.equal(dom.window.__posted.body.demandId, 7, '请求体携带 demandId');
});

test('submitContractDraft：未选已签约需求被校验拦截', async () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`
    showToast = () => {};
    api = async () => ({});
    document.getElementById('modal-container').innerHTML = \`
      <div class="modal"><div class="modal-body">
        <div id="contract-alert"></div>
        <select class="form-select" id="contract-demand"><option value="" disabled>暂无</option></select>
        <input id="contract-rate" value="150"><select id="contract-method"><option value="online">线上</option></select>
        <input id="contract-pay-method" value="per_session"><div id="contract-pay-method-other-wrap" class="hidden"></div>
        <input id="contract-trial-pay" value="first_free"><div id="contract-trial-pay-other-wrap" class="hidden"></div>
        <input id="contract-first-lesson">
        <textarea id="post-body">方案</textarea>
      </div></div>\`;
  `, ctx);
  await vm.runInContext('submitContractDraft(1)', ctx);
  const alertHtml = dom.window.document.getElementById('contract-alert').innerHTML;
  assert.ok(alertHtml.includes('选择已签约需求'), '未选已签约需求应提示校验');
});
