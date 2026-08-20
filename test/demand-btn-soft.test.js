/**
 * 需求十一·按钮统一外观组件（R11：需求列表「编辑」/「试课意向」等卡片动作按钮）
 * B4：直接 import student feature ESM；v1 onclick 断言改为 v2 data-action 委托断言。
 *
 * 覆盖：教师视角意向四态（cta/wait/ok）均 btn-soft；学生可编辑视角编辑/重开 btn-soft；
 * 推送拒收/接收 btn-soft；意图展开按钮 btn-soft；意向行查看/同意/拒绝 btn-soft；
 * 管理员 contracted 也渲染移除按钮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDemandCard, renderIntentTeacherRow } from '../src/client/features/student/render.js';

// 基础需求卡夹具（各态按钮走同一 renderDemandCard 分支）
function renderCard(extra, opts) {
  return renderDemandCard({
    id: 2, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1',
    student_gender: 'female', province: 'shanghai', budget_min: 100, budget_max: 200,
    current_scores: [], teaching_method: 'offline', expected_time: '', status: 'open',
    username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09',
    ...extra,
  }, opts);
}

test('R11 教师视角意向按钮四态统一 .btn-soft（无 btn-outline/裸 btn 散装）', () => {
  // 未提交 → cta（可点）
  const cta = renderCard({ my_intent_status: '' }, { teacher: true });
  assert.ok(cta.includes('btn-soft'), '未提交意向 = btn-soft');
  assert.ok(cta.includes('btn-intent-cta'), 'cta 语义类保留（新手引导目标依赖）');
  assert.ok(cta.includes('data-action="student.submitIntent" data-id="2" data-demand-id="2"'), 'cta 走委托且带 data-demand-id（doSubmitIntent 乐观替换契约）');
  assert.ok(!cta.includes('btn-outline'), '不再用 btn-outline');
  // 待处理 / 未获选 → wait（disabled）
  for (const st of ['pending', 'rejected']) {
    const html = renderCard({ my_intent_status: st }, { teacher: true });
    assert.ok(html.includes('btn-soft') && html.includes('btn-intent-wait'), `${st} = btn-soft + wait`);
    assert.ok(!html.includes('btn-outline'), `${st} 不用 btn-outline`);
  }
  // 已建立联系 → ok（R26：可点击跳会话，不再是静态禁用按钮）
  const ok = renderCard({ my_intent_status: 'accepted', user_id: 39 }, { teacher: true });
  assert.ok(ok.includes('btn-soft') && ok.includes('btn-intent-ok'), 'accepted = btn-soft + ok');
  assert.ok(ok.includes('data-action="student.goChat" data-id="39"'), 'R26：点击跳对应会话');
  assert.ok(!ok.includes(' disabled'), 'R26：不再静态禁用');
  assert.ok(!ok.includes('btn-outline'), 'accepted 不用 btn-outline');
});

test('R11 学生可编辑视角：编辑/重开按钮统一 .btn-soft', () => {
  const edit = renderCard({}, { editable: true });
  assert.ok(edit.includes('btn-soft') && edit.includes('data-action="student.editDemand" data-id="2"'), '编辑 = btn-soft + 委托');
  assert.ok(!edit.includes('btn-outline'), '编辑不再 btn-outline');
  const reopen = renderCard({ status: 'revoked' }, { editable: true });
  assert.ok(reopen.includes('btn-soft') && reopen.includes('data-action="student.reopenDemand" data-id="2"'), '重开 = btn-soft + 委托');
});

test('R11 推送动作：拒收/接收统一 .btn-soft', () => {
  const html = renderCard({}, { teacher: true, push: { push_id: 9, push_created_at: '2026-08-08 10:00:00' } });
  assert.ok(html.includes('data-action="student.resolvePush" data-id="9" data-result="reject"') && html.includes('btn-soft'), '推送拒收 = btn-soft');
  assert.ok(html.includes('data-action="student.resolvePush" data-id="9" data-result="accept"') && html.includes('btn-soft'), '推送接收 = btn-soft');
  assert.ok(!html.includes('btn-outline'), '推送动作不再 btn-outline');
});

test('v0.31.5 P4 补：my-demands 卡片「试课意向」展开按钮接 .btn-soft 组件（原 .drop-toggle 实心面）', () => {
  const html = renderCard({ intent_count: 3 }, { editable: true });
  assert.ok(html.includes('btn-intent-toggle'), '意图展开按钮挂 btn-intent-toggle 类（引导/移动端定位）');
  assert.ok(html.includes('btn-soft') && html.includes('btn-sm'), '意图展开按钮走 btn-soft btn-sm 按钮组件（与编辑按钮同族）');
  assert.ok(!html.includes('drop-toggle'), '不再用 .drop-toggle 实心面（与编辑按钮观感统一）');
  assert.ok(html.includes('data-action="student.toggleIntents" data-id="2"'), 'toggle 展开走委托');
  assert.ok(html.includes('id="intent-toggle-2"'), '展开按钮 id 锚点保留（toggleDemandIntents 依赖）');
  assert.ok(html.includes('id="intent-dot-2"'), '红点 id 锚点保留');
});

test('v0.25.94 意向行动作统一 btn-soft：查看/同意/拒绝（原 btn-outline/裸 btn 混搭）', () => {
  const row = renderIntentTeacherRow({ user_id: 5, username: '张老师', rating: 4.5, province: 'shanghai',
    price_min: 100, price_max: 200, intent_id: 11, intent_status: 'pending' }, 2);
  assert.ok(row.includes('data-action="student.viewProfile" data-id="5"') && row.includes('btn-soft'), '查看 = btn-soft（原 btn-outline）');
  assert.ok(row.includes('data-action="student.acceptIntent" data-demand="2" data-teacher="5"') && row.includes('btn-soft'), '同意 = btn-soft（原裸 btn 无边框）');
  assert.ok(row.includes('data-action="student.rejectIntent" data-demand="2" data-teacher="5"') && row.includes('btn-soft'), '拒绝 = btn-soft（原 btn-outline）');
  assert.ok(!row.includes('btn-outline') && !row.includes('class="btn btn-xs'), '意向行无 btn-outline/裸 btn 残留');
});

// v0.25.95（调试阶段放开）：管理员移除按钮放开到全部状态（含已签约 contracted）
test('管理员视角：contracted 需求也渲染移除按钮（v0.25.95 放开）', () => {
  const adminContracted = renderCard({ status: 'contracted' }, { admin: true });
  assert.ok(adminContracted.includes('data-action="admin.deleteDemand" data-id="2"'), 'contracted 需求管理员可见移除按钮（U-3b：admin 走 /api/admin/demands/:id）');
  assert.ok(adminContracted.includes('btn-soft'), '移除按钮走 btn-soft 统一外观');
  // 非管理员学生视角：contracted 仍不可编辑/下架（编辑门禁未动）
  const studentOwned = renderCard({ status: 'contracted' }, { editable: true });
  assert.ok(!studentOwned.includes('student.deleteDemand'), '学生不可删 contracted');
  assert.ok(!studentOwned.includes('student.editDemand'), '学生不可编辑 contracted');
});
