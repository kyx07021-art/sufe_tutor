/**
 * reviewStatusMeta + renderProfileReviewsCard 状态标签回归
 * （V-2-4b 审计观察项修复：旧 reviewStatusTagHtml 返回 HTML 串，consumer 对字符串取
 *  .cls/.text 得到 undefined，线上渲染「undefined」；改为 {text, cls} 形状 + 未知态省略标签）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewStatusMeta } from '../src/client/features/teacher/display.js';
import { renderProfileReviewsCard } from '../src/client/features/teacher/render.js';

test('reviewStatusMeta: approved/rejected/pending -> {text, cls}; unknown -> null', () => {
  assert.deepEqual(reviewStatusMeta('approved'), { text: '已通过', cls: 'tag-ok' });
  assert.deepEqual(reviewStatusMeta('rejected'), { text: '已拒绝', cls: 'tag-danger' });
  assert.deepEqual(reviewStatusMeta('pending'), { text: '待审核', cls: 'tag-warn' });
  assert.equal(reviewStatusMeta('whatever'), null, '未知态返回 null（调用方省略标签）');
});

test('renderProfileReviewsCard: 已知态渲染 tag 类名+文案，未知态省略标签，无 undefined 泄漏', () => {
  const base = { reviewer_name: 't', rating: 5, comment: '好', created_at: '2026-01-01 00:00:00' };
  const approved = renderProfileReviewsCard({ ...base, status: 'approved' });
  assert.ok(approved.includes('tag-ok'), 'approved -> tag-ok 类');
  assert.ok(approved.includes('已通过'), 'approved -> 已通过 文案');
  assert.ok(!approved.includes('undefined'), '无 undefined 泄漏');
  const pending = renderProfileReviewsCard({ ...base, status: 'pending' });
  assert.ok(pending.includes('tag-warn') && pending.includes('待审核'), 'pending -> tag-warn 待审核');
  const unknown = renderProfileReviewsCard({ ...base, status: 'weird' });
  assert.ok(!unknown.includes('tag-ok') && !unknown.includes('undefined'), '未知态不渲染标签');
});
