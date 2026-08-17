/**
 * #162（v0.25.70）：markdown 解析器优化。B4：直接 import core/dom.mdRender。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdRender } from '../src/client/core/dom.js';

test('mdRender：无序/有序列表聚合为 ul/ol/li', () => {
  const html = mdRender('- 苹果\n- **香蕉**\n- 梨');
  assert.ok(html.includes('<ul>'), '无序列表容器');
  assert.ok(html.includes('<li>苹果</li>') && html.includes('<li><strong>香蕉</strong></li>'), '列表项 + 行内粗体');
  assert.equal(html.match(/<li>/g).length, 3, '三个列表项');
  const ol = mdRender('1. 第一步\n2. 第二步');
  assert.ok(ol.includes('<ol>') && ol.includes('<li>第一步</li>') && ol.includes('<li>第二步</li>'), '有序列表');
});

test('mdRender：引用（> 转义为 &gt; 后识别）聚合 blockquote', () => {
  const html = mdRender('> 第一行\n> 第二行');
  assert.ok(html.includes('<blockquote>'), '引用容器');
  assert.ok(html.includes('<p>第一行</p>') && html.includes('<p>第二行</p>'), '引用内段落');
  assert.ok(!html.includes('&gt;'), '引用标记已被消费不残留');
});

test('mdRender：行内代码占位保护（`` **x** `` 内部不误染粗体）', () => {
  const html = mdRender('用 `f(x)=**x**` 表示公式，外面 **加粗**');
  assert.ok(html.includes('<code>f(x)=**x**</code>'), '代码 span 原样，内部 ** 不转粗体');
  assert.ok(html.includes('<strong>加粗</strong>'), '代码外的粗体正常');
});

test('mdRender：链接 http/https 白名单 + rel noopener；javascript:/data: 原样文本', () => {
  const good = mdRender('[讲义](https://example.com/a?x=1&y=2)');
  assert.ok(good.includes('<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">讲义</a>'), 'http 链接转安全 a 标签（& 已转义）');
  const bad = mdRender('[点我](javascript:alert(1)) [图](data:text/html,hi)');
  assert.ok(!bad.includes('<a '), 'javascript:/data: 不生成链接');
  assert.ok(bad.includes('javascript:alert(1)'), '危险链接原样留作文本（已转义）');
});

test('mdRender：安全铁律——原文 HTML/事件属性全转义为文本', () => {
  const html = mdRender('<script>alert(1)</script> <img src=x onerror=alert(1)> [t](https://a.com)');
  assert.ok(!html.includes('<script>'), 'script 标签不注入');
  assert.ok(html.includes('&lt;script&gt;'), 'script 转义为文本');
  assert.ok(!html.includes('<img '), '无真实 img 标签（原文整块转义为文本）');
  assert.ok(html.includes('onerror='), '事件属性以转义文本形式显示（非可执行属性）');
});

test('mdRender：既有特性回归——标题/粗体/图片（svg 拦截）/段落', () => {
  const html = mdRender('## 标题\n\n正文 **粗** ![图](data:image/svg+xml,<x>) ![位](https://a.com/p.png)');
  assert.ok(html.includes('<h2>标题</h2>'), '标题');
  assert.ok(html.includes('<strong>粗</strong>'), '粗体');
  assert.ok(html.includes('md-img-blocked'), 'svg 图片拦截');
  assert.ok(html.includes('<img src="https://a.com/p.png"'), '位图放行');
});
