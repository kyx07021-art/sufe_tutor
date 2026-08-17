/**
 * v0.26.0 统一内容审核/管理接口（D1/D2）
 *
 * 覆盖：
 *   - handleAdminContent：全站内容统一提取（多类型归拢统一结构，私密字段不提取）；
 *   - handleContentAction：delete（删帖/删需求/删评价）+ ban（封禁作者）+ 处罚自动通知作者
 *     （含原因/规则/触发内容摘要）+ 留档；缺原因 400；非管理员 403。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { handleRegister, handleLogin } from '../src/server/domains/auth/api.js';
import { requestOtp } from '../src/server/core/otp.js';
import { lastOtpCode } from './_otp-stub.js'; // stub fetch 防真实发信（真实代码路径 + 捕获验证码）
import { handleCreatePost } from '../src/server/domains/posts/api.js';
import { handleAdminContent, handleContentAction } from '../src/server/domains/admin/api.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
// 语义层测试通道：保留 OTP stub 的 push.spug.cc 拦截，其余请求按「AI 判未命中」应答。
const otpFetch = globalThis.fetch;
function semanticPass() {
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('push.spug.cc')) return otpFetch(url, init);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) };
  };
}

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    async batch(stmts) {
      // v0.27.3 #21 生产实证：真实 D1 空数组 batch 会抛错，mock 忠实还原（曾因 mock 空 batch 返回 []
      // 掩盖「无效 type 500」回归——线上 500 抓出，修复=空清单提前返回，本 shim 从此拦截该回归）
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      raw.exec('BEGIN');
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  const req = h => ({ headers: new Headers(h || {}) });
  return { raw, db, req };
}

async function adminToken(db, raw) {
  const r = await handleLogin(db, { identifier: 'admin_sufe', password: 'test-pw-123' }, { headers: new Headers() });
  const data = await r.json();
  return data.authToken;
}

// 处罚危险操作二次认证的 capToken：直接落 danger_caps 行（真实 confirmDangerOtp SQL 全链路，
// 会话绑定 + 命中即删）。expires_at 取 2099 规避时区比较伪象（同 contract-sign-compliance 口径）。
async function capOf(raw, token) {
  const sess = raw.prepare('SELECT user_id, session_id FROM auth_sessions WHERE token_hash=?').get(await tokenDigest(token));
  const cap = `cap-${Math.random().toString(36).slice(2)}`;
  raw.prepare('INSERT INTO danger_caps (user_id, session_id, token_hash, expires_at) VALUES (?,?,?,?)')
    .run(sess.user_id, sess.session_id, await tokenDigest(cap), '2099-01-01 00:00:00');
  return cap;
}

test('D1：统一内容提取（多类型归拢统一结构，私密字段不提取）', async () => {
  const { raw, db, req } = await setup();
  semanticPass();
  // 造数据：一个学生发帖 + 一个教师建档案
  const s = await registerWithContact(db, req(), { username: 'alice', password: 'pass123456', role: 'teacher' });
  const sData = await s.json();
  await handleCreatePost(db, { title: '物理笔记', bodyMd: '牛顿三大定律总结' }, req({ 'X-Auth-Token': sData.authToken }));
  const t = await registerWithContact(db, req(), { username: 'bobt', password: 'pass123456', role: 'teacher' });
  const tData = await t.json();
  const prof = await (await import('../src/server/domains/teacher/api.js')).handleSaveProfile(db, {
    profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, intro: '注重方法', address: '浦东新区·花木街道', school: '上财' },
  }, req({ 'X-Auth-Token': tData.authToken }));
  assert.equal(prof.status, 200);

  const token = await adminToken(db, raw);
  const r = await handleAdminContent(db, new URL('http://x/api/admin/content'), req({ 'X-Auth-Token': token }));
  assert.equal(r.status, 200);
  const data = await r.json();
  const types = new Set(data.items.map(i => i.type));
  assert.ok(types.has('post') && types.has('teacher'), '含帖子与教师档案');
  const post = data.items.find(i => i.type === 'post');
  assert.equal(post.author.username, 'alice');
  assert.equal(post.title, '物理笔记');
  assert.ok(!('password_hash' in post), '不提取凭证列');
  assert.ok(!('parent_contact' in post), '不提取私密字段');
  // 非管理员（无令牌）→ 401（requireUser 无令牌语义；有令牌但非 admin 才是 403）
  const anon = await handleAdminContent(db, new URL('http://x/api/admin/content'), req());
  assert.equal(anon.status, 401);
  // 单类型过滤
  const onlyPosts = await handleAdminContent(db, new URL('http://x/api/admin/content?type=post'), req({ 'X-Auth-Token': token }));
  assert.ok((await onlyPosts.json()).items.every(i => i.type === 'post'));
});

test('D1 键控化（v0.27.3 #21）：清单与表域单源——CONTENT_TYPES 每键可单查；无效 type → 空不崩溃', async () => {
  const { raw, db, req } = await setup();
  const token = await adminToken(db, raw);
  const { CONTENT_TYPES } = await import('../src/server/domains/admin/repo.js');
  // 每键可单类型提取（空表也 200 空列表）→ 清单由 CONTENT_SQL 键派生，不存在「漏列新表域」
  for (const key of CONTENT_TYPES) {
    const r = await handleAdminContent(db, new URL(`http://x/api/admin/content?type=${key}`), req({ 'X-Auth-Token': token }));
    assert.equal(r.status, 200, `type=${key} 应 200`);
    assert.ok((await r.json()).items.every(i => i.type === key), `type=${key} 返回条目类型一致`);
  }
  // 无效 type → 200 空列表（不再 db.prepare(undefined) 崩溃）
  const bad = await handleAdminContent(db, new URL('http://x/api/admin/content?type=bogus'), req({ 'X-Auth-Token': token }));
  assert.equal(bad.status, 200);
  assert.deepEqual((await bad.json()).items, []);
});

test('D2：处罚——delete 删帖 + ban 封禁作者 + 自动通知作者 + 缺原因 400', async () => {
  const { raw, db, req } = await setup();
  semanticPass();
  const s = await registerWithContact(db, req(), { username: 'mallory', password: 'pass123456', role: 'teacher' });
  const sData = await s.json();
  const sId = raw.prepare("SELECT id FROM users WHERE username='mallory'").get().id;
  const postRes = await handleCreatePost(db, { title: '违规帖子', bodyMd: '含详细门牌号 88 号' }, req({ 'X-Auth-Token': sData.authToken }));
  const post = await postRes.json();
  const postId = raw.prepare('SELECT MAX(id) AS id FROM posts').get().id;

  const token = await adminToken(db, raw);
  // 缺原因 → 400
  const noReason = await handleContentAction(db, 'post', postId, { action: 'delete', rule: '隐私' }, req({ 'X-Auth-Token': token }));
  assert.equal(noReason.status, 400);
  // 删除帖子 → 200 + 通知作者（危险操作须 capToken 二次认证）
  const del = await handleContentAction(db, 'post', postId, { action: 'delete', reason: '含详细门牌号，违反隐私红线', rule: '地址门控', capToken: await capOf(raw, token) }, req({ 'X-Auth-Token': token }));
  assert.equal(del.status, 200, JSON.stringify(await del.json()));
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM posts WHERE id=?').get(postId).c, 0, '帖子已删除');
  const notif = raw.prepare('SELECT text FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(sId);
  assert.ok(notif && notif.text.includes('隐私红线') && notif.text.includes('地址门控'), '通知含原因+规则');
  assert.ok(notif.text.includes('含详细门牌号'), '通知含触发内容摘要');
  // 已删除内容再处罚 → 404 定位失败（用真实存在的帖子测 ban）
  const ban = await handleContentAction(db, 'post', postId, { action: 'ban', reason: '多次发布违规内容', rule: '内容安全' }, req({ 'X-Auth-Token': token }));
  assert.equal(ban.status, 404);
  void post;
  // 重新造一条再 ban 作者
  const post2 = await handleCreatePost(db, { title: '另一条', bodyMd: '普通内容' }, req({ 'X-Auth-Token': sData.authToken }));
  const post2Id = raw.prepare('SELECT MAX(id) AS id FROM posts').get().id;
  const ban2 = await handleContentAction(db, 'post', post2Id, { action: 'ban', reason: '发布违规内容', rule: '内容安全', capToken: await capOf(raw, token) }, req({ 'X-Auth-Token': token }));
  assert.equal(ban2.status, 200);
  assert.equal(raw.prepare('SELECT banned FROM users WHERE id=?').get(sId).banned, 1, '作者已封禁');
  // 非管理员（有效令牌但角色非 admin）→ 403；被 ban 用户 token 已失效 → 401
  const eve = await registerWithContact(db, req(), { username: 'eve_t', password: 'pass123456', role: 'teacher' });
  const eveData = await eve.json();
  const nonAdmin = await handleContentAction(db, 'post', post2Id, { action: 'delete', reason: 'x', rule: 'x' }, req({ 'X-Auth-Token': eveData.authToken }));
  assert.equal(nonAdmin.status, 403);
  const bannedUser = await handleContentAction(db, 'post', post2Id, { action: 'delete', reason: 'x', rule: 'x' }, req({ 'X-Auth-Token': sData.authToken }));
  assert.equal(bannedUser.status, 401);
});

test('D1/D2：合同与签约请求提取 + 处罚（审查补丁覆盖）', async () => {
  const { raw, db, req } = await setup();
  semanticPass();
  const teaReg = await registerWithContact(db, req(), { username: 'teach0', password: 'pass123456', role: 'teacher' });
  const teaToken = (await teaReg.json()).authToken;
  await registerWithContact(db, req(), { username: 'stud0', password: 'pass123456', role: 'student' });
  // 建教师档案（teacher 类型处罚定位走 dbGetTeacherProfile，无档案行 → 404）
  const prof = await (await import('../src/server/domains/teacher/api.js')).handleSaveProfile(db, {
    profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, intro: '教法严谨', address: '浦东新区·陆家嘴街道', school: '上财' },
  }, req({ 'X-Auth-Token': teaToken }));
  assert.equal(prof.status, 200);
  const teaId = raw.prepare("SELECT id FROM users WHERE username='teach0'").get().id;
  const stuId = raw.prepare("SELECT id FROM users WHERE username='stud0'").get().id;
  // 直接造会话 + 合同 + 签约请求（D1/D2 提取/处罚覆盖；完整签约流见 signing-hardening.test.js）
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(stuId, teaId);
  const convId = raw.prepare('SELECT MAX(id) AS id FROM conversations').get().id;
  raw.prepare(`INSERT INTO contracts (conversation_id, drafter_user_id, method, plan, hourly_rate, pay_method, first_lesson_date, contract_md, status)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(convId, teaId, 'online', '每周两次，每次两小时，梳理高二数学', 200, 'wechat', '2026-08-20', '# 辅导计划', 'pending');
  raw.prepare(`INSERT INTO signing_requests (conversation_id, initiator_user_id, price, schedule, method, status) VALUES (?,?,?,?,?,?)`)
    .run(convId, teaId, 200, '每周六下午', 'online', 'pending');
  const contractId = raw.prepare('SELECT MAX(id) AS id FROM contracts').get().id;
  const signingId = raw.prepare('SELECT MAX(id) AS id FROM signing_requests').get().id;

  const token = await adminToken(db, raw);
  const rc = await handleAdminContent(db, new URL('http://x/api/admin/content?type=contract'), req({ 'X-Auth-Token': token }));
  assert.equal(rc.status, 200);
  const contract = (await rc.json()).items.find(i => i.id === contractId);
  assert.ok(contract, '合同被提取');
  assert.equal(contract.author.username, 'teach0');
  assert.ok(String(contract.body).includes('每周两次'), '合同正文含 plan/schedule');
  const rs = await handleAdminContent(db, new URL('http://x/api/admin/content?type=signing'), req({ 'X-Auth-Token': token }));
  assert.equal(rs.status, 200);
  const signing = (await rs.json()).items.find(i => i.id === signingId);
  assert.ok(signing, '签约请求被提取');
  assert.equal(signing.author.username, 'teach0');
  assert.ok(String(signing.body).includes('每周六'), '签约正文含 schedule');

  // 处罚：超长原因+超长规则 → 通知三段截断预算生效（审查补丁：三段分预算）。
  // 真实回归：reason 222 字（≥200，旧逻辑取满 200 后仍余 148）+ rule 23 字（旧逻辑 100），
  // 旧逻辑组合文本 ~228 > 200 被 notifyUser 库层截断丢尾部「每周两次」摘要关键词；
  // 新预算三段各取 80/30/40 → 总长 152 ≤200 且摘要关键词存活。判别断言是
  // notif.text.includes('每周两次')——旧逻辑必失败、新逻辑通过，杜绝假绿（二次审查实测确认）。
  const longReason = '发布包含完整门牌号码的内容，严重违反平台隐私保护红线，已多次警告仍不改正，'.repeat(6); // 222 字（≥200）
  const delC = await handleContentAction(db, 'contract', contractId, { action: 'delete', reason: longReason, rule: '地址门控与隐私红线，内容安全审核，恶意规避审核', capToken: await capOf(raw, token) }, req({ 'X-Auth-Token': token }));
  assert.equal(delC.status, 200, JSON.stringify(await delC.json()));
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE id=?').get(contractId).c, 0, '合同已删除');
  const notif = raw.prepare('SELECT text FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(teaId);
  assert.ok(notif, '通知已生成');
  assert.ok(notif.text.length <= 200, `通知总长 ${notif.text.length} ≤ 200`);
  assert.ok(notif.text.includes('触发内容'), '触发内容摘要未被截断丢弃');
  assert.ok(notif.text.includes('每周两次'), '摘要内容存活（三段预算保住 summary）');
  assert.ok(notif.text.includes('地址门控与隐私红线'), '规则段存活（rule≤30 截断后前缀保留）');
  const delS = await handleContentAction(db, 'signing', signingId, { action: 'delete', reason: '包含可定位地址', rule: '地址门控', capToken: await capOf(raw, token) }, req({ 'X-Auth-Token': token }));
  assert.equal(delS.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests WHERE id=?').get(signingId).c, 0, '签约请求已删除');
  // teacher 档案 delete/remove → 400 拒绝（无硬删分支，API 直发不许 no-op 假装成功）
  const teaDel = await handleContentAction(db, 'teacher', teaId, { action: 'delete', reason: 'x', rule: 'x' }, req({ 'X-Auth-Token': token }));
  assert.equal(teaDel.status, 400, 'teacher delete 直接拒绝');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM users WHERE id=?').get(teaId).c, 1, '教师账户未被删除');
  const teaBan = await handleContentAction(db, 'teacher', teaId, { action: 'ban', reason: '档案含可定位地址', rule: '地址门控', capToken: await capOf(raw, token) }, req({ 'X-Auth-Token': token }));
  assert.equal(teaBan.status, 200, 'teacher ban 仍可用');
  assert.equal(raw.prepare('SELECT banned FROM users WHERE id=?').get(teaId).banned, 1, '教师已封禁');
});

// v1.0 R7：注册必绑核心凭证（手机号/邮箱任一 + 验证码）——stub 捕获 code 后注册
async function registerWithContact(db, reqObj, { username, role = 'student', password = 'pass123456', channel = 'sms' }, phone = '') {
  const target = channel === 'email' ? `${username}@test.dev` : (phone || '+86139' + String(Math.floor(Math.random() * 90000000) + 10000000));
  const otp = await requestOtp(db, { channel, target }, reqObj);
  if (!otp.ok) throw new Error('发码失败');
  const body = { username, password, role, agreeAgreement: true, agreePrivacy: true };
  if (channel === 'email') { body.email = target; body.otpChannel = 'email'; }
  else { body.phone = target; body.otpChannel = 'sms'; }
  body.code = lastOtpCode(target);
  if (role === 'teacher') { // v1.2.0 T4：教师注册须邀请码——测试预置一枚
    const adminId = (db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first() || {}).id || 1;
    const invite = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?,?)').run(invite, adminId);
    body.inviteCode = invite;
  }
  return await handleRegister(db, body, reqObj);
}
