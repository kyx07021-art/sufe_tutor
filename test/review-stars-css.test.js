/**
 * C3（2026-08-26 全站同类缺陷扫描）：评价选星不可见——`.review-stars .star/.selected`
 * 零 CSS 规则，`setReviewStars` 切类无视觉反馈。
 *
 * 覆盖：
 *   - CSS 源级契约（D1）：features/teacher.css 必须含 .review-stars 容器规则、空态
 *     消费 --star-empty、.selected 消费 --star（复用 .stars 显示星同源 token，W6）；
 *   - 行为接线：setReviewStars 点击第 N 星 → 前 N 颗 .selected、其余清除（选星视觉状态）。
 *
 * G2 变异：删 .review-stars .star.selected 规则 → CSS 契约断言红；删 setReviewStars
 * 切类逻辑 → 行为断言红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { reviewModalHtml } from '../src/client/features/teacher/render.js';
import * as actions from '../src/client/features/teacher/actions.js';
import { setEnsureAuth } from '../src/client/core/api.js';

const teacherCss = readFileSync('./features/teacher.css', 'utf8');

test('C3: .review-stars 规则存在于 teacher.css（容器 + 空态灰 + selected 品牌星 token）', () => {
  assert.ok(teacherCss.includes('.review-stars {'), '.review-stars 容器规则');
  const starRule = teacherCss.split('.review-stars .star {')[1] || '';
  assert.ok(starRule.split('}')[0].includes('--star-empty'), '.review-stars .star 空态消费 --star-empty');
  const selRule = teacherCss.split('.review-stars .star.selected {')[1] || '';
  assert.ok(selRule.split('}')[0].includes('--star'), '.review-stars .star.selected 消费 --star');
});

test('C3: setReviewStars 切换 .selected 到点击星级（行为接线）', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  setEnsureAuth(() => true);

  document.getElementById('modal-container').innerHTML = reviewModalHtml();
  assert.equal(document.querySelectorAll('#review-stars .star').length, 5, '评星组件渲染 5 颗');
  const star3 = document.querySelector('#review-stars .star[data-rating="3"]');
  actions.setReviewStars(star3);
  assert.equal(document.querySelectorAll('#review-stars .star.selected').length, 3, '选 3 星 → 前 3 颗 .selected');
  const star5 = document.querySelector('#review-stars .star[data-rating="5"]');
  actions.setReviewStars(star5);
  assert.equal(document.querySelectorAll('#review-stars .star.selected').length, 5, '改选 5 星 → 前 5 颗 .selected');
  const star2 = document.querySelector('#review-stars .star[data-rating="2"]');
  actions.setReviewStars(star2);
  assert.equal(document.querySelectorAll('#review-stars .star.selected').length, 2, '改选 2 星 → 前 2 颗 .selected（旧 3/4/5 清除）');
});
