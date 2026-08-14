/**
 * #162（v0.25.70）：markdown 解析器优化
 * 安全铁律：先 escHtml 全转义，正则只作用在转义串上、只产出白名单固定标签。
 * 覆盖：列表（无序/有序）、引用（escHtml 后 > 为 &gt;）、行内代码占位保护（防 ** 误染）、
 * 链接 http/https 白名单（javascript:/data: 不匹配即原样文本）、HTML 注入转义、既有特性回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, crypto: globalThis.crypto, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}

function loadCommon(ctx) {
  for (const f of ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-posts.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
}

test('mdRender：无序/有序列表聚合为 ul/ol/li', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext(`mdRender('- 苹果\\n- **香蕉**\\n- 梨')`, ctx);
  assert.ok(html.includes('<ul>'), '无序列表容器');
  assert.ok(html.includes('<li>苹果</li>') && html.includes('<li><strong>香蕉</strong></li>'), '列表项 + 行内粗体');
  assert.equal(html.match(/<li>/g).length, 3, '三个列表项');
  const ol = vm.runInContext(`mdRender('1. 第一步\\n2. 第二步')`, ctx);
  assert.ok(ol.includes('<ol>') && ol.includes('<li>第一步</li>') && ol.includes('<li>第二步</li>'), '有序列表');
});

test('mdRender：引用（> 转义为 &gt; 后识别）聚合 blockquote', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext(`mdRender('> 第一行\\n> 第二行')`, ctx);
  assert.ok(html.includes('<blockquote>'), '引用容器');
  assert.ok(html.includes('<p>第一行</p>') && html.includes('<p>第二行</p>'), '引用内段落');
  assert.ok(!html.includes('&gt;'), '引用标记已被消费不残留');
});

test('mdRender：行内代码占位保护（`` **x** `` 内部不误染粗体）', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext('mdRender("用 `f(x)=**x**` 表示公式，外面 **加粗**")', ctx);
  assert.ok(html.includes('<code>f(x)=**x**</code>'), '代码 span 原样，内部 ** 不转粗体');
  assert.ok(html.includes('<strong>加粗</strong>'), '代码外的粗体正常');
});

test('mdRender：链接 http/https 白名单 + rel noopener；javascript:/data: 原样文本', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const good = vm.runInContext('mdRender("[讲义](https://example.com/a?x=1&y=2)")', ctx);
  assert.ok(good.includes('<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">讲义</a>'), 'http 链接转安全 a 标签（& 已转义）');
  const bad = vm.runInContext('mdRender("[点我](javascript:alert(1)) [图](data:text/html,hi)")', ctx);
  assert.ok(!bad.includes('<a '), 'javascript:/data: 不生成链接');
  assert.ok(bad.includes('javascript:alert(1)'), '危险链接原样留作文本（已转义）');
});

test('mdRender：安全铁律——原文 HTML/事件属性全转义为文本', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext('mdRender("<script>alert(1)</script> <img src=x onerror=alert(1)> [t](https://a.com)")', ctx);
  assert.ok(!html.includes('<script>'), 'script 标签不注入');
  assert.ok(html.includes('&lt;script&gt;'), 'script 转义为文本');
  assert.ok(!html.includes('<img '), '无真实 img 标签（原文整块转义为文本）');
  assert.ok(html.includes('onerror='), '事件属性以转义文本形式显示（非可执行属性）');
});

test('mdRender：既有特性回归——标题/粗体/图片（svg 拦截）/段落', () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  const html = vm.runInContext('mdRender("## 标题\\n\\n正文 **粗** ![图](data:image/svg+xml,<x>) ![位](https://a.com/p.png)")', ctx);
  assert.ok(html.includes('<h2>标题</h2>'), '标题');
  assert.ok(html.includes('<strong>粗</strong>'), '粗体');
  assert.ok(html.includes('md-img-blocked'), 'svg 图片拦截');
  assert.ok(html.includes('<img src="https://a.com/p.png"'), '位图放行');
});
