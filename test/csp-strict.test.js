/**
 * V-3-1d2 CSP 收口：web/index.html 严格 meta CSP + 注入面静态回归。
 * 锁定：
 *   1. meta CSP 存在且 script-src/style-src-elem 无 unsafe-inline（严格 script/style-elem）；
 *      style-src-attr 'unsafe-inline' 保留（CSSOM 自定义属性数据通道，c1/c2 依赖）。
 *   2. 最小化声明：不收紧 data:/blob: 通道（无 default-src，或声明 img-src 时含 data:）。
 *   3. 注入面第四路（<style> 元素）页面源码零存在——内联 script/onclick/style 三路已由
 *      csp-async-css.test.js + archtest 覆盖，不重复。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('web/index.html', 'utf8');
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
const csp = meta ? meta[1] : '';

test('严格 meta CSP：script-src/style-src-elem 无 unsafe-inline；style-src-attr 留数据通道；不收紧 data:/blob:', () => {
  assert.ok(meta, 'meta CSP 存在');
  assert.ok(/script-src 'self'(?!\s*'unsafe-inline')/.test(csp), 'script-src 仅 self（拦内联 script）');
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp), '无 unsafe-eval');
  assert.ok(/style-src-elem 'self'(?!\s*'unsafe-inline')/.test(csp), 'style-src-elem 仅 self（拦 <style> 元素与内联样式表）');
  assert.ok(/style-src-attr 'unsafe-inline'/.test(csp), 'style-src-attr 留 unsafe-inline（CSSOM 数据通道）');
  assert.ok(!/default-src/.test(csp) || /img-src[^;]*data:/.test(csp),
    '最小化声明：无 default-src，或声明 img-src 时含 data:（防交集收紧 _headers 的 img-src data: blob: / font-src）');
});

test('注入面第四路：web/index.html 零 <style> 元素', () => {
  // 匹配完整 <style> 元素（含闭合标签）——注释文本里的 "<style>" 字面量不算注入面
  assert.ok(!/<style[\s>][\s\S]*?<\/style>/i.test(html), '零 <style> 元素（动态样式已全迁 CSS 变量数据通道，c1/c2）');
});
