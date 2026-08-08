/**
 * 需求十二（2026-08-08）·聊天气泡外观优化（v0.25.34，上网调研后彻底改）
 *
 * 用户反馈四问题 → 调研结论 → 修复：
 *   ①「套娃」：文件 chip（glass glass--solid）嵌进玻璃气泡 → 文件卡片拍平进气泡单表面
 *      （.chat-file 图标块+文件名+大小+下载，无嵌套玻璃）；
 *   ②「鲜艳」：mine/theirs/system 三色相 → 主流「发送彩色/接收中性」通例：mine=品牌紫近实、
 *      theirs=中性近实、system=中性低对比胶囊（去第三色相，fg 从 accent-deep 改 muted）；
 *   ③「过透」：气泡填充 alpha 0.14~0.32 → 近实色 hex（alpha≈1.0）；文本气泡不加 backdrop-filter
 *      （--g-frost 默认 none；性能 + WCAG 4.5:1 合成对比度 + 本项目 983252 冻结教训）；
 *   ④「样式不统一」：圆角统一 16px、图片即气泡无边框（overflow:hidden 裁剪）、系统胶囊、
 *      签约气泡单条品牌色条（border-left accent）、组内 6px/换人 18px。
 *
 * 本测试覆盖（结构/单源断言；视觉几何靠浏览器实测）：
 *   - 主题气泡 token：浅/深两套 mine/theirs 为近实色（非低 alpha rgba）、system 为低对比中性；
 *   - flat 包不再覆盖气泡 token（与液态同源）；
 *   - 文件消息渲染：无 .chat-file-chip 嵌套玻璃，含 .chat-file 拍平卡片 + 扩展名徽标 + 大小；
 *   - 图片消息：媒体气泡内为 <img> 直铺（无 chip 嵌套）；
 *   - 系统气泡类仍为 system（中性胶囊）。
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
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
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
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('主题气泡 token：浅/深两套近实色，系统为低对比中性（治鲜艳+过透）', () => {
  const { ctx } = makeCtx();
  // 浅色：mine/theirs 为近实 hex（alpha≈1），非低 alpha rgba；system 低对比中性
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.light["--g-bubble-mine"]', ctx), /^#/, '浅色 mine 近实色 hex（非半透明）');
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.light["--g-bubble-theirs"]', ctx), /^#/, '浅色 theirs 近实白 hex');
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.light["--g-bubble-system"]', ctx), /rgba\(17,17,20/, '浅色 system 中性低对比');
  // 深色：mine/theirs 为近实 hex
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.dark["--g-bubble-mine"]', ctx), /^#/, '深色 mine 品牌紫降饱和近实');
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.dark["--g-bubble-theirs"]', ctx), /^#/, '深色 theirs 中性深灰近实');
});

test('flat 外观包不再覆盖气泡 token（与液态同源，删三色相特例）', () => {
  const { ctx } = makeCtx();
  const flat = vm.runInContext('JSON.stringify(APP_CONSTANTS.STYLE_PACKS.flat.tokens)', ctx);
  assert.ok(!flat.includes('--g-bubble'), 'flat 包无气泡 token 覆盖（theme 近实值两包共用）');
});

test('文件消息：拍平卡片无嵌套玻璃，含扩展名徽标 + 人性化大小', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`renderChatMediaInner('file', 'data:application/pdf;base64,' + 'A'.repeat(800), '教案.pdf')`, ctx);
  assert.ok(!html.includes('chat-file-chip') && !html.includes('glass glass--solid'), '无嵌套 glass chip（消套娃）');
  assert.ok(html.includes('chat-file'), '拍平卡片结构');
  assert.ok(html.includes('>PDF<'), '扩展名徽标 PDF');
  assert.ok(html.includes('KB') || html.includes('B'), '人性化大小显示');
  assert.ok(html.includes('chat-file-dl'), '下载按钮保留');
});

test('图片消息：气泡内 img 直铺（无 chip 嵌套）', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`renderChatMediaInner('image', 'data:image/jpeg;base64,xxx', 'a.jpg')`, ctx);
  assert.ok(html.includes('<img') && html.includes('chatViewImage'), '图片直接铺在气泡内');
  assert.ok(!html.includes('chat-file-chip') && !html.includes('chat-file'), '图片无文件卡片嵌套');
});

test('气泡圆角主值 16px（style-chat.css 单源）', () => {
  const css = readFileSync('./style-chat.css', 'utf8');
  const m = /\.chat-bubble\s*{[^}]*--g-r:\s*(\d+)px/.exec(css);
  assert.ok(m, 'style-chat.css 存在 .chat-bubble 主规则');
  assert.equal(m[1], '16', '主圆角 16px（v0.25.34 大圆角语言）');
  assert.ok(!css.includes('.chat-file-chip'), 'style-chat.css 无残留 .chat-file-chip 规则');
});

test('系统气泡仍走 system 类（中性胶囊）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'teacher', username: '甲' }`, ctx);
  const html = vm.runInContext(`renderChatBubble(${JSON.stringify({ kind: 'contract', sender_user_id: 1, id: 1, created_at: '2026-08-08 12:00:00', body: '' })}, 0)`, ctx);
  assert.ok(html.includes('chat-bubble--system'), '系统事件气泡为 system 类（中性胶囊）');
});
