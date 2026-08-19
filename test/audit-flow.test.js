/**
 * v0.26.0 高频轻量日常审核通道（E1/E2）+ v0.30.0 S2-1 门牌合规 L1 规则层挂接
 *
 * 覆盖：
 *   - isContentWrite：内容域写路径白名单（帖子/需求/档案/评价/反馈/投诉/注册/聊天消息/附件）；
 *   - auditBeforeWrite：默认放行；语义层未配置拒绝写入；
 *   - L1 规则层（v0.30.0 S2-1）：按路径映射抽取自由文本字段交 auditFreeText——
 *     门牌号内容 → reject（ADDRESS_TOO_DETAILED）；正常文本放行；非内容写路径不过断点。
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isContentWrite, auditBeforeWrite } from '../src/server/core/audit-flow.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';

const origFetch = globalThis.fetch;
beforeEach(() => {
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false, "reason": "无住址信息"}' } }] }) });
});
afterEach(() => {
  bindTextAuditEnv(null);
  globalThis.fetch = origFetch;
});

test('isContentWrite：内容域写路径白名单', () => {
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
  assert.equal(isContentWrite('/api/signing-requests/5/respond', 'POST'), true, '签约请求回复');
  assert.equal(isContentWrite('/api/demands/3/intents', 'POST'), true, '创建需求意向');
  assert.equal(isContentWrite('/api/intents/9/resolve', 'POST'), true, '处理需求意向');
  assert.equal(isContentWrite('/api/demand-pushes', 'POST'), true, '学生推送需求');
  assert.equal(isContentWrite('/api/demand-pushes/8/resolve', 'POST'), true, '教师处理推送');
  assert.equal(isContentWrite('/api/contracts', 'POST'), true, '起草合同');
  assert.equal(isContentWrite('/api/user/avatar', 'POST'), true, '上传头像');
  assert.equal(isContentWrite('/api/posts', 'GET'), false, '读不审核');
  assert.equal(isContentWrite('/api/auth/login', 'POST'), false, '登录不是内容上传');
  assert.equal(isContentWrite('/api/notifications/read-all', 'POST'), false, '已读非内容');
  assert.equal(isContentWrite('/api/auth/logout', 'POST'), false, '登出非内容');
  assert.equal(isContentWrite('/api/health', 'GET'), false);
});

test('auditBeforeWrite：正常文本经语义层放行；非内容路径直接放行', async () => {
  const r = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: 'x', bodyMd: 'y' }, ip: '1.2.3.4', userId: 7 });
  assert.equal(r.ok, true, '正常文本放行');
  const r2 = await auditBeforeWrite({ path: '/api/notifications/read-all', method: 'POST', body: {} });
  assert.equal(r2.ok, true, '非内容路径直接放行');
});

test('auditBeforeWrite fail-closed：语义层未配置 → 正常文本也拒绝', async () => {
  bindTextAuditEnv(null);
  try {
    const r = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '分享一轮复习方法' }, ip: '1.2.3.4', userId: 7 });
    assert.ok(r.reject, '语义层未配置拒绝写入');
    assert.ok(r.reject.includes('不可用'), '提示审核服务不可用');
  } finally { bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' }); }
});

test('auditBeforeWrite L1 规则层（S2-1）：自由文本字段含门牌号 → reject；正常 → 放行', async () => {
  const postBad = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '我家在静安区5号楼303室，欢迎上门' } });
  assert.ok(postBad.reject, '帖子正文含门牌 → 拒');
  assert.equal(postBad.reject.includes('门牌'), true, '驳回文案 = 门牌合规提示');
  const postOk = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '分享一轮复习方法' } });
  assert.equal(postOk.ok, true, '帖子正常 → 放行');
  const reviewBad = await auditBeforeWrite({ path: '/api/reviews', method: 'POST', body: { comment: '老师很好，家在杨高中路88号' } });
  assert.ok(reviewBad.reject, '评价含门牌 → 拒');
  const compBad = await auditBeforeWrite({ path: '/api/complaints', method: 'POST', body: { reason: '违约', detail: '联系地址：中山北路88号' } });
  assert.ok(compBad.reject, '投诉详情含门牌 → 拒');
  const chatBad = await auditBeforeWrite({ path: '/api/conversations/12/messages', method: 'POST', body: { batch: [{ kind: 'text', body: '您到了吗，我家在9号楼502室' }] } });
  assert.ok(chatBad.reject, '聊天消息含门牌 → 拒');
  const chatOk = await auditBeforeWrite({ path: '/api/conversations/12/messages', method: 'POST', body: { batch: [{ kind: 'text', body: '您到地铁站了吗？' }] } });
  assert.equal(chatOk.ok, true, '聊天正常 → 放行');
  const pushBad = await auditBeforeWrite({ path: '/api/demand-pushes', method: 'POST', body: { message: '老师您好，家住5号楼303室' } });
  assert.ok(pushBad.reject, '打招呼消息含门牌 → 拒');
  const fbBad = await auditBeforeWrite({ path: '/api/feedbacks', method: 'POST', body: { title: '建议', content: '我家小区门口有 xx路88号' } });
  assert.ok(fbBad.reject, '反馈含门牌 → 拒');
  const like = await auditBeforeWrite({ path: '/api/posts/3/like', method: 'POST', body: {} });
  assert.equal(like.ok, true, '点赞路径无映射字段 → 放行');
  // v0.30.0 审计补覆盖：合同线下地点 / 签约 schedule 也可承载门牌
  const contractBad = await auditBeforeWrite({ path: '/api/contracts', method: 'POST', body: { plan: '补基础', schedule: '每周六晚', location: '静安区5号楼303室', payMethodOther: '' } });
  assert.ok(contractBad.reject, '合同线下地点含门牌 → 拒');
  const contractOk = await auditBeforeWrite({ path: '/api/contracts', method: 'POST', body: { plan: '补基础', schedule: '每周六晚', location: '双方约定的线上课堂', payMethodOther: '' } });
  assert.equal(contractOk.ok, true, '合同正常 → 放行');
  const signingBad = await auditBeforeWrite({ path: '/api/conversations/12/signing', method: 'POST', body: { schedule: '每周六下午，静安区5号楼303室' } });
  assert.ok(signingBad.reject, '发起签约 schedule 含门牌 → 拒');
  const signingOk = await auditBeforeWrite({ path: '/api/conversations/12/signing', method: 'POST', body: { schedule: '每周六下午3点' } });
  assert.equal(signingOk.ok, true, '发起签约正常 → 放行');
  // v0.31.2 审计：合同修改路径 body 为 {version, contractMd}——pick 曾只读创建扁平字段（plan/schedule/location/payMethodOther），
  // 修改时四字段全 undefined → 恒放行（用户可在修改弹窗打进详细门牌绕开红线）。补 contractMd 后此层拦截。
  const contractModBad = await auditBeforeWrite({ path: '/api/contracts/12', method: 'PUT', body: { version: 3, contractMd: '每周六晚8点，上门到静安区5号楼303室授课' } });
  assert.ok(contractModBad.reject, '合同修改 contractMd 含门牌 → 拒');
  const contractModOk = await auditBeforeWrite({ path: '/api/contracts/12', method: 'PUT', body: { version: 3, contractMd: '每周六晚8点线上授课' } });
  assert.equal(contractModOk.ok, true, '合同修改正常 → 放行');
});

test('auditBeforeWrite L1 嵌套 body：需求/教师档案字段在 body.demand / body.profile 下（外部审计断线回归）', async () => {
  // 断线 1：/api/student/demands 创建+编辑 body 为 { demand: { additional_info } }——曾读扁平字段规则恒空转
  const demBad = await auditBeforeWrite({ path: '/api/student/demands', method: 'POST', body: { demand: { additional_info: '补充：家在静安区5号楼303室' } } });
  assert.ok(demBad.reject, '需求创建嵌套 additional_info 含门牌 → 拒');
  const demEditBad = await auditBeforeWrite({ path: '/api/student/demands/9', method: 'PUT', body: { demand: { additional_info: '住在xx路88号' } } });
  assert.ok(demEditBad.reject, '需求编辑嵌套 additional_info 含门牌 → 拒（编辑路径无路由层兜底，全赖此层）');
  const demOk = await auditBeforeWrite({ path: '/api/student/demands', method: 'POST', body: { demand: { additional_info: '希望周末上课' } } });
  assert.equal(demOk.ok, true, '需求正常 → 放行');
  // 断线 2：/api/teacher/profile body 为 { profile: { intro, school } }
  const profBad = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '大家好，家在杨高中路88号', school: '华师大' } } });
  assert.ok(profBad.reject, '教师档案嵌套 intro 含门牌 → 拒');
  const profOk = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '专注高中数学辅导', school: '华东师范大学' } } });
  assert.equal(profOk.ok, true, '教师档案正常 → 放行');
});

test('auditBeforeWrite L1 规则层：地铁「号线」不误伤、路名级别放行（全覆盖不误拒正常内容）', async () => {
  const ok1 = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '攻略', bodyMd: '地铁九号线站附近上课很方便' } });
  assert.equal(ok1.ok, true, '号线（地铁）不误伤');
  const ok2 = await auditBeforeWrite({ path: '/api/conversations/1/messages', method: 'POST', body: { batch: [{ kind: 'text', body: '我们约在人民广场地铁站碰面吧' }] } });
  assert.equal(ok2.ok, true, '纯地点无门牌放行');
});

// Z-2-F7 回归：合法 JSON 文本 null 无自由文本可审 → 放行（修复前 AUDIT_MAP pick(null) TypeError → 500）
test('auditBeforeWrite：JSON null body 放行（Z-2-F7 断线回归）', async () => {
  const r = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: null });
  assert.equal(r.ok, true, 'null body 放行（修复前 pick(null) TypeError → 500）');
  const rUndef = await auditBeforeWrite({ path: '/api/reviews', method: 'POST', body: undefined });
  assert.equal(rUndef.ok, true, 'undefined body 同样放行');
});

test('Q-2b-F1 预算守护：合同表单 6 字段放行（自定义结算/试课），>13 恶意 batch 拒绝', async () => {
  // 审计 FAIL 修复：AUDIT_MAX_FIELDS=3 曾误伤合法合同起草（选「其他」结算/试课时 4+ 字段 → 400 TEXT_AUDIT_UNAVAILABLE 误导）
  const contract6 = await auditBeforeWrite({ path: '/api/contracts', method: 'POST', body: {
    plan: '补基础', schedule: '每周六晚', location: '线上课堂', payMethodOther: '每月微信转账', trialPayOther: '首节免费', contractMd: '按上海家教市场惯例' } });
  assert.equal(contract6.ok, true, '合同 6 字段（自定义结算/试课）放行');
  // > AUDIT_MAX_FIELDS(13) 的恶意大 batch 拒绝（fail-closed，防逐项打 DeepSeek 成本/DoS 放大）
  const batch = Array.from({ length: 14 }, (_, i) => ({ kind: 'text', body: `普通消息${i}` }));
  const big = await auditBeforeWrite({ path: '/api/conversations/1/messages', method: 'POST', body: { batch } });
  assert.ok(!big.ok && big.reject, '14 条 batch（>13）拒绝');
  assert.equal(big.code, 'INVALID_PARAMS', '预算溢出文案 = INVALID_PARAMS（不误用审核服务不可用）');
  const batch13 = await auditBeforeWrite({ path: '/api/conversations/1/messages', method: 'POST', body: { batch: batch.slice(0, 13) } });
  assert.equal(batch13.ok, true, '13 条 batch（= AUDIT_MAX_FIELDS）放行');
});

test('auditBeforeWrite 注册用户名与改用户名同守门牌红线', async () => {
  const regBad = await auditBeforeWrite({ path: '/api/auth/register', method: 'POST', body: { username: '静安区5号楼303室' } });
  assert.ok(regBad.reject, '注册用户名含门牌 → 拒');
  const regOk = await auditBeforeWrite({ path: '/api/auth/register', method: 'POST', body: { username: '小明同学' } });
  assert.equal(regOk.ok, true, '普通用户名 → 放行');
});
