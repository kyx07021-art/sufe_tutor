import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTeacherCard, renderProfilePanel, reviewModalHtml } from '../src/client/features/teacher/render.js';
import * as teacherActions from '../src/client/features/teacher/actions.js';
import { renderDemandCard, renderPushBtn } from '../src/client/features/student/render.js';
import * as studentActions from '../src/client/features/student/actions.js';

test('teacher render: card has data-action no inline', () => {
  const html = renderTeacherCard({ user_id: 1, real_name: '王老师', username: 'wang', rating: 4.5, subjects: ['math'], price_min: 100, price_max: 200, school: '上财' }, 0);
  assert.ok(html.includes('data-action="teacher.openProfile"'));
  assert.ok(!/onclick=/.test(html));
  assert.ok(!/style=/.test(html));
});

test('teacher render: profile panel and review modal non-empty', () => {
  assert.ok(renderProfilePanel({ real_name: '王老师', grade: 'senior1', school: '上财', price_min: 100, price_max: 200 }, '').includes('profile-panel'));
  assert.ok(reviewModalHtml().includes('review-stars'));
});

test('teacher actions: load/open/review functions exist', () => {
  assert.equal(typeof teacherActions.loadTeachers, 'function');
  assert.equal(typeof teacherActions.openProfilePanel, 'function');
  assert.equal(typeof teacherActions.submitReview, 'function');
});

test('student render: demand card uses data-action no inline', () => {
  const html = renderDemandCard({ id: 1, display_id: 1, student_grade: 'senior1', target_subjects: ['math'], budget_min: 100, budget_max: 200, created_at: '2026-08-17 12:00:00' });
  assert.ok(html.includes('data-action="student.openDemand"'));
  assert.ok(!/onclick=/.test(html));
});

test('student actions: demand functions exist', () => {
  assert.equal(typeof studentActions.loadMyDemands, 'function');
  assert.equal(typeof studentActions.loadBrowseDemands, 'function');
  assert.equal(typeof studentActions.handleSubmitDemand, 'function');
  assert.equal(typeof renderPushBtn, 'function');
});
