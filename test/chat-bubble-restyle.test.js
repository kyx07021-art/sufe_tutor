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
    AbortController: globalThis.AbortController, // api() 的挂死保护构造器在 try 外，缺则 fetch 恒抛
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
  assert.match(vm.runInContext('APP_CONSTANTS.THEME.light["--g-bubble-system"]', ctx), /rgba\(17,17,20/, '浅色 system 中性灰');
  // 需求四十八（v0.25.56）：合同草案通知改明显灰色气泡——alpha 从 .055 提到 .10，浅纸上可辨
  const sysAlpha = vm.runInContext('APP_CONSTANTS.THEME.light["--g-bubble-system"]', ctx).match(/\.(\d+)\)/);
  assert.ok(sysAlpha && +('0.' + sysAlpha[1]) >= 0.09, '浅色 system 气泡 alpha ≥ .09（明显灰色，非不可见淡染）');
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
  const html = vm.runInContext(`renderChatMediaInner('image', 'data:image/jpeg;base64,xxx', 'a.jpg', '', 9)`, ctx);
  assert.ok(html.includes('<img') && html.includes('chatOpenImage'), '图片直接铺在气泡内，点击走 chatOpenImage');
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

// ============ v0.25.36 图片缩略图：预载立即展示、点开加载大图 ============

test('图片带缩略图：渲染 thumb 直接展示（非骨架），点击走 chatOpenImage 拉原图', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`renderChatMediaInner('image', '', 'a.jpg', 'data:image/jpeg;base64,THUMB', 42)`, ctx);
  assert.ok(html.includes('data:image/jpeg;base64,THUMB'), '缩略图即 src（预载立即展示）');
  assert.ok(html.includes('chatOpenImage(42, this)'), '点击走 chatOpenImage 拉原图');
  assert.ok(!html.includes('data-full'), '缩略图无 data-full 标记（非原图）');
  assert.ok(!html.includes('chat-bubble--loading'), '非骨架占位');
});

test('图片带全图（本人刚发/懒加载补载）：data-full 标记，点击直开大图', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`renderChatMediaInner('image', 'data:image/jpeg;base64,FULL', 'a.jpg', '', 42)`, ctx);
  assert.ok(html.includes('data-full="1"'), '已带全图标记 data-full');
  assert.ok(html.includes('data:image/jpeg;base64,FULL'), 'src 为全图');
});

test('renderChatBubble：image 消息带 thumb → 直接渲染图片（不进骨架懒加载）', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`state.user = { id: 2, role: 'teacher', username: '乙' }`, ctx);
  const html = vm.runInContext(`renderChatBubble(${JSON.stringify({ kind: 'image', sender_user_id: 1, id: 42, created_at: '2026-08-08 12:00:00', thumb: 'data:image/jpeg;base64,THUMB', body: '' })}, 0)`, ctx);
  assert.ok(html.includes('chat-bubble--media'), '媒体气泡');
  assert.ok(html.includes('THUMB') && !html.includes('chat-bubble--loading'), '缩略图直接展示、无加载骨架');
});

test('chatOpenImage：已带全图（data-full）→ 直开大图查看器；缩略图 → 拉原图后开', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`
    state.user = { id: 1, role: 'teacher', username: '甲' };
    chatConvId = 9;
    window._viewed = [];
    openImageViewer = (src) => { window._viewed.push(src); };
  `, ctx);
  // data-full → 直开当前 src
  const fullImg = vm.runInContext(`(() => {
    const img = document.createElement('img');
    img.dataset.full = '1'; img.src = 'data:image/jpeg;base64,FULL';
    return img;
  })()`, ctx);
  // 通过 vm 传入：构造一个真实 DOM img 并驱动
  vm.runInContext(`
    window._fullImg = null;
    (() => { const img = document.createElement('img'); img.dataset.full = '1'; img.src = 'data:image/jpeg;base64,FULL'; window._fullImg = img; })();
  `, ctx);
  await vm.runInContext('chatOpenImage(42, window._fullImg)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('window._viewed', ctx)), ['data:image/jpeg;base64,FULL'], 'data-full 直开大图');
  // 缩略图 → fetch attachment 取原图后开 + 气泡 src 升级（override vm 全局 fetch 返回附件）
  vm.runInContext(`
    fetch = async (url) => {
      if (String(url).includes('/attachment')) return { ok: true, status: 200, json: async () => ({ body: 'data:image/jpeg;base64,FULL' }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    window._thumbImg = null;
    (() => { const img = document.createElement('img'); img.src = 'data:image/jpeg;base64,THUMB'; window._thumbImg = img; })();
  `, ctx);
  await vm.runInContext('chatOpenImage(42, window._thumbImg)', ctx);
  assert.deepEqual(Array.from(vm.runInContext('window._viewed', ctx)), ['data:image/jpeg;base64,FULL', 'data:image/jpeg;base64,FULL'],
    '缩略图点击：拉原图后开大图');
  assert.equal(vm.runInContext('window._thumbImg.dataset.full', ctx), '1', '气泡 src 升级为原图（二次点击直开）');
});
