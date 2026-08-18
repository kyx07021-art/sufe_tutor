/**
 * 需求一 · 内生滚动条组件（B4：直接 import theme tokens）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME, STYLE_PACKS } from '../src/client/constants/theme.js';

test('glass.css：内生滚动条两条引擎路径在位（Firefox 细双色 / Chromium 胶囊伪元素 + 标准属性复位）', () => {
  const css = readFileSync('./glass.css', 'utf8');
  assert.match(css, /@supports not selector\(::-webkit-scrollbar\)/, 'Firefox 路径守卫在位');
  assert.match(css, /scrollbar-width:\s*thin/, 'Firefox 细滚动条');
  assert.match(css, /scrollbar-color:\s*var\(--g-scroll-thumb-strong\)\s*transparent/, 'Firefox 双色（用 strong 档保可见）');
  assert.match(css, /@supports selector\(::-webkit-scrollbar\)/, 'Chromium 路径守卫在位');
  assert.match(css, /\*\s*\{\s*scrollbar-width:\s*auto;\s*scrollbar-color:\s*auto;\s*\}/, '标准属性复位 auto（防 Chrome 121+ 覆盖伪元素）');
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--g-scroll-size\)/, 'webkit 伪元素宽吃 token');
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/, '胶囊 thumb（圆角钳制 width/2 → 999px 满圆）');
  assert.match(css, /background-clip:\s*padding-box/, '发丝内缩 = 悬浮胶囊');
  assert.match(css, /::-webkit-scrollbar-thumb:hover/, 'hover 增亮');
  assert.match(css, /::-webkit-scrollbar-thumb:active/, 'active 增亮');
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/scrollbar-width:\s*none/.test(cssNoComment), '禁止 scrollbar-width:none（可发现性红线）');
});

test('滚动条 token 单源：THEME light/dark + flat 包覆盖，材质随外观包', () => {
  for (const [name, t] of [['light', THEME.light], ['dark', THEME.dark]]) {
    assert.ok(t['--g-scroll-size'], `${name} 主题有 --g-scroll-size`);
    assert.ok(t['--g-scroll-thumb'], `${name} 主题有 --g-scroll-thumb`);
    assert.ok(t['--g-scroll-thumb-strong'], `${name} 主题有 --g-scroll-thumb-strong`);
    assert.ok(t['--g-scroll-thumb-active'], `${name} 主题有 --g-scroll-thumb-active`);
  }
  assert.equal(THEME.light['--g-scroll-size'], '8px', '液态滚动条 8px hit 区');
  assert.equal(THEME.dark['--g-scroll-size'], '8px', '暗色液态同 8px');
  const flat = STYLE_PACKS.flat.tokens;
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
