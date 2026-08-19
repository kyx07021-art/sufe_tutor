/**
 * 需求五 教师筛选栏间距规则（B4：数值直接 import shared/config；V-4-1h 迁移：v1 静态壳已删，
 * DOM 结构断言改走 v2 源——shell.js 渲染筛选面板、browse.css 间距规则、appearance.js 注入变量）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/shared/config.js';
import { STYLE_CSS } from './_css.js';

const shell = readFileSync('./src/client/core/shell.js', 'utf8');
const appearance = readFileSync('./src/client/core/appearance.js', 'utf8');
const browse = readFileSync('./features/browse.css', 'utf8');

test('筛选栏间距：U3 合并单行后由 .filter-row gap 承担', () => {
  assert.ok(Number.isInteger(CONFIG.FILTER_ROW_GAP) && CONFIG.FILTER_ROW_GAP >= 8, `FILTER_ROW_GAP=${CONFIG.FILTER_ROW_GAP}`);
  // 单源注入：appearance.js 把 CONFIG.FILTER_ROW_GAP 注入 --filter-row-gap 变量
  assert.ok(appearance.includes("setProperty('--filter-row-gap', String(CONFIG.FILTER_ROW_GAP || 16) + 'px')"),
    '--filter-row-gap 由 appearance.js 从 CONFIG 单源注入');
  // 间距规则：.filter-row 单行 flex + gap 16px（v2 合并单行后无纵向空隙类）
  const rowRule = browse.split('.filter-row {')[1] || '';
  assert.ok(rowRule.split('}')[0].includes('gap: 16px'), '.filter-row gap 16px');
  assert.ok(rowRule.split('}')[0].includes('flex-wrap: wrap'), '.filter-row 换行');
  assert.ok(!STYLE_CSS.includes('.filter-row + .filter-row {'), '无上下两排纵向空隙规则');
  // 面板容器规则仍在（glass 承重面）
  const panelRule = browse.split('.filter-panel {')[1] || '';
  assert.ok(panelRule.split('}')[0].includes('padding: 18px'), '.filter-panel 内边距');
});

test('筛选面板 DOM（v2 源）：demand-filter-panel 四组筛选 + teacher-filters 容器就位', () => {
  // v2 客户端壳（shell.js 渲染）：需求筛选面板 4 组 + 教师筛选 drop-wrap（面板内容由教师域渲染，parity 待办）
  assert.ok(shell.includes('id="demand-filter-panel"'), 'shell.js 渲染需求筛选面板');
  assert.ok((shell.match(/id="demand-filter-/g) || []).length >= 4, '需求筛选 ≥4 组（subject/grade/method/province）');
  assert.ok(shell.includes('id="teacher-filters"'), 'shell.js 渲染教师筛选容器');
  // 教师筛选 7 组 id 消费点仍在（actions.js 读取 filter-method/filter-day/filter-verified）
  const teaActions = readFileSync('./src/client/features/teacher/actions.js', 'utf8');
  for (const id of ['filter-method', 'filter-day', 'filter-verified']) {
    assert.ok(teaActions.includes(id), `教师筛选读取 ${id}`);
  }
});

test('筛选组规则：.filter-group 下拉栏紧凑布局', () => {
  const grpCss = STYLE_CSS.split('.filter-group {')[1] || '';
  assert.ok(grpCss.split('}')[0].includes('min-width: 100px'), '.filter-group min-width');
  assert.ok(STYLE_CSS.includes('.filter-group .custom-select'), 'filter-group 内下拉栏布局规则');
});
