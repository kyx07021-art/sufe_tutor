/**
 * 需求六（2026-08-08）·聊天气泡文件组件布局架构（v0.25.49）
 *
 * 缺陷实证：文件消息卡整体太靠左戳出气泡圆角（.chat-bubble--media 全出血内衬为图片设计，
 * 文件卡共用后内容顶着圆角）；下载按钮同款顶边；卡片 min-width:190 + 信息列 flex:1
 * 把下载按钮推到最右，文件名短时中间空一大截。
 *
 * 架构修正：文件/图片分流——图片保持全出血（padding 0 + 圆角裁剪），文件卡走
 * .chat-bubble--file 圆角内衬（10/12）；文件卡随内容收缩（width:fit-content）+
 * 文件名 max-width 截断，下载按钮紧随其后，中间不再空一截。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-otp.js', 'app-captcha.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () { // jsdom 无 canvas：patch 链式 2d 替身（app-captcha 进 boot FILES 后 vm 测试走到 canvas 路径）
    const mk = () => new Proxy(() => {}, { get: (t, k) => (k === 'canvas' ? {} : mk()), apply: () => mk() });
    return mk();
  };
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
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
  vm.runInContext(`if (typeof openCaptchaModal === 'function') { const _ocm = openCaptchaModal; openCaptchaModal = (o) => { if (o && o.onPass) o.onPass(); }; }`, ctx); // vm 测试直通拼图（生产走真验证）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('文件卡分流 .chat-bubble--file（圆角内衬），图片仍全出血', () => {
  const chat = readFileSync('./app-chat.js', 'utf8');
  assert.ok(chat.includes("mediaCls = m.kind === 'file' ? ' chat-bubble--file' : ''"), '文件消息带 file 类、图片不带');
  const css = readFileSync('./style-chat.css', 'utf8');
  const fileRule = css.split('.chat-bubble--file {')[1] || '';
  assert.ok(fileRule.split('}')[0].includes('padding: 10px 12px'), '文件卡圆角内衬（内容不再戳出圆角）');
  // 图片全出血保持 padding:0
  const mediaRule = css.split('.chat-bubble--media {')[1] || '';
  assert.ok(mediaRule.split('}')[0].includes('padding: 0'), '图片气泡仍全出血（圆角裁剪）');
});

test('文件卡随内容收缩：无 min-width 撑宽、无 flex:1 撑中缝，文件名截断后下载按钮紧随', () => {
  const css = readFileSync('./style-chat.css', 'utf8');
  const fileRule = (css.split('.chat-file {')[1] || '').split('}')[0];
  assert.ok(fileRule.includes('width: fit-content'), '卡片随内容收缩（不撑满气泡）');
  assert.ok(!fileRule.includes('min-width'), '无强制 min-width 190px（曾把短文件名撑出大中缝）');
  const infoRule = (css.split('.chat-file-info {')[1] || '').split('}')[0];
  assert.ok(!infoRule.includes('flex: 1'), '信息列不再 flex:1 吃满剩余宽度（中缝根因）');
  assert.ok(infoRule.includes('max-width'), '文件名列有宽度上限，超长 ellipsis 截断');
});

test('渲染验证：文件消息气泡带 chat-bubble--file 类，图片消息不带', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'student', username: 'me' };`, ctx);
  const fileHtml = vm.runInContext(`renderChatBubble({
      id: 10, sender_user_id: 1, kind: 'file', body: 'data:application/pdf;base64,AA==', name: '讲义.pdf',
      created_at: '2026-08-08 10:00:00',
    }, 0)`, ctx);
  assert.ok(fileHtml.includes('chat-bubble--file'), '文件消息气泡带 file 类');
  assert.ok(fileHtml.includes('chat-file'), '文件卡结构在');
  assert.ok(fileHtml.includes('下载'), '下载按钮在');
  const imgHtml = vm.runInContext(`renderChatBubble({
      id: 11, sender_user_id: 1, kind: 'image', body: '', thumb: 'data:image/png;base64,AA==',
      created_at: '2026-08-08 10:00:00',
    }, 0)`, ctx);
  assert.ok(!imgHtml.includes('chat-bubble--file'), '图片消息不带 file 类');
});
