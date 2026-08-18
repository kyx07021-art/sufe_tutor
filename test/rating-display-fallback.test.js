/**
 * R16 前端评分显示兜底 4.0 → 4.5（B4：直接 import core/display）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingText, starsHtml } from '../src/client/features/teacher/display.js';

test('R16 starsHtml/ratingText 缺省显示 4.5', () => {
  assert.equal(ratingText(''), '4.5', '空值兜底 4.5');
  assert.equal(ratingText(undefined), '4.5', 'undefined 兜底 4.5');
  const stars = starsHtml(undefined);
  assert.equal((stars.match(/class="star filled"/g) || []).length, 5, '缺省 4.5 → 四舍五入 5 星满');
  assert.equal(ratingText(3.6), '3.6', '有值照实显示');
});
