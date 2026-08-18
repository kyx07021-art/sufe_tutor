/**
 * 需求十九（R19）·隐私设置大标题与首设置项间双分割线删一条
 *
 * 根因：防双线规则 `.settings-section-title + .settings-row` / `+ * > .settings-row:first-child`
 * 只覆盖「标题的直接兄弟」；隐私区首项被 `.settings-list > #privacy-settings-list` 包一层，
 * 选择器够不着 → 标题 border-bottom + 首行 border-top 双线。
 *
 * 修复：补 `.settings-section-title + .settings-list .settings-row:first-child { border-top: none }`
 * （Chrome 实证：隐私区首行 bt 0px，其余行 1px）。
 *
 * 本测试为 CSS 内容回归护栏。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STYLE_CSS } from './_css.js';

const css = STYLE_CSS;

test('R19 隐私区首行无上边线（标题单一分割线）', () => {
  assert.ok(/\.settings-section-title \+ \.settings-list \.settings-row:first-child \{ border-top: none; \}/.test(css),
    '补隐私区首行去上边线规则');
});

test('R19 既有防双线规则仍保留（账户/外观区直接兄弟首行）', () => {
  assert.ok(/\.settings-section-title \+ \* > \.settings-row:first-child/.test(css), '通用首行规则保留');
  assert.ok(/\.settings-section-title \+ \.settings-row \{ border-top: none; \}/.test(css), '直接兄弟首行规则保留');
});
