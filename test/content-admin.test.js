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
import { initDb } from '../server/db.js';
import { handleRegister, handleLogin } from '../server/routes-auth.js';
import { handleCreatePost } from '../server/routes-posts.js';
import { handleAdminContent, handleContentAction } from '../server/routes-audit.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
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

test('D1：统一内容提取（多类型归拢统一结构，私密字段不提取）', async () => {
  const { raw, db, req } = await setup();
  // 造数据：一个学生发帖 + 一个教师建档案
  const s = await handleRegister(db, { username: 'alice', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true }, req());
  const sData = await s.json();
  await handleCreatePost(db, { title: '物理笔记', bodyMd: '牛顿三大定律总结' }, req({ 'X-Auth-Token': sData.authToken }));
  const t = await handleRegister(db, { username: 'bobt', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true }, req());
  const tData = await t.json();
  const prof = await (await import('../server/routes-teacher.js')).handleSaveProfile(db, {
    profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, intro: '注重方法', address: '浦东新区杨高中路', school: '上财' },
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

test('D2：处罚——delete 删帖 + ban 封禁作者 + 自动通知作者 + 缺原因 400', async () => {
  const { raw, db, req } = await setup();
  const s = await handleRegister(db, { username: 'mallory', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true }, req());
  const sData = await s.json();
  const sId = raw.prepare("SELECT id FROM users WHERE username='mallory'").get().id;
  const postRes = await handleCreatePost(db, { title: '违规帖子', bodyMd: '含详细门牌号 88 号' }, req({ 'X-Auth-Token': sData.authToken }));
  const post = await postRes.json();
  const postId = raw.prepare('SELECT MAX(id) AS id FROM posts').get().id;

  const token = await adminToken(db, raw);
  // 缺原因 → 400
  const noReason = await handleContentAction(db, 'post', postId, { action: 'delete', rule: '隐私' }, req({ 'X-Auth-Token': token }));
  assert.equal(noReason.status, 400);
  // 删除帖子 → 200 + 通知作者
  const del = await handleContentAction(db, 'post', postId, { action: 'delete', reason: '含详细门牌号，违反隐私红线', rule: '地址门控' }, req({ 'X-Auth-Token': token }));
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
  const ban2 = await handleContentAction(db, 'post', post2Id, { action: 'ban', reason: '发布违规内容', rule: '内容安全' }, req({ 'X-Auth-Token': token }));
  assert.equal(ban2.status, 200);
  assert.equal(raw.prepare('SELECT banned FROM users WHERE id=?').get(sId).banned, 1, '作者已封禁');
  // 非管理员（有效令牌但角色非 admin）→ 403；被 ban 用户 token 已失效 → 401
  const eve = await handleRegister(db, { username: 'eve_t', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true }, req());
  const eveData = await eve.json();
  const nonAdmin = await handleContentAction(db, 'post', post2Id, { action: 'delete', reason: 'x', rule: 'x' }, req({ 'X-Auth-Token': eveData.authToken }));
  assert.equal(nonAdmin.status, 403);
  const bannedUser = await handleContentAction(db, 'post', post2Id, { action: 'delete', reason: 'x', rule: 'x' }, req({ 'X-Auth-Token': sData.authToken }));
  assert.equal(bannedUser.status, 401);
});

test('D1/D2：合同与签约请求提取 + 处罚（审查补丁覆盖）', async () => {
  const { raw, db, req } = await setup();
  await handleRegister(db, { username: 'teach0', password: 'pass123456', role: 'teacher', agreeAgreement: true, agreePrivacy: true }, req());
  await handleRegister(db, { username: 'stud0', password: 'pass123456', role: 'student', agreeAgreement: true, agreePrivacy: true }, req());
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

  // 处罚：超长原因+超长规则 → 通知截断钉在 NOTIF_TEXT_MAX 内（审查补丁：三段分预算）
  const longReason = '发布包含完整门牌号码的内容，严重违反平台隐私保护红线，已多次警告仍不改正，'.repeat(3);
  const delC = await handleContentAction(db, 'contract', contractId, { action: 'delete', reason: longReason, rule: '地址门控与隐私红线，内容安全审核，恶意规避审核' }, req({ 'X-Auth-Token': token }));
  assert.equal(delC.status, 200, JSON.stringify(await delC.json()));
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM contracts WHERE id=?').get(contractId).c, 0, '合同已删除');
  const notif = raw.prepare('SELECT text FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(teaId);
  assert.ok(notif && notif.text.length <= 200, `通知截断在 200 内，实际 ${notif && notif.text.length}`);
  const delS = await handleContentAction(db, 'signing', signingId, { action: 'delete', reason: '包含可定位地址', rule: '地址门控' }, req({ 'X-Auth-Token': token }));
  assert.equal(delS.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM signing_requests WHERE id=?').get(signingId).c, 0, '签约请求已删除');
});
