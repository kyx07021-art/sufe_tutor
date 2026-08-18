/**
 * 需求五 教师筛选栏间距规则（B4：数值直接 import shared/config，其余静态文件断言保留）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/shared/config.js';
import { STYLE_CSS } from './_css.js';

test('筛选栏间距：U3 合并单行后由 .filter-row gap 承担', () => {
  assert.ok(Number.isInteger(CONFIG.FILTER_ROW_GAP) && CONFIG.FILTER_ROW_GAP >= 8, `FILTER_ROW_GAP=${CONFIG.FILTER_ROW_GAP}`);
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes("set('--filter-row-gap'"));
  assert.ok(html.includes('C.FILTER_ROW_GAP'));
  const css = STYLE_CSS;
  const rowRule = css.split('.filter-row {')[1] || '';
  assert.ok(rowRule.split('}')[0].includes('gap: 16px'));
  assert.ok(!css.includes('.filter-row + .filter-row {'));
  const panelMatch = html.match(/id="demand-filter-panel"[\s\S]*?<\/div>\s*<\/div>/);
  const panel = panelMatch ? panelMatch[0] : '';
  assert.equal((panel.match(/class="filter-row"/g) || []).length, 1);
  assert.ok((panel.match(/id="demand-filter-/g) || []).length >= 4);
  const teaMatch = html.match(/id="teacher-filters"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/);
  const teaPanel = teaMatch ? teaMatch[0] : '';
  assert.equal((teaPanel.match(/class="filter-row"/g) || []).length, 1);
  assert.ok((teaPanel.match(/id="filter-(gender|subject|price|rating|method|day|verified)"/g) || []).length === 7);
  const grpCss = css.split('.filter-group {')[1] || '';
  assert.ok(grpCss.split('}')[0].includes('min-width: 100px'));
});
