/**
 * R13 教师卡片头像惰性装饰回归（B4：直接 import core/dom + teacher render）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderAvatarHtml } from '../src/client/core/dom.js';
import { renderTeacherCard } from '../src/client/features/teacher/render.js';
import { state } from '../src/client/core/state.js';
import { TEXT } from '../src/client/constants/text.js';
import { STYLE_CSS } from './_css.js';

test('R13 renderAvatarHtml 非交互分支：恒 aria-hidden、无 avatar-btn/role/tabindex', () => {
  const img = renderAvatarHtml('/a.png', '张老师', 'tc-avatar');
  assert.ok(img.includes('aria-hidden="true"'));
  assert.ok(!img.includes('avatar-btn'));
  assert.ok(!img.includes('tabindex'));
  const letter = renderAvatarHtml('', '张老师', 'tc-avatar');
  assert.ok(letter.includes('aria-hidden="true"'));
  assert.ok(letter.includes('>张<'));
});

test('R13 renderAvatarHtml 交互分支（profileUserId）：avatar-btn + role/tabindex', () => {
  const html = renderAvatarHtml('/a.png', '张老师', 'demand-avatar', 7);
  assert.ok(html.includes('avatar-btn'));
  assert.ok(html.includes('role="button"') && html.includes('tabindex="0"'));
  assert.ok(!html.includes('aria-hidden="true"'));
});

test('R13 教师卡渲染：头像为非交互惰性组件', () => {
  state.user = { id: 1, role: 'student', username: '学生' };
  const html = renderTeacherCard({ user_id: 3, username: '张老师', avatar: '/a.png', verified: 0, rating: 4.5, subjects: ['math'], school: '' }, 0);
  state.user = null;
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(!html.includes('avatar-btn'));
});

test('ZO-5 教师卡零认证 tag：renderTeacherCard 不含 VERIFIED_BADGE/VERIFIED_TITLE', () => {
  state.user = { id: 1, role: 'student', username: '学生' };
  const html = renderTeacherCard({ user_id: 3, username: '张老师', avatar: '/a.png', verified: 1, rating: 4.5, subjects: ['math'], school: '' }, 0);
  state.user = null;
  assert.ok(!html.includes(TEXT.VERIFIED_BADGE), 'verified=1 不渲染认证徽章文案');
  assert.ok(!html.includes(TEXT.VERIFIED_TITLE), '不渲染认证 title 属性');
  // 变异推理：还原 renderTeacherCard 的 ${t.verified ? ...VERIFIED_BADGE... : ''} 段 →
  // 两条断言全红（G2）。t.verified 数据字段保留不动（仅渲染移除）。
});

test('R13 .tc-avatar CSS：pointer-events:none + user-select:none', () => {
  const css = STYLE_CSS;
  const block = css.match(/\.tc-avatar \{[\s\S]*?\}/);
  assert.ok(block, '.tc-avatar 规则存在');
  assert.ok(/pointer-events:\s*none/.test(block[0]));
  assert.ok(/user-select:\s*none/.test(block[0]));
});
