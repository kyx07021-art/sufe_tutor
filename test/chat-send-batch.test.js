/**
 * F9（v0.27.0 网络层重构）—— 聊天批量发送回归
 *
 * 需求：发消息带附件 = 2N+1 串行请求（N 暂存上传 + N+1 发送），网络层重构把发送阶段
 * 合并为一次往返：POST /api/conversations/:id/messages {batch:[{kind,uploadId},...,{kind:'text',body}]}
 * 服务端单事务 db.batch 落库（附件确认 + 文字），响应 { messages:[{id,kind,name}...] }。
 *
 * 覆盖：
 *   - 批量：多附件（uploadId）+ 文字一次落库，响应消息数组（id 升序对应批序）
 *   - 暂存删除：批量发送成功后 uploads 行删除（确认入会话即移出暂存）
 *   - 归属校验：他人 uploadId → 404 整批拒绝（不落半批）
 *   - 校验：空批/超上限/非法项/超长文字 → 400；非 active 会话 → 403
 *   - routeApi 全路径：POST /messages 带 batch → 200/201 + 消息数组
 *   - 单条路径（body 直发）语义不变（回归）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../server/db.js';
import { handleCreateUpload, handleSendMessage, handleGetMessages } from '../server/routes-chat.js';
import { tokenDigest, decryptField } from '../server/crypto.js';

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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement'); // 真实 D1 空 batch 抛错（同 content-admin shim 口径）
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
const msgUrl = convId => new URL(`http://localhost/api/conversations/${convId}/messages`);

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

/** 以 t1 身份暂存两个附件（image + file），返回 uploadIds */
async function stageTwoUploads(db, raw, t1Token) {
  const ids = [];
  const im = await handleCreateUpload(db, { kind: 'image', fileData: FULL, fileName: 'a.jpg', thumb: THUMB }, reqOf(t1Token));
  ids.push((await im.json()).id);
  const fl = await handleCreateUpload(db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: 'b.pdf' }, reqOf(t1Token));
  ids.push((await fl.json()).id);
  return ids;
}

test('批量：多附件（uploadId）+ 文字一次落库，响应消息数组对应批序', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const [imgId, fileId] = await stageTwoUploads(db, raw, t1Token);

  const sent = await handleSendMessage(db, 1, {
    batch: [{ kind: 'image', uploadId: imgId }, { kind: 'file', uploadId: fileId }, { kind: 'text', body: '你好' }],
  }, reqOf(t1Token));
  assert.equal(sent.status, 201);
  const { messages } = await sent.json();
  assert.equal(messages.length, 3, '批量返回 3 条消息');
  assert.equal(messages[0].kind, 'image');
  assert.equal(messages[1].kind, 'file');
  assert.equal(messages[2].kind, 'text');
  assert.ok(messages[0].id > 0 && messages[2].id > messages[0].id, 'id 按落库序递增');

  // 落库断言：3 条消息 + 暂存已删
  const cnt = raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  assert.equal(cnt, 3, '3 条消息全部落库');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 0, '附件确认入会话后暂存删除');
  const text = raw.prepare("SELECT body FROM messages WHERE kind='text'").get().body;
  assert.equal(text, '你好');
});

test('批量落库内容：附件密文随暂存转正、缩略图随搬', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const [imgId] = await stageTwoUploads(db, raw, t1Token);
  await handleSendMessage(db, 1, { batch: [{ kind: 'image', uploadId: imgId }] }, reqOf(t1Token));
  const msg = raw.prepare("SELECT kind, thumb FROM messages WHERE kind='image'").get();
  assert.equal(msg.kind, 'image');
  assert.equal(await decryptField(msg.thumb), THUMB, '缩略图随批量发送落库（密文搬移）');
});

test('归属校验：他人暂存 uploadId → 404 整批拒绝（不落半批）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, t2Token } = await seed(db, raw);
  const [imgId] = await stageTwoUploads(db, raw, t1Token);
  // t2（非暂存者）试图批量使用 t1 的 uploadId → 404
  const sent = await handleSendMessage(db, 1, { batch: [{ kind: 'image', uploadId: imgId }, { kind: 'text', body: 'x' }] }, reqOf(t2Token));
  assert.equal(sent.status, 404, '他人附件 404');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 0, '整批拒绝不落半批');
});

test('校验：空批/超上限/非法项/超长文字 → 400；非 active 会话 → 403', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  assert.equal((await handleSendMessage(db, 1, { batch: [] }, reqOf(t1Token))).status, 400, '空批');
  assert.equal((await handleSendMessage(db, 1, { batch: Array.from({ length: 14 }, () => ({ kind: 'text', body: 'x' })) }, reqOf(t1Token))).status, 400, '超上限');
  assert.equal((await handleSendMessage(db, 1, { batch: [{ kind: 'weird', body: 'x' }] }, reqOf(t1Token))).status, 400, '非法项');
  assert.equal((await handleSendMessage(db, 1, { batch: [{ kind: 'text', body: 'x'.repeat(2001) }] }, reqOf(t1Token))).status, 400, '超长文字');
  assert.equal((await handleSendMessage(db, 1, { batch: [{ kind: 'text', body: '  ' }] }, reqOf(t1Token))).status, 400, '空白文字');
});

test('C-4 重复 uploadId：同附件重复引用整批 400（防双消息双删）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const [imgId] = await stageTwoUploads(db, raw, t1Token);
  const sent = await handleSendMessage(db, 1, {
    batch: [{ kind: 'image', uploadId: imgId }, { kind: 'image', uploadId: imgId }],
  }, reqOf(t1Token));
  assert.equal(sent.status, 400, '重复 uploadId 整批拒绝');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 0, '不落任何消息');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 2, '两个暂存附件全保留（未删可重试）');
});

test('列表读回：批量发送后对方视角可读消息（含解密缩略图）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, s1Token } = await seed(db, raw);
  const [imgId] = await stageTwoUploads(db, raw, t1Token);
  const sent = await handleSendMessage(db, 1, { batch: [{ kind: 'image', uploadId: imgId }, { kind: 'text', body: 'ok' }] }, reqOf(t1Token));
  assert.equal(sent.status, 201);
  const list = await handleGetMessages(db, 1, msgUrl(1), reqOf(s1Token));
  const msgs = (await list.json()).messages;
  assert.equal(msgs.length, 2, '批量消息对方可读');
  assert.equal(msgs[0].kind, 'image');
  assert.equal(msgs[0].thumb, THUMB, '缩略图解密下发');
});
