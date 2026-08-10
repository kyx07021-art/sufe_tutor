/**
 * v0.26.0 高频轻量日常审核通道（E1/E2）
 *
 * 覆盖：
 *   - isContentWrite：内容域写路径白名单（帖子/需求/档案/评价/反馈/投诉/注册/聊天消息/附件）；
 *   - auditBeforeWrite：恒放行（dummy 随机驳回 v0.26.3 已关闭，stub Math.random 极值验证）；
 *   - 300ms 预算：同步微秒级返回；队列处理即清栈（深度恒 0）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isContentWrite, auditBeforeWrite, auditQueueDepth } from '../server/audit-flow.js';

test('isContentWrite：内容域写路径白名单', () => {
  // 内容域写（POST/PUT）→ 过断点
  assert.equal(isContentWrite('/api/posts', 'POST'), true, '发帖');
  assert.equal(isContentWrite('/api/student/demands', 'POST'), true, '发布需求');
  assert.equal(isContentWrite('/api/teacher/profile', 'POST'), true, '保存教师档案');
  assert.equal(isContentWrite('/api/reviews', 'POST'), true, '提交评价');
  assert.equal(isContentWrite('/api/feedbacks', 'POST'), true, '提交反馈');
  assert.equal(isContentWrite('/api/complaints', 'POST'), true, '提交投诉');
  assert.equal(isContentWrite('/api/auth/register', 'POST'), true, '注册');
  assert.equal(isContentWrite('/api/uploads', 'POST'), true, '暂存附件');
  assert.equal(isContentWrite('/api/conversations/12/messages', 'POST'), true, '聊天消息');
  assert.equal(isContentWrite('/api/conversations/12/messages', 'PUT'), true, '聊天消息 PUT 变体');
  assert.equal(isContentWrite('/api/conversations/12/signing', 'POST'), true, '发起签约');
  assert.equal(isContentWrite('/api/signing-requests/5/respond', 'POST'), true, '签约请求回复（二次审查补漏）');
  assert.equal(isContentWrite('/api/demands/3/intents', 'POST'), true, '创建需求意向（二次审查补漏）');
  assert.equal(isContentWrite('/api/intents/9/resolve', 'POST'), true, '处理需求意向（二次审查补漏）');
  assert.equal(isContentWrite('/api/demand-pushes', 'POST'), true, '学生推送需求（二次审查补漏）');
  assert.equal(isContentWrite('/api/demand-pushes/8/resolve', 'POST'), true, '教师处理推送（二次审查补漏）');
  assert.equal(isContentWrite('/api/contracts', 'POST'), true, '起草合同');
  assert.equal(isContentWrite('/api/user/avatar', 'POST'), true, '上传头像');
  // 非内容写/读 → 不过断点
  assert.equal(isContentWrite('/api/posts', 'GET'), false, '读不审核');
  assert.equal(isContentWrite('/api/auth/login', 'POST'), false, '登录不是内容上传');
  assert.equal(isContentWrite('/api/notifications/read-all', 'POST'), false, '已读非内容');
  assert.equal(isContentWrite('/api/auth/logout', 'POST'), false, '登出非内容');
  assert.equal(isContentWrite('/api/health', 'GET'), false);
});

test('auditBeforeWrite：默认放行 + 300ms 预算 + 队列即清栈', async () => {
  const t0 = Date.now();
  const r = auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: 'x', body_md: 'y' }, ip: '1.2.3.4', userId: 7 });
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, true, 'dummy 默认放行');
  assert.ok(elapsed < 300, `全链路 ≤300ms（实测 ${elapsed}ms）`);
  assert.equal(auditQueueDepth(), 0, '处理即清栈（清栈速度远高于堆栈）');
  // 非内容路径直接放行不入队
  const r2 = auditBeforeWrite({ path: '/api/notifications/read-all', method: 'POST', body: {} });
  assert.equal(r2.ok, true);
});

test('auditBeforeWrite：dummy 恒放行（v0.26.3 随机驳回已关闭，stub Math.random 极值验证）', () => {
  const orig = Math.random;
  try {
    Math.random = () => 0; // 极值 0：即使随机值取最小也恒放行（旧逻辑此值必命中驳回）
    const r = auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '任意内容' }, ip: '9.9.9.9', userId: 3 });
    assert.equal(r.ok, true, '随机值 0 仍放行');
    assert.equal(r.reject, undefined);
    Math.random = () => 0.999; // 另一极值
    const r2 = auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: 'y' } });
    assert.equal(r2.ok, true, '随机值 0.999 仍放行');
  } finally { Math.random = orig; }
});
