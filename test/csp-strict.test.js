/**
 * V-3-1d2 + V-4-1h h5a-g6 CSP 收口：web/index.html 严格 meta CSP + 注入面静态回归 + 两处策略姿态锁。
 * 锁定：
 *   1. meta CSP 存在且 script-src/style-src-elem/style-src-attr 均无 unsafe-inline（严格 script/style；
 *      style-src-attr 'none'——h5a-g6 实测定案：CSSOM cssText/setProperty 不受该指令管辖，app 零内联 style 属性）。
 *   2. 最小化声明：不收紧 data:/blob: 通道（无 default-src，或声明 img-src 时含 data:）。
 *   3. 注入面第三路（<style> 元素）页面源码零存在——内联 script/onclick/style 属性三路已由
 *      csp-async-css.test.js + archtest 覆盖，不重复（四路全拦的浏览器实测在 verify-csp-strict）。
 *   4. _headers 与 SECURITY_HEADERS 的 CSP 姿态锁（g1 审计缺口 2：防"改 _headers 漏 config.js"再犯）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('web/index.html', 'utf8');
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
const csp = meta ? meta[1] : '';

function extractDirective(policy, name) {
  const part = policy.split(';').map(s => s.trim()).find(s => s.split(/\s+/)[0] === name);
  return part ? part.split(/\s+/).slice(1).join(' ') : null;
}

test('严格 meta CSP：script-src/style-src-elem/style-src-attr 无 unsafe-inline；style-src-attr 为 none；不收紧 data:/blob:', () => {
  assert.ok(meta, 'meta CSP 存在');
  assert.ok(/script-src 'self'(?!\s*'unsafe-inline')/.test(csp), 'script-src 仅 self（拦内联 script）');
  assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp), '无 unsafe-eval');
  assert.ok(/style-src-elem 'self'(?!\s*'unsafe-inline')/.test(csp), 'style-src-elem 仅 self（拦 <style> 元素与内联样式表）');
  assert.ok(/style-src-attr 'none'/.test(csp), 'style-src-attr 为 none（h5a-g6：CSSOM 不受辖，app 零内联 style 属性）');
  assert.ok(!/style-src-attr[^;]*'unsafe-inline'/.test(csp), 'style-src-attr 无 unsafe-inline（h5a-g6 收紧）');
  assert.ok(!/default-src/.test(csp) || /img-src[^;]*data:/.test(csp),
    '最小化声明：无 default-src，或声明 img-src 时含 data:（防交集收紧 _headers 的 img-src data: blob:）');
  const dirs = csp.split(';').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
  assert.equal(new Set(dirs).size, dirs.length, '无重复指令（审计 O1：防分号后追加同指令等效放宽，如 ; script-src \'unsafe-inline\'）');
});

test('两处策略姿态锁：_headers 与 SECURITY_HEADERS 的 CSP 同姿态（script-src/style-src-elem 无 unsafe-inline、style-src-attr none、无 font-src）', () => {
  const headersPolicy = readFileSync('_headers', 'utf8').match(/Content-Security-Policy: ([^\n]+)/)?.[1] ?? '';
  const configPolicy = readFileSync('src/shared/config.js', 'utf8').match(/Content-Security-Policy['"]:\s*"([^"]+)"/)?.[1] ?? '';
  assert.ok(headersPolicy && configPolicy, '两处策略均存在');
  for (const [label, p] of [['_headers', headersPolicy], ['SECURITY_HEADERS', configPolicy]]) {
    assert.ok(extractDirective(p, 'script-src') === "'self'", `${label} script-src 仅 'self'（无 unsafe-inline）`);
    assert.ok(extractDirective(p, 'style-src-elem') === "'self'", `${label} style-src-elem 仅 'self'`);
    assert.ok(extractDirective(p, 'style-src-attr') === "'none'", `${label} style-src-attr 为 'none'`);
    assert.ok(!/font-src/.test(p) && !/fonts\.google/.test(p), `${label} 无 font-src/fonts.googleapis`);
  }
  assert.equal(headersPolicy, configPolicy, '两处策略逐字一致（同源同姿态）');
});

test('注入面第三路：web/index.html 零 <style> 元素', () => {
  // 匹配完整 <style> 元素（含闭合标签）——注释文本里的 "<style>" 字面量不算注入面
  assert.ok(!/<style[\s>][\s\S]*?<\/style>/i.test(html), '零 <style> 元素（动态样式已全迁 CSS 变量数据通道，c1/c2）');
});
