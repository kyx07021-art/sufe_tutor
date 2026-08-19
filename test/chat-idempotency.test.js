/**
 * Q-2d 聊天域审计修复守护测试（F1 初始加载取最近 / F2 幂等去重 / F3 空消息文案 / F4 附件净化 /
 * F5 会话列表预览查询会话集限定回归）
 *
 * F2 幂等契约（Q-2d-F2）：
 *   - 批量发送逐项携带 clientKey（'批次键.条目序'），服务端整批全部键已落库 → 视为超时重发，
 *     返回既有回执（不重复落库、不重复删暂存——首次已删，重发若再查附件归属必 404）；
 *   - 部分键命中 = 键被复用的异常形状 → 409 拒绝防半新半旧混插；
 *   - 不带键（老协议）→ 正常落库 client_key=NULL。
 *   - DB 层兜底：messages(conversation_id, sender_user_id, client_key) 部分唯一索引。
 *
 * F1 契约：sinceId=0 初始加载取最近 MSG_LIMIT 条（DESC 取最新再反转升序，前端按序渲染并取
 * 末条 id 作轮询游标）；sinceId>0 增量轮询保持升序。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateUpload, handleSendMessage, handleGetMessages } from '../src/server/domains/chat/api.js';
import { dbGetMessages, dbGetMyConversations } from '../src/server/domains/chat/repo.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('t1','h','s','teacher'),('t2','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)')
    .run(idOf('s1'), idOf('t1'), null);
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { t1Token: await mkToken('t1'), s1Token: await mkToken('s1'), t2Token: await mkToken('t2'), idOf };
}

const FULL = 'data:image/jpeg;base64,' + 'F'.repeat(2000);
const THUMB = 'data:image/jpeg;base64,' + 'T'.repeat(300);

/** 以 t1 身份暂存一个附件，返回 uploadId */
async function stageOneUpload(db, raw, t1Token) {
  const im = await handleCreateUpload(db, { kind: 'image', fileData: FULL, fileName: 'a.jpg', thumb: THUMB }, reqOf(t1Token));
  return (await im.json()).id;
}

test('Q-2d-F2 幂等：带键批量发送落库 → 同键重发返回既有回执、不重复落库、暂存不二次删', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const imgId = await stageOneUpload(db, raw, t1Token);
  const batch = [{ kind: 'image', uploadId: imgId, clientKey: 'sbK.0' }, { kind: 'text', body: '你好', clientKey: 'sbK.1' }];

  // 首次发送：201 落库 2 条 + 暂存删除
  const first = await handleSendMessage(db, 1, { batch }, reqOf(t1Token));
  assert.equal(first.status, 201);
  const { messages: m1 } = await first.json();
  assert.equal(m1.length, 2);
  assert.ok(m1[0].id > 0 && m1[1].id > m1[0].id, 'id 递增');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '首次落 2 条');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 0, '暂存已删');

  // 同键重发（模拟超时重试）：返回既有回执，不重复落库
  const retry = await handleSendMessage(db, 1, { batch }, reqOf(t1Token));
  assert.equal(retry.status, 201, '幂等重发仍 2xx');
  const { messages: m2 } = await retry.json();
  assert.deepEqual(m2.map(x => x.id), m1.map(x => x.id), '重发回执 id 与首次一致');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '重发不重复落库');
  assert.equal(raw.prepare("SELECT COUNT(*) AS c FROM messages WHERE client_key IS NOT NULL").get().c, 2, '幂等键随行落库');

  // 重发不炸在附件归属（uploads 已删，幂等早退必须先于附件单查）
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 0, '暂存仍为已删状态');
});

test('Q-2d-F2 幂等：纯文字批同键重发返回既有回执', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const batch = [{ kind: 'text', body: '好的', clientKey: 'sbL.0' }];
  const first = await handleSendMessage(db, 1, { batch }, reqOf(t1Token));
  assert.equal(first.status, 201);
  const retry = await handleSendMessage(db, 1, { batch }, reqOf(t1Token));
  assert.equal(retry.status, 201);
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 1, '纯文字批不重复');
});

test('Q-2d-F2 幂等：部分键命中 → 409（键被复用的异常形状）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  await handleSendMessage(db, 1, { batch: [{ kind: 'text', body: 'a', clientKey: 'sbP.0' }] }, reqOf(t1Token));
  // 第一条键复用 + 新键 → 部分命中 → 409 整批拒绝，不混插
  const mixed = await handleSendMessage(db, 1, {
    batch: [{ kind: 'text', body: 'a', clientKey: 'sbP.0' }, { kind: 'text', body: 'b', clientKey: 'sbP.1' }],
  }, reqOf(t1Token));
  assert.equal(mixed.status, 409, '部分键命中 409');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 1, '不混插新消息');
});

test('Q-2d-F2 幂等：不带键（老协议）正常落库 client_key=NULL', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const r = await handleSendMessage(db, 1, { batch: [{ kind: 'text', body: '老协议' }] }, reqOf(t1Token));
  assert.equal(r.status, 201);
  const row = raw.prepare('SELECT client_key FROM messages').get();
  assert.equal(row.client_key, null, '不带键落 NULL');
});

test('Q-2d-F1 初始加载：sinceId=0 取最近 MSG_LIMIT 条（升序）；增量轮询升序取新', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  // 直插 150 条历史消息（id 1..150）
  const ins = raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)');
  for (let i = 1; i <= 150; i++) ins.run(1, 1, 'text', 'm' + i);
  // sinceId=0：应返回 id 51..150（最近 100 条）升序，而非最早 100 条
  const init = await dbGetMessages(db, 1, 0);
  assert.equal(init.length, 100, '初始加载取 100 条');
  assert.equal(init[0].id, 51, '首条是最近 100 条的起点（旧实现取最早 → 首条 id=1）');
  assert.equal(init[init.length - 1].id, 150, '末条是最新');
  for (let i = 1; i < init.length; i++) assert.ok(init[i].id > init[i - 1].id, '升序返回');
  // sinceId=100：增量轮询返回 101..150 升序
  const inc = await dbGetMessages(db, 1, 100);
  assert.equal(inc.length, 50);
  assert.equal(inc[0].id, 101, '增量从 sinceId 之后取');
  assert.equal(inc[inc.length - 1].id, 150);
});

test('Q-2d-F3 空消息：空/纯空白返 INVALID_PARAMS（非 MESSAGE_TOO_LONG）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  for (const body of ['', '   ', '\t\n']) {
    const r = await handleSendMessage(db, 1, { batch: [{ kind: 'text', body }] }, reqOf(t1Token));
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.equal(j.code, 'COMMON_INVALID_PARAMS', `空消息「${JSON.stringify(body)}」code=INVALID_PARAMS`);
  }
  // 超长仍是 MESSAGE_TOO_LONG
  const long = await handleSendMessage(db, 1, { batch: [{ kind: 'text', body: 'x'.repeat(2001) }] }, reqOf(t1Token));
  assert.equal(long.status, 400);
  assert.equal((await long.json()).code, 'CHAT_MESSAGE_TOO_LONG', '超长仍报太长');
});

test('Q-2d-F4 附件文件名净化：路径分隔/控制字符剥离后落库', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const r = await handleCreateUpload(db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: '../evil\\name\x01.txt' }, reqOf(t1Token));
  assert.equal(r.status, 201);
  const u = raw.prepare('SELECT name FROM uploads ORDER BY id DESC LIMIT 1').get();
  assert.equal(u.name, '.._evil_name_.txt', '路径分隔与控制字符替换为 _');
});

test('Q-2d-F4 active-content 黑名单：javascript/ecmascript data URL 拒收', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  for (const prefix of ['data:application/javascript;base64,', 'data:text/javascript;base64,', 'data:application/ecmascript;base64,', 'data:text/ecmascript;base64,', 'data:application/x-javascript;base64,']) {
    const r = await handleCreateUpload(db, { kind: 'file', fileData: prefix + 'xxx', fileName: 'x.js' }, reqOf(t1Token));
    assert.equal(r.status, 400, `${prefix} 拒收`);
    const j = await r.json();
    assert.equal(j.code, 'CHAT_FILE_TYPE_BLOCKED', '黑名单拒绝码');
  }
  // 大小写绕过同样拒收
  const up = await handleCreateUpload(db, { kind: 'file', fileData: 'DATA:TEXT/JAVASCRIPT;BASE64,xxx', fileName: 'x' }, reqOf(t1Token));
  assert.equal(up.status, 400, '大小写绕过拒收');
  // 正常 pdf 放行
  const ok = await handleCreateUpload(db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: 'b.pdf' }, reqOf(t1Token));
  assert.equal(ok.status, 201);
});

test('Q-2d-F5 回归：会话列表预览/未读在会话集限定后仍正确', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, s1Token, idOf } = await seed(db, raw);
  const stu = idOf('s1'), tea = idOf('t1');
  // 教师发两条、学生发一条 → 学生侧未读 2，预览为教师最后一条
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(1, tea, 'text', '第一条');
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(1, stu, 'text', '学生回复');
  raw.prepare('INSERT INTO messages (conversation_id, sender_user_id, kind, body) VALUES (?,?,?,?)').run(1, tea, 'text', '教师第二条');
  const list = await dbGetMyConversations(db, stu);
  assert.equal(list.length, 1, '会话列出');
  assert.equal(list[0].last_body, '教师第二条', '预览 = 最新一条（文本）');
  assert.equal(list[0].last_sender, tea, '预览发送者正确');
  assert.equal(list[0].unread_count, 2, '学生侧未读 2（教师发的两条，已读游标 0）');
});
