/**
 * 需求一（2026-08-08）·内生滚动条组件（v0.25.28）
 *
 * 全站统一滚动条：玻璃引擎前端树新增 --g-scroll-* 语义 token（constants THEME light/dark +
 * STYLE_PACKS.flat 覆盖），glass.css 两条引擎路径消费：
 *   - @supports not selector(::-webkit-scrollbar)（Firefox 等）：scrollbar-width:thin + 双色；
 *   - @supports selector(::-webkit-scrollbar)（Chromium/Safari）：标准属性复位 auto 防 Chrome 121+
 *     覆盖伪元素，webkit 伪元素掌权（胶囊 thumb + hover/active 增亮 + 恒显不隐藏）。
 *
 * 本测试断言：两条路径规则在位、token 单源（light/dark/flat 三处）、旧散装滚动条 CSS 已连根删。
 * 真实渲染由 playwright 计算样式验证（见实现时浏览器验证）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('glass.css：内生滚动条两条引擎路径在位（Firefox 细双色 / Chromium 胶囊伪元素 + 标准属性复位）', () => {
  const css = readFileSync('./glass.css', 'utf8');
  // Firefox / 无 webkit 引擎：标准属性细条
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\)/, 'Firefox 路径守卫在位');
  assert.match(css, /scrollbar-width:\s*thin/, 'Firefox 细滚动条');
  assert.match(css, /scrollbar-color:\s*var\(--g-scroll-thumb-strong\)\s*transparent/, 'Firefox 双色（用 strong 档保可见）');
  // Chromium 抛光路径：标准属性复位 auto（Chrome 121+ 非 auto 会覆盖伪元素——#1 坑）
  assert.match(css, /@supports selector\(::-webkit-scrollbar\)/, 'Chromium 路径守卫在位');
  assert.match(css, /\*\s*\{\s*scrollbar-width:\s*auto;\s*scrollbar-color:\s*auto;\s*\}/, '标准属性复位 auto（防 Chrome 121+ 覆盖伪元素）');
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--g-scroll-size\)/, 'webkit 伪元素宽吃 token');
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/, '胶囊 thumb（圆角钳制 width/2 → 999px 满圆）');
  assert.match(css, /background-clip:\s*padding-box/, '发丝内缩 = 悬浮胶囊');
  assert.match(css, /::-webkit-scrollbar-thumb:hover/, 'hover 增亮');
  assert.match(css, /::-webkit-scrollbar-thumb:active/, 'active 增亮');
  // 剥注释后断言无真实 scrollbar-width:none 规则（注释里的警示文案会误命中）
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/scrollbar-width:\s*none/.test(cssNoComment), '禁止 scrollbar-width:none（可发现性红线）');
});

test('滚动条 token 单源：THEME light/dark + flat 包覆盖，材质随外观包', () => {
  const sandbox = { console, setTimeout, Date, JSON, Math };
  sandbox.globalThis = sandbox;
  vm.runInContext(readFileSync('./constants.js', 'utf8'), vm.createContext(sandbox), { filename: 'constants.js' });
  const C = sandbox.APP_CONSTANTS;

  const light = C.THEME.light;
  const dark = C.THEME.dark;
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    assert.ok(t['--g-scroll-size'], `${name} 主题有 --g-scroll-size`);
    assert.ok(t['--g-scroll-thumb'], `${name} 主题有 --g-scroll-thumb`);
    assert.ok(t['--g-scroll-thumb-strong'], `${name} 主题有 --g-scroll-thumb-strong`);
    assert.ok(t['--g-scroll-thumb-active'], `${name} 主题有 --g-scroll-thumb-active`);
  }
  assert.equal(light['--g-scroll-size'], '8px', '液态滚动条 8px hit 区');
  assert.equal(dark['--g-scroll-size'], '8px', '暗色液态同 8px');

  const flat = C.STYLE_PACKS.flat.tokens;
  assert.equal(flat['--g-scroll-size'], '6px', '平面包收窄到 6px（发丝纤条）');
  assert.match(flat['--g-scroll-thumb'], /color-mix\(in srgb,\s*var\(--ink\)/, '平面滑块引主题 ink 半透明（深浅自适应）');
  assert.ok(flat['--g-scroll-thumb-strong'] && flat['--g-scroll-thumb-active'], '平面包 hover/active 档在位');
});

test('旧散装滚动条 CSS 已连根删（统一组件替代）', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(!/\.browse-list::-webkit-scrollbar/.test(css), '旧 .browse-list 滚动条组已删');
  assert.ok(!/\.custom-select-list::-webkit-scrollbar/.test(css), '旧 .custom-select-list 滚动条组已删');
  assert.ok(!/var\(--paper-3\)/.test(css.split('scrollbar')[1] || ''), '旧 thumb 纸面灰块已删');
});
