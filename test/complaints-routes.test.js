/**
 * 需求二十二（R22）·投诉独立通道——服务端全链路
 *
 * 与用户反馈分表分通道（complaints 独立表 /api/complaints*）；对象候选搜索、
 * 最近交互拉取、快照防删、自投诉拦截、每日限额、管理员处理并通知。
 *
 * 覆盖：
 *   - 提交投诉：教师/学生/帖子三类对象 + 快照 + 理由白名单；非法对象/理由 400、对象不存在 404；
 *   - 自投诉拦截：投诉自己（用户）/ 自己帖子 400；
 *   - 每日限额：超过 COMPLAINT_DAILY_LIMIT → 429；
 *   - 我的投诉：仅本人数据、状态跟踪；
 *   - 候选搜索：按 id/昵称搜教师学生、按 id/标题搜帖子（排除自己）；
 *   - 最近交互：按消息时间取会话另一侧用户；
 *   - 管理员：列表 + 标记已处理 + 通知投诉人 + 幂等。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';
import {
  handleCreateComplaint, handleMyComplaints, handleAdminComplaints,
  handleComplaintCandidates, handleComplaintRecent, handleResolveComplaint,
} from '../server/routes-complaints.js';

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
    batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };
const reqOf = token => ({ headers: new Headers({ 'X-Auth-Token': token }) });
const reqOfAdmin = () => ({ headers: new Headers({ 'X-Auth-Token': 'admin-token' }) });
// 路由签名是裸 body 对象（与 complaint.test.js 一致），bodyOf 即恒等
const bodyOf = b => b;

async function seed(db, raw) {
  await initDb(db, ENV);
  // 管理员会话（initDb 播种 admin_sufe）
  const adminRow = raw.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
    .run(await tokenDigest('admin-token'), adminRow.id, 'sess-admin', 'x', '2099-01-01 00:00:00');
  // s1 学生、t1 教师、t2 教师
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('s1','h','s','student'),('t1','h','s','teacher'),('t2','h','s','teacher')`);
  const mk = async (name, user) => {
    const u = raw.prepare('SELECT id FROM users WHERE username=?').get(name);
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,session_id,label,expires_at) VALUES (?,?,?,?,?)')
      .run(await tokenDigest(token), u.id, `sess-${name}`, 'x', '2099-01-01 00:00:00');
    raw.prepare('INSERT INTO teacher_profiles (user_id, province, subjects) VALUES (?,?,?)')
      .run(u.id, 'shanghai', '[]');
    return { id: u.id, token };
  };
  const s1 = await mk('s1'), t1 = await mk('t1'), t2 = await mk('t2');
  // 帖子（t1 作者）+ 会话/消息（s1 与 t1 交互）
  raw.prepare("INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', ?, ?)").run(t1.id, '违规帖子标题', '内容');
  const postId = raw.prepare('SELECT id FROM posts ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1.id, t1.id);
  const convId = raw.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get().id;
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, body) VALUES (?,?,?)').run(convId, t1.id, '你好');
  return { s1, t1, t2, postId };
}

test('R22 提交投诉：教师/学生/帖子三类对象 + 快照 + 理由白名单', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, postId } = await seed(db, raw);
  // 投诉教师 t1
  const r1 = await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '虚假信息或欺诈', detail: '资料造假' }), reqOf(s1.token));
  assert.equal(r1.status, 201);
  // 投诉帖子
  const r2 = await handleCreateComplaint(db, bodyOf({ targetType: 'post', targetId: postId, reason: '违法违规内容', detail: '' }), reqOf(s1.token));
  assert.equal(r2.status, 201);
  const rows = raw.prepare('SELECT * FROM complaints ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target_type, 'teacher');
  assert.equal(rows[0].target_id, t1.id);
  const snap = JSON.parse(rows[0].target_snapshot);
  assert.equal(snap.name, 't1', '快照存用户名（防删后失标）');
  assert.equal(rows[1].target_type, 'post');
  assert.equal(rows[1].reason, '违法违规内容');
  // 非法：对象类型/理由
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'x', targetId: 1, reason: '虚假信息或欺诈' }), reqOf(s1.token))).status, 400);
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '胡编' }), reqOf(s1.token))).status, 400, '理由不在白名单');
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: 9999, reason: '虚假信息或欺诈' }), reqOf(s1.token))).status, 404, '对象不存在');
});

test('R22 自投诉拦截 + 每日限额', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, postId } = await seed(db, raw);
  // 学生投诉自己 → 400
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'student', targetId: s1.id, reason: '其他' }), reqOf(s1.token))).status, 400);
  // 投诉自己的帖子 → 400（s1 无帖，建一条）
  raw.prepare("INSERT INTO posts (user_id, section, title, body_md) VALUES (?, 'plaza', '我的帖', '')").run(s1.id);
  const myPost = raw.prepare("SELECT id FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1").get(s1.id).id;
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'post', targetId: myPost, reason: '其他' }), reqOf(s1.token))).status, 400, '不能投诉自己帖子');
  // 每日限额：LIMITS.COMPLAINT_DAILY_LIMIT 次后 429
  const LIMITS = (await import('../server/constants.js')).LIMITS;
  for (let i = 0; i < LIMITS.COMPLAINT_DAILY_LIMIT; i++) {
    const r = await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '其他' }), reqOf(s1.token));
    assert.equal(r.status, 201, `第 ${i + 1} 次允许`);
  }
  assert.equal((await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '其他' }), reqOf(s1.token))).status, 429, '超限拒绝');
});

test('R22 我的投诉：仅本人数据 + 状态跟踪', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, t2 } = await seed(db, raw);
  await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '其他' }), reqOf(s1.token));
  // t2 也投诉 t1，验证互不可见
  await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '其他' }), reqOf(t2.token));
  const mine = await handleMyComplaints(db, reqOf(s1.token));
  const data = await mine.json();
  assert.equal(data.complaints.length, 1, '仅本人投诉');
  assert.equal(data.complaints[0].target_snapshot.name, 't1');
  assert.equal(data.complaints[0].status, 'open');
});

test('R22 候选搜索：id/昵称搜用户（排除自己）、帖子按标题/id', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1, t2, postId } = await seed(db, raw);
  // 学生搜教师：t1/t2（不含自己）
  const byName = await handleComplaintCandidates(db, new URL('http://x/api/complaints/candidates?target=teacher&q=t'), reqOf(s1.token));
  const d1 = await byName.json();
  assert.equal(d1.candidates.length, 2, '昵称模糊搜到两名教师');
  assert.ok(d1.candidates.every(c => !['s1'].includes(c.name)), '不含学生本人');
  const byId = await handleComplaintCandidates(db, new URL(`http://x/api/complaints/candidates?target=teacher&q=${t2.id}`), reqOf(s1.token));
  const d2 = await byId.json();
  assert.equal(d2.candidates.length, 1, 'id 精确命中');
  assert.equal(d2.candidates[0].name, 't2');
  // 帖子
  const posts = await handleComplaintCandidates(db, new URL('http://x/api/complaints/candidates?target=post&q=违规'), reqOf(s1.token));
  const d3 = await posts.json();
  assert.equal(d3.candidates.length, 1);
  assert.equal(d3.candidates[0].name, '违规帖子标题');
});

test('R22 最近交互：按消息时间取会话另一侧（同角色过滤）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  const recent = await handleComplaintRecent(db, new URL('http://x/api/complaints/recent?target=teacher'), reqOf(s1.token));
  const data = await recent.json();
  assert.equal(data.candidates.length, 1, '最近交互教师一名');
  assert.equal(data.candidates[0].name, 't1');
  const stu = await handleComplaintRecent(db, new URL('http://x/api/complaints/recent?target=student'), reqOf(t1.token));
  const ds = await stu.json();
  assert.equal(ds.candidates.length, 1, '教师视角最近交互学生一名');
  assert.equal(ds.candidates[0].name, 's1');
});

test('R22 管理员：列表 + 标记已处理 + 通知投诉人 + 幂等', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { s1, t1 } = await seed(db, raw);
  await handleCreateComplaint(db, bodyOf({ targetType: 'teacher', targetId: t1.id, reason: '其他' }), reqOf(s1.token));
  const list = await handleAdminComplaints(db, new URL('http://x/api/complaints'), reqOfAdmin());
  const dl = await list.json();
  assert.equal(dl.complaints.length, 1);
  assert.equal(dl.complaints[0].reporter, 's1', '管理员看到投诉人');
  const id = dl.complaints[0].id;
  const resolve = await handleResolveComplaint(db, id, reqOfAdmin());
  assert.equal(resolve.status, 200);
  const row = raw.prepare('SELECT status, resolved_at FROM complaints WHERE id=?').get(id);
  assert.equal(row.status, 'resolved');
  assert.ok(row.resolved_at, '记录处理时间');
  const notif = raw.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=?').get(s1.id);
  assert.equal(notif.c, 1, '通知投诉人');
  // 幂等
  const again = await handleResolveComplaint(db, id, reqOfAdmin());
  assert.equal(again.status, 200);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=?').get(s1.id).c, 1, '重复处理不重复通知');
});
