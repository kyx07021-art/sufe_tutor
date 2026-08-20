/**
 * Z-13-F1：admin 客户端行为测试——loadAdminUsers/loadAdminContent/loadAdminFeedback
 * 拉取 + 渲染链路、renderAdminReviewRow/renderAdminContentRow 结构（data-action 委托按钮）、
 * openContentPenaltyModal 弹窗内容。既有 client-feature-settings-admin-onboard.test.js 只做
 * 存在性冒烟，本测试锁真实行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadAdminUsers, loadAdminContent, loadAdminFeedback, renderAdminReviewRow, renderAdminContentRow, openContentPenaltyModal, renderAdminUserRow, toggleTeacherVerify, generateInviteCode, openInviteManager, revokeInvite, loadAdminDemands, adminDeleteDemand, loadAdminReviews, renderAdminAwardRow, loadAdminAwards, viewAwardProof, approveAward, rejectAwardModal, doAwardAction, loadAdminVerifications, renderVerifCard, renderVerifForm, verifApprove, verifReject, verifRejectConfirm, verifRevoke, viewAdmissionImage, loadAdminPosts, renderAdminPostRow, openPostViewModal, performVerifAction } from '../src/client/features/admin/actions.js';
import { state } from '../src/client/core/state.js';
import { _dhResetForTests } from '../src/client/core/datahub.js';

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  state.user = { id: 1, role: 'admin', username: 'admin_sufe' };
  state.authToken = 'tok-admin';
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window; delete globalThis.MutationObserver;
  delete globalThis.fetch;
}

test('loadAdminUsers：拉取后渲染用户名行到列表容器', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-students-list'; // U-3a: loadAdminUsers resolves per-role container id (was admin-users-list)
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/users?role=student'), '带 role 参数');
    return { ok: true, status: 200, json: async () => ({ users: [{ id: 11, username: '学生甲', role: 'student' }, { id: 12, username: '学生乙', role: 'student' }] }) };
  };
  await loadAdminUsers('student');
  assert.ok(list.innerHTML.includes('学生甲') && list.innerHTML.includes('学生乙'), '两行用户名渲染');
  teardown();
});

test('loadAdminContent：按 type 拉取并渲染内容行', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-content-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/content?type=post'), 'type 下推');
    return { ok: true, status: 200, json: async () => ({ items: [{ id: 7, title: '某帖子', type: 'post' }] }) };
  };
  await loadAdminContent('post');
  assert.ok(list.innerHTML.includes('某帖子'), '内容行渲染');
  assert.ok(list.querySelector('[data-action="admin.penalty"]'), '处罚按钮 data-action 委托');
  teardown();
});

test('loadAdminFeedback：渲染反馈标题列表', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-feedback-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: [{ id: 3, title: '登录问题反馈' }] }) });
  await loadAdminFeedback();
  assert.ok(list.innerHTML.includes('登录问题反馈'), '反馈标题渲染');
  teardown();
});

test('renderAdminReviewRow pending：教师←评价者 + 星级 + 状态 tag + approve/reject 委托按钮', () => {
  const html = renderAdminReviewRow({ id: 9, status: 'pending', teacher_name: '教师乙', reviewer_name: '学生甲', rating: 5, comment: '评价内容', created_at: '2026-08-01 12:00:00' });
  assert.ok(html.includes('教师乙') && html.includes('学生甲'), '教师←评价者');
  assert.ok(html.includes('★'), '星级');
  assert.ok(html.includes('待审核'), '状态 tag');
  assert.ok(html.includes('评价内容'), '评论文本');
  assert.ok(html.includes('注册于') || html.includes('2026'), '时间 meta');
  assert.ok(html.includes('data-action="admin.approveReview" data-id="9"'), '通过按钮委托');
  assert.ok(html.includes('data-action="admin.rejectReview" data-id="9"'), '拒绝按钮委托');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('renderAdminReviewRow 非 pending：无审核按钮 + 状态 tag（U-3c 显隐）', () => {
  const approved = renderAdminReviewRow({ id: 10, status: 'approved', teacher_name: '教师乙', reviewer_name: '学生甲', rating: 4, comment: '通过', created_at: '2026-08-01 12:00:00' });
  assert.ok(approved.includes('已通过'), 'approved tag');
  assert.ok(!approved.includes('data-action="admin.approveReview"'), 'approved 无通过按钮');
  assert.ok(!approved.includes('data-action="admin.rejectReview"'), 'approved 无拒绝按钮');
  const rejected = renderAdminReviewRow({ id: 11, status: 'rejected', teacher_name: '教师丙', reviewer_name: '学生乙', rating: 2, comment: '拒', created_at: '2026-08-01 12:00:00' });
  assert.ok(rejected.includes('已拒绝'), 'rejected tag');
  assert.ok(!rejected.includes('data-action="admin.approveReview"'), 'rejected 无审核按钮');
});

test('U-3c loadAdminReviews：带 status 参数请求 + 渲染（G2 删 status 下推必红）', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-reviews-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/reviews?status=pending'), 'status 参数下推');
    return { ok: true, status: 200, json: async () => ({ reviews: [{ id: 12, status: 'pending', teacher_name: '教师', reviewer_name: '学生', rating: 5, comment: '好', created_at: '2026-08-01 12:00:00' }] }) };
  };
  await loadAdminReviews('pending');
  assert.ok(list.innerHTML.includes('好'), '评价渲染');
  teardown();
});

test('renderAdminContentRow：标题 + 处罚按钮 data-action/data-id/data-type', () => {
  const html = renderAdminContentRow({ id: 5, title: '违规帖子', type: 'post' });
  assert.ok(html.includes('违规帖子'), '标题');
  assert.ok(html.includes('data-action="admin.penalty" data-id="5" data-type="post"'), '处罚按钮完整委托');
});

test('openContentPenaltyModal：危险操作弹窗含理由输入 + 确认按钮', () => {
  const dom = setup();
  openContentPenaltyModal(21, 'post');
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '弹窗出现');
  assert.ok(modal.querySelector('#penalty-reason'), '理由 textarea');
  assert.ok(modal.querySelector('[data-action="admin.submitPenalty"][data-id="21"][data-type="post"]'), '确认按钮带 id/type');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3a：用户管理页——renderAdminUserRow v1-parity（学生/教师行）、
// loadAdminUsers 搜索参数、confirmBanUser 按页刷新。G2：删 meta/按钮必红。
// ─────────────────────────────────────────────────────────────

test('U-3a renderAdminUserRow 学生行：用户名 + 需求数 + 注册时间 + 封禁按钮委托', () => {
  const html = renderAdminUserRow({ id: 7, username: '学生甲', role: 'student', banned: 0, created_at: '2026-08-01 12:00:00', demand_count: 3 }, 'student');
  assert.ok(html.includes('学生甲'), '用户名');
  assert.ok(html.includes('3条需求') || html.includes('3 条需求'), '需求数 meta');
  assert.ok(html.includes('注册于'), '注册时间前缀');
  assert.ok(html.includes('data-action="admin.banUser" data-id="7" data-banned="1"'), '封禁按钮委托（banned=1）');
  assert.ok(!html.includes('data-action="admin.viewProfile"'), '学生行无查看详情');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('U-3a renderAdminUserRow 已封禁学生：显示封禁 tag + 解封按钮（banned=0）', () => {
  const html = renderAdminUserRow({ id: 8, username: '封禁者', role: 'student', banned: 1, created_at: '2026-08-01 12:00:00' }, 'student');
  assert.ok(html.includes('已封禁'), '封禁 tag');
  assert.ok(html.includes('data-banned="0"'), '解封按钮');
});

test('U-3a renderAdminUserRow 教师行：年级/评分/报价 meta + 认证徽章 + 查看详情/认证按钮', () => {
  const html = renderAdminUserRow({ user_id: 40, id: 40, username: '教师乙', role: 'teacher', verified: 1, banned: 0, created_at: '2026-08-01 12:00:00', grade: 'freshman', rating: 4.8, price_min: 100, price_max: 200, credential_image: 'data:image/png;base64,xxx' }, 'teacher');
  assert.ok(html.includes('已认证'), '认证徽章');
  assert.ok(html.includes('4.8分') || html.includes('4.8 分'), '评分 meta');
  assert.ok(html.includes('元/h'), '报价单位');
  assert.ok(html.includes('data-action="admin.viewProfile" data-id="40"'), '查看详情按钮');
  assert.ok(html.includes('data-action="admin.unverify"'), '已认证 → 撤认证按钮');
  assert.ok(html.includes('data-action="admin.banUser"'), '封禁按钮');
});

test('U-3a renderAdminUserRow 教师未认证：认证按钮（data-action=admin.verifyTeacher）', () => {
  const html = renderAdminUserRow({ user_id: 41, username: '待认证', role: 'teacher', verified: 0, banned: 0, created_at: '2026-08-01 12:00:00', credential_image: 'data:image/png;base64,xxx' }, 'teacher');
  assert.ok(html.includes('data-action="admin.verifyTeacher" data-id="41"'), '认证按钮');
});

test('U-3a loadAdminUsers 搜索：带 q 参数 + 完整行形状渲染（G3 生产形状；G2 删 meta 必红）', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-teachers-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/users?role=teacher&q=' + encodeURIComponent('张')), '搜索 q 参数');
    // U-3a F2：生产搜索返回与列表路径相同的完整行形状（dbAdminSearchUsers），含 meta/认证态/封禁态
    return { ok: true, status: 200, json: async () => ({ users: [{ user_id: 50, id: 50, username: '张老师', role: 'teacher', banned: 0, created_at: '2026-08-01 12:00:00', grade: 'freshman', rating: 4.8, price_min: 100, price_max: 200, verified: 1, credential_image: 'data:image/png;base64,xxx' }] }) };
  };
  await loadAdminUsers('teacher', '张');
  assert.ok(list.innerHTML.includes('张老师'), '搜索结果渲染');
  assert.ok(list.innerHTML.includes('已认证'), '搜索行认证徽章渲染（F2 修复）');
  assert.ok(list.innerHTML.includes('元/h'), '搜索行报价 meta 渲染（F2 修复）');
  assert.ok(list.innerHTML.includes('data-action="admin.banUser"') && list.innerHTML.includes('data-banned="1"'), '搜索行封禁按钮态正确（F2 修复）');
  teardown();
});

test('U-3a rework F1：toggleTeacherVerify 走 confirm needReAuth，未确认零 POST（锁 capToken 流程）', async () => {
  const dom = setup();
  let verifyCalled = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/teachers/41/verify')) { verifyCalled = true; return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  toggleTeacherVerify(41, true);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, 'confirm 弹窗出现（走二次确认而非直调）');
  assert.ok(modal.textContent.includes('确认通过该教师的学籍认证吗'), '确认文案在位');
  assert.ok(modal.querySelector('#reauth-password'), 'needReAuth 密码输入在位');
  assert.equal(verifyCalled, false, '未确认前零 POST');
  await new Promise(r => setTimeout(r, 80)); // let confirm's REAUTH_FOCUS_MS(50) timer settle before teardown clears document
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3k：邀请码管理——生成/列表表格/作废。纯标准接口消费（前后端解耦）。
// G2：删表格列/revoke 按钮必红。
// ─────────────────────────────────────────────────────────────

test('U-3k generateInviteCode：POST 生成 → modal 显示 code + 复制按钮（data-action）', async () => {
  const dom = setup();
  let posted = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/invite') && opts.method === 'POST') { posted = true; return { ok: true, status: 200, json: async () => ({ code: 'ABC123' }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await generateInviteCode();
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(posted, 'POST /api/admin/invite');
  assert.ok(modal, '弹窗出现');
  assert.ok(modal.textContent.includes('ABC123'), '生成码展示');
  assert.ok(modal.textContent.includes('无有效期'), '无有效期提示');
  assert.ok(modal.querySelector('[data-action="admin.copyInvite"][data-code="ABC123"]'), '复制按钮带 code');
  assert.ok(!/onclick=/.test(modal.innerHTML), '零内联事件');
  teardown();
});

test('U-3k openInviteManager：GET 列表 → 表格（code/状态/使用者/时间/作废按钮）', async () => {
  const dom = setup();
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/invites'), 'GET /api/admin/invites');
    return { ok: true, status: 200, json: async () => ({ invites: [
      { code: 'USED001', used_by: 9, used_by_username: '已用者', created_at: '2026-08-01 12:00:00' },
      { code: 'ACTIVE01', used_by: null, created_at: '2026-08-02 12:00:00' },
    ] }) };
  };
  openInviteManager();
  await new Promise(r => setTimeout(r, 20)); // api then 回调落定
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '弹窗出现');
  assert.ok(modal.textContent.includes('USED001') && modal.textContent.includes('ACTIVE01'), '两码渲染');
  assert.ok(modal.textContent.includes('已使用') && modal.textContent.includes('未使用'), '状态 tag');
  assert.ok(modal.textContent.includes('已用者'), '使用者列');
  const revokeBtn = modal.querySelector('[data-action="admin.revokeInvite"][data-code="ACTIVE01"]');
  assert.ok(revokeBtn, '未使用码有作废按钮');
  assert.ok(!modal.querySelector('[data-action="admin.revokeInvite"][data-code="USED001"]'), '已使用码无作废按钮');
  assert.ok(!/onclick=/.test(modal.innerHTML), '零内联事件');
  teardown();
});

test('U-3k openInviteManager 空列表：空态文案', async () => {
  const dom = setup();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ invites: [] }) });
  openInviteManager();
  await new Promise(r => setTimeout(r, 20));
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal.textContent.includes('还没有邀请码'), '空态文案');
  teardown();
});

test('U-3k revokeInvite：confirm 确认 → DELETE → toast', async () => {
  const dom = setup();
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/invites/ACTIVE01') && opts.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ ok: true }) };
    if (String(url).includes('/api/admin/invites')) return { ok: true, status: 200, json: async () => ({ invites: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  revokeInvite('ACTIVE01');
  const confirmModal = dom.window.document.querySelector('.modal');
  assert.ok(confirmModal, '确认弹窗出现');
  assert.ok(confirmModal.textContent.includes('确认作废该邀请码吗'), '作废确认文案');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3b：需求管理页——loadAdminDemands 复用 renderDemandCard(admin) + 分页 + admin 删除。
// G2：删卡片渲染/删分页按钮必红。
// ─────────────────────────────────────────────────────────────

test('U-3b loadAdminDemands：renderDemandCard(admin) 渲染 + 空态 + 加载更多按钮', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-demands-list';
  document.body.appendChild(list);
  const demand = {
    id: 9, display_id: 9, user_id: 5, username: '学生甲', avatar: '', status: 'open',
    student_grade: 'senior1', student_gender: 'female', target_type: 'academic',
    target_subjects: ['math'], current_scores: [], teaching_method: 'online',
    budget_min: 100, budget_max: 200, created_at: '2026-08-01 12:00:00', target: null,
  };
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/demands'), 'GET /api/admin/demands');
    return { ok: true, status: 200, json: async () => ({ demands: [demand], nextCursor: 'cursor-2' }) };
  };
  await loadAdminDemands(true);
  assert.ok(list.innerHTML.includes('学生甲'), '用户渲染');
  assert.ok(list.innerHTML.includes('数学') || list.innerHTML.includes('math'), '科目渲染');
  assert.ok(list.innerHTML.includes('data-action="admin.deleteDemand" data-id="9"'), 'admin 删除按钮委托');
  assert.ok(list.innerHTML.includes('data-action="admin.loadMoreDemands"'), '加载更多按钮');
  assert.ok(!/onclick=/.test(list.innerHTML), '零内联事件');
  teardown();
});

test('U-3b loadAdminDemands 空列表：空态文案', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-demands-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [], nextCursor: null }) });
  await loadAdminDemands(true);
  assert.ok(list.innerHTML.includes('还没有学生发布需求'), '空态文案');
  teardown();
});

test('U-3b adminDeleteDemand：confirm 确认 → DELETE /api/admin/demands/:id → 列表刷新（G1 写路径直测）', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-demands-list';
  document.body.appendChild(list);
  let deleteCalls = 0, listFetches = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/demands/9') && opts.method === 'DELETE') { deleteCalls++; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    if (String(url).includes('/api/admin/demands')) { listFetches++; return { ok: true, status: 200, json: async () => ({ demands: [], nextCursor: null }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  adminDeleteDemand(9);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal && modal.textContent.includes('确定要删除这条需求吗'), '确认弹窗');
  assert.equal(deleteCalls, 0, '确认前零 DELETE');
  // 点确认按钮（confirm 内部已绑定 runPendingConfirm → onConfirm）→ DELETE + 列表重拉
  modal.querySelector('[data-action="ui.runPendingConfirm"]').click();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(deleteCalls, 1, '确认后 DELETE 发出');
  assert.ok(listFetches >= 1, '确认后列表重拉刷新');
  teardown();
});

test('U-3b F1：loadAdminDemands 在途守卫（并发加载只拉一次，双击不重复追加）', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-demands-list';
  document.body.appendChild(list);
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { ok: true, status: 200, json: async () => ({ demands: [], nextCursor: null }) }; };
  const p1 = loadAdminDemands(false);
  const p2 = loadAdminDemands(false); // 模拟双击：第二个调用在第一个在途时被守卫拦截
  await Promise.all([p1, p2]);
  assert.equal(calls, 1, '在途守卫：并发加载只拉一次');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3d：奖项审核页——renderAdminAwardRow v1-parity（title+教师+状态 tag+驳回理由+凭证）、
// 状态筛选、approve/reject 走 needReAuth 二次认证（服务端 confirmDangerOtp）。
// G2：删 PENDING 按钮显隐/删 status tag/删凭证按钮必红。
// ─────────────────────────────────────────────────────────────

test('U-3d renderAdminAwardRow pending：标题 + 教师 + 状态 tag + 凭证 + approve/reject 委托', () => {
  const html = renderAdminAwardRow({ id: 66, title: '一等奖学金', teacher_username: '教师甲', status: 'pending', admin_note: '', created_at: '2026-08-01 12:00:00', proof_upload_id: 8 });
  assert.ok(html.includes('一等奖学金'), '奖项标题');
  assert.ok(html.includes('教师：教师甲'), '教师标签');
  assert.ok(html.includes('待审核'), 'pending 状态 tag');
  assert.ok(html.includes('data-action="admin.viewAwardProof" data-id="66"'), '凭证查看按钮委托');
  assert.ok(html.includes('data-action="admin.approveAward" data-id="66"'), '通过按钮委托');
  assert.ok(html.includes('data-action="admin.rejectAwardModal" data-id="66"'), '驳回按钮委托');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('U-3d renderAdminAwardRow 非 pending：无审核按钮 + 状态 tag + 驳回理由', () => {
  const approved = renderAdminAwardRow({ id: 67, title: '二等奖', teacher_username: '教师乙', status: 'approved', admin_note: '', created_at: '2026-08-01 12:00:00', proof_upload_id: null });
  assert.ok(approved.includes('已通过'), 'approved tag');
  assert.ok(!approved.includes('data-action="admin.approveAward"'), 'approved 无通过按钮');
  assert.ok(!approved.includes('data-action="admin.rejectAwardModal"'), 'approved 无驳回按钮');
  assert.ok(!approved.includes('data-action="admin.viewAwardProof"'), '无凭证按钮（无 proof_upload_id）');
  const rejected = renderAdminAwardRow({ id: 68, title: '三等奖', teacher_username: '教师丙', status: 'rejected', admin_note: '奖状模糊', created_at: '2026-08-01 12:00:00', proof_upload_id: null });
  assert.ok(rejected.includes('已驳回'), 'rejected tag');
  assert.ok(rejected.includes('驳回理由：奖状模糊'), '驳回理由渲染');
  assert.ok(!rejected.includes('data-action="admin.approveAward"'), 'rejected 无审核按钮');
});

test('U-3d loadAdminAwards：带 status 参数请求 + 渲染（G2 删 status 下推必红）', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-awards-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/awards?status=pending'), 'status 参数下推');
    return { ok: true, status: 200, json: async () => ({ awards: [{ id: 70, title: '国家级', teacher_username: '教师甲', status: 'pending', admin_note: '', created_at: '2026-08-01 12:00:00', proof_upload_id: null }] }) };
  };
  await loadAdminAwards('pending');
  assert.ok(list.innerHTML.includes('国家级'), '奖项行渲染');
  teardown();
});

test('U-3d loadAdminAwards 无参数：读 #admin-awards-status 当前值保持筛选（G2 删 select 读取必红）', async () => {
  const dom = setup();
  _dhResetForTests(); // datahub cache is module-level shared — clear stale /api/admin/awards entries so fetch is actually issued
  const list = document.createElement('div');
  list.id = 'admin-awards-list';
  document.body.appendChild(list);
  const sel = document.createElement('select');
  sel.id = 'admin-awards-status';
  const opt = document.createElement('option'); opt.value = 'rejected'; opt.textContent = '已驳回';
  sel.appendChild(opt); // G3: select value only applies when an option matches — empty select ignores .value
  sel.value = 'rejected';
  document.body.appendChild(sel);
  let seenUrl = '';
  // U-3d 审计 F1：断言移出 mock 内部——原先写在 mock 里被业务 catch 吞掉，删 select-read 不红（G2）
  globalThis.fetch = async (url) => { seenUrl = String(url); return { ok: true, status: 200, json: async () => ({ awards: [] }) }; };
  await loadAdminAwards();
  assert.ok(seenUrl.includes('/api/admin/awards?status=rejected'), '从 select 读当前筛选值（删 select-read 必红）');
  teardown();
});

test('U-3d viewAwardProof：GET /api/admin/awards/:id/proof → 图片 modal（凭证数据通道）', async () => {
  const dom = setup();
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/awards/66/proof'), '凭证接口');
    return { ok: true, status: 200, json: async () => ({ dataUrl: 'data:image/png;base64,AAA' }) };
  };
  await viewAwardProof(66);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '凭证弹窗出现');
  const img = modal.querySelector('.award-proof-img');
  assert.ok(img && img.getAttribute('src').includes('data:image/png;base64,AAA'), '图片 dataUrl 渲染');
  teardown();
});

test('U-3d approveAward：confirm needReAuth 弹窗（含密码输入），未确认零 POST（锁 capToken 流程）', async () => {
  const dom = setup();
  let posted = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/awards/66/action') && opts.method === 'POST') { posted = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  approveAward(66);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, 'confirm 弹窗出现');
  assert.ok(modal.textContent.includes('确定通过该奖项审核吗'), '通过确认文案');
  assert.ok(modal.querySelector('#reauth-password'), 'needReAuth 密码输入在位（服务端 confirmDangerOtp）');
  assert.equal(posted, false, '未确认前零 POST');
  await new Promise(r => setTimeout(r, 80)); // let confirm's REAUTH_FOCUS_MS(50) timer settle before teardown clears document
  teardown();
});

test('U-3d doAwardAction reject 空理由：toast 拦截零请求（服务端 reject 必须带 note）', async () => {
  const dom = setup();
  let apiCalls = 0;
  globalThis.fetch = async () => { apiCalls++; return { ok: true, status: 200, json: async () => ({}) }; };
  doAwardAction(66, 'reject'); // no #award-reject-note element -> note = ''
  await new Promise(r => setTimeout(r, 20));
  assert.equal(apiCalls, 0, '空理由零 POST');
  assert.ok(document.getElementById('toast-container')?.textContent.includes('请填写驳回理由'), '必填提示 toast');
  teardown();
});

test('U-3d rejectAwardModal：驳回弹窗含理由输入 + 必填 hint + 确认按钮', () => {
  const dom = setup();
  rejectAwardModal(67);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '驳回弹窗出现');
  assert.ok(modal.querySelector('#award-reject-note'), '理由 textarea');
  assert.ok(modal.textContent.includes('驳回理由（必填，将通知教师）'), '必填 hint');
  assert.ok(modal.querySelector('[data-action="admin.submitAwardReject"][data-id="67"]'), '确认按钮带 id');
  assert.ok(!/onclick=/.test(modal.innerHTML), '零内联事件');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3e：学信网核验队列——v1-parity 卡片（四态 tag + 验证码 + admission 预览 +
// 结构化 approve 表单 / reject / revoke），危险操作走 needReAuth 二次认证。
// G2：删 PENDING 表单/删 status tag/删 revoke 按钮必红。
// ─────────────────────────────────────────────────────────────

test('U-3e renderVerifCard pending：用户 + 验证码 + 待核验 tag + 结构化表单（5 输入 + approve/reject）', () => {
  const html = renderVerifCard({ id: 80, username: '教师甲', user_id: 5, verify_type: 'chsi', verify_code: 'ABCD1234EFGH', status: 'pending', created_at: '2026-08-01 12:00:00', verified_at: null, school: '', level: '', major: '', enrollment_status: '', enroll_year: '', admission_image: '' });
  assert.ok(html.includes('教师甲'), '用户名');
  assert.ok(html.includes('ABCD1234EFGH'), '验证码明文（管理员核验用）');
  assert.ok(html.includes('待核验'), 'pending 状态 tag');
  assert.ok(html.includes('verif-school-80') && html.includes('verif-level-80') && html.includes('verif-major-80') && html.includes('verif-status-80') && html.includes('verif-year-80'), '5 个结构化输入');
  assert.ok(html.includes('data-action="admin.verifApprove" data-id="80"'), 'approve 按钮委托');
  assert.ok(html.includes('data-action="admin.verifReject" data-id="80"'), 'reject 按钮委托');
  assert.ok(!html.includes('data-action="admin.verifRevoke"'), 'pending 无撤销按钮');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('U-3e renderVerifCard approved：学籍结果行 + 撤销按钮 + 无表单', () => {
  const html = renderVerifCard({ id: 81, username: '教师乙', user_id: 6, verify_type: 'chsi', verify_code: 'ABCD1234EFGH', status: 'approved', created_at: '2026-08-01 12:00:00', verified_at: '2026-08-02 12:00:00', school: '上海财经大学', level: '本科', major: '金融', enrollment_status: '在籍', enroll_year: '2026', admission_image: '' });
  assert.ok(html.includes('已通过'), 'approved tag');
  assert.ok(html.includes('上海财经大学 · 本科 · 金融 · 在籍 · 2026'), '学籍结果行');
  assert.ok(html.includes('data-action="admin.verifRevoke" data-id="81"'), '撤销按钮');
  assert.ok(!html.includes('verif-school-81'), 'approved 无表单');
  assert.ok(!html.includes('data-action="admin.verifApprove"'), 'approved 无 approve 按钮');
});

test('U-3e renderVerifCard admission：录取通知书 tag + 无验证码标记 + 原图预览按钮', () => {
  const html = renderVerifCard({ id: 82, username: '教师丙', user_id: 7, verify_type: 'admission', verify_code: '', status: 'pending', created_at: '2026-08-01 12:00:00', verified_at: null, school: '', level: '', major: '', enrollment_status: '', enroll_year: '', admission_image: 'data:image/png;base64,BBB' });
  assert.ok(html.includes('录取通知书'), 'admission tag');
  assert.ok(html.includes('录取通知书核验（无验证码）'), '无验证码标记');
  assert.ok(html.includes('data-action="admin.viewAdmissionImage" data-id="82"'), '原图预览按钮');
});

test('U-3e loadAdminVerifications：带 status 参数请求 + 渲染 + 空态', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-verifications-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/admin/verifications?status=pending'), 'status 参数下推');
    return { ok: true, status: 200, json: async () => ({ verifications: [{ id: 83, username: '教师丁', user_id: 8, verify_type: 'chsi', verify_code: 'X', status: 'pending', created_at: '2026-08-01 12:00:00', verified_at: null, school: '', level: '', major: '', enrollment_status: '', enroll_year: '', admission_image: '' }] }) };
  };
  await loadAdminVerifications('pending');
  assert.ok(list.innerHTML.includes('教师丁'), '核验行渲染');
  teardown();
});

test('U-3e loadAdminVerifications 空列表：空态文案', async () => {
  const dom = setup();
  const list = document.createElement('div');
  list.id = 'admin-verifications-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ verifications: [] }) });
  await loadAdminVerifications();
  assert.ok(list.innerHTML.includes('没有核验记录'), '空态文案');
  teardown();
});

test('U-3e verifApprove 空 school/level：必填拦截零请求', async () => {
  const dom = setup();
  let apiCalls = 0;
  globalThis.fetch = async () => { apiCalls++; return { ok: true, status: 200, json: async () => ({}) }; };
  verifApprove(84); // no school/level inputs -> required toast
  await new Promise(r => setTimeout(r, 20));
  assert.equal(apiCalls, 0, '必填未填零请求');
  assert.ok(document.getElementById('toast-container')?.textContent.includes('院校与层次为必填项'), '必填提示 toast');
  teardown();
});

test('U-3e verifApprove 带字段：confirm needReAuth 弹窗（含密码输入），未确认零 POST', async () => {
  const dom = setup();
  let posted = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/verifications/85/action') && opts.method === 'POST') { posted = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const school = document.createElement('input'); school.id = 'verif-school-85'; school.value = '上海财经大学';
  const level = document.createElement('input'); level.id = 'verif-level-85'; level.value = '本科';
  document.body.appendChild(school); document.body.appendChild(level);
  verifApprove(85);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, 'confirm 弹窗出现');
  assert.ok(modal.querySelector('#reauth-password'), 'needReAuth 密码输入在位');
  assert.equal(posted, false, '未确认前零 POST');
  await new Promise(r => setTimeout(r, 80)); // REAUTH_FOCUS_MS timer settle
  teardown();
});

test('U-3e verifReject：理由弹窗（可选 reason）→ confirm needReAuth 二次认证', async () => {
  const dom = setup();
  verifReject(86);
  let rm = dom.window.document.querySelector('.modal');
  assert.ok(rm && rm.querySelector('#verif-reject-reason'), '理由 textarea 弹窗（L-1 接线）');
  assert.ok(rm.textContent.includes('驳回理由（可选，将通知教师）'), '可选理由 hint');
  // 填理由 → 确认（测试直调 verifRejectConfirm，等价 data-action 委托按钮）
  rm.querySelector('#verif-reject-reason').value = '材料不清晰';
  verifRejectConfirm(86);
  const cm = dom.window.document.querySelector('.modal');
  assert.ok(cm && cm.textContent.includes('确认拒绝该核验申请吗'), 'reject 确认弹窗');
  assert.ok(cm.querySelector('#reauth-password'), 'reject needReAuth');
  await new Promise(r => setTimeout(r, 80)); // REAUTH_FOCUS_MS timer settle
  teardown();
});

test('U-3e verifRevoke：confirm needReAuth 弹窗（二次认证）', async () => {
  const dom = setup();
  verifRevoke(87);
  const vrm = dom.window.document.querySelector('.modal');
  assert.ok(vrm && vrm.textContent.includes('确认撤销该教师的核验资格吗'), 'revoke 确认弹窗');
  assert.ok(vrm.querySelector('#reauth-password'), 'revoke needReAuth');
  await new Promise(r => setTimeout(r, 80)); // REAUTH_FOCUS_MS timer settle
  teardown();
});

test('U-3e verifRejectConfirm：收集 reason → confirm needReAuth 弹窗', async () => {
  const dom = setup();
  const reason = document.createElement('textarea'); reason.id = 'verif-reject-reason'; reason.value = '材料不清晰';
  document.body.appendChild(reason);
  verifRejectConfirm(89);
  const cm = dom.window.document.querySelector('.modal');
  assert.ok(cm && cm.querySelector('#reauth-password'), 'needReAuth 确认弹窗');
  assert.ok(cm.textContent.includes('确认拒绝该核验申请吗'), 'reject 确认文案');
  await new Promise(r => setTimeout(r, 80)); // REAUTH_FOCUS_MS timer settle
  teardown();
});

test('U-3e performVerifAction reject：reason 透传到写路径 body（G2 删 reason 透传必红）', async () => {
  const dom = setup();
  let postedBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/api/admin/verifications/89/action') && opts.method === 'POST') postedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  await performVerifAction(89, { action: 'reject', reason: '材料不清晰' }, { capToken: 'cap-1' });
  assert.equal(postedBody.action, 'reject', 'action 透传');
  assert.equal(postedBody.reason, '材料不清晰', 'reason 透传（删透传必红）');
  assert.equal(postedBody.capToken, 'cap-1', 'capToken 透传');
  await new Promise(r => setTimeout(r, 10));
  teardown();
});

test('U-3e loadAdminVerifications 无参数：读 #admin-verif-status 当前值保持筛选（G2 删 select 读取必红）', async () => {
  const dom = setup();
  _dhResetForTests();
  const list = document.createElement('div');
  list.id = 'admin-verifications-list';
  document.body.appendChild(list);
  const sel = document.createElement('select');
  sel.id = 'admin-verif-status';
  const opt = document.createElement('option'); opt.value = 'pending'; opt.textContent = '待核验';
  sel.appendChild(opt); // G3: select value only applies when an option matches
  sel.value = 'pending';
  document.body.appendChild(sel);
  let seenUrl = '';
  globalThis.fetch = async (url) => { seenUrl = String(url); return { ok: true, status: 200, json: async () => ({ verifications: [] }) }; };
  await loadAdminVerifications();
  assert.ok(seenUrl.includes('/api/admin/verifications?status=pending'), '从 select 读当前筛选值（删 select-read 必红）');
  teardown();
});

test('U-3e viewAdmissionImage：从缓存列表取 admission_image 显示原图 modal', async () => {
  const dom = setup();
  _dhResetForTests(); // datahub cache is module-level shared across tests — clear stale /api/admin/verifications
  // 先加载列表填缓存，再点预览
  const list = document.createElement('div');
  list.id = 'admin-verifications-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ verifications: [{ id: 88, username: '教师戊', user_id: 9, verify_type: 'admission', verify_code: '', status: 'pending', created_at: '2026-08-01 12:00:00', verified_at: null, school: '', level: '', major: '', enrollment_status: '', enroll_year: '', admission_image: 'data:image/png;base64,CCC' }] }) });
  await loadAdminVerifications();
  viewAdmissionImage(88);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '原图弹窗出现');
  const img = modal.querySelector('.verif-admission-img');
  assert.ok(img && img.getAttribute('src').includes('data:image/png;base64,CCC'), '原图 dataUrl 渲染');
  teardown();
});

// ─────────────────────────────────────────────────────────────
// Z-3-F1/U-3f：帖子管理——v1-parity 行（标题/作者/点赞/时间 + 查看/删除）+ 全文弹窗
// （mdRender）+ 空态。G2：删查看/删除按钮/全文渲染必红。
// ─────────────────────────────────────────────────────────────

test('U-3f renderAdminPostRow：标题 + 作者 + 点赞数 + 时间 + 查看/删除委托', () => {
  const html = renderAdminPostRow({ id: 90, title: '数学讲义', username: '教师甲', like_count: 5, created_at: '2026-08-01 12:00:00' });
  assert.ok(html.includes('数学讲义'), '标题');
  assert.ok(html.includes('教师甲'), '作者');
  assert.ok(html.includes('5 点赞'), '点赞数');
  assert.ok(html.includes('data-action="admin.openPostView" data-id="90"'), '查看按钮委托');
  assert.ok(html.includes('data-action="admin.deletePost" data-id="90"'), '删除按钮委托');
  assert.ok(!/onclick=/.test(html), '零内联事件');
});

test('U-3f loadAdminPosts：拉取 /api/posts?sort=new 渲染行 + 空态', async () => {
  const dom = setup();
  _dhResetForTests();
  const list = document.createElement('div');
  list.id = 'admin-posts-list';
  document.body.appendChild(list);
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/api/posts?sort=new'), 'posts 域缓存 key 带 sort=new');
    return { ok: true, status: 200, json: async () => ({ posts: [{ id: 91, title: '讲义乙', username: '教师乙', like_count: 2, created_at: '2026-08-01 12:00:00' }] }) };
  };
  await loadAdminPosts();
  assert.ok(list.innerHTML.includes('讲义乙'), '帖子行渲染');
  teardown();
});

test('U-3f loadAdminPosts 空列表：空态文案', async () => {
  const dom = setup();
  _dhResetForTests();
  const list = document.createElement('div');
  list.id = 'admin-posts-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ posts: [] }) });
  await loadAdminPosts();
  assert.ok(list.innerHTML.includes('还没有教师发布资料'), '空态文案');
  teardown();
});

test('U-3f openPostViewModal：从缓存取帖子 → mdRender 全文弹窗（modal--wide）', async () => {
  const dom = setup();
  _dhResetForTests();
  const list = document.createElement('div');
  list.id = 'admin-posts-list';
  document.body.appendChild(list);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ posts: [{ id: 92, title: '讲义丙', username: '教师丙', like_count: 0, created_at: '2026-08-01 12:00:00', body_md: '# 标题\n\n正文段落' }] }) });
  await loadAdminPosts();
  openPostViewModal(92);
  const modal = dom.window.document.querySelector('.modal');
  assert.ok(modal, '全文弹窗出现');
  assert.ok(modal.classList.contains('modal--wide'), '宽窗（管理端全文阅读）');
  assert.ok(modal.textContent.includes('教师丙'), '作者 meta');
  assert.ok(modal.querySelector('.md-preview'), 'md 渲染容器');
  assert.ok(!/onclick=/.test(modal.innerHTML), '零内联事件');
  teardown();
});
