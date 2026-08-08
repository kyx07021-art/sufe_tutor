/**
 * 需求十四（2026-08-08）·聊天图片缩略图（v0.25.36）
 *
 * 需求原文：每张图生成缩略图，预载进会话立即展示，点开加载大图。
 *
 * 链路：上传时客户端同出全图+缩略图 → /api/uploads 存 thumb（加密）→ 发送凭 uploadId
 * 落消息（thumb 随搬）→ 列表接口对 image 消息下发解密 thumb（小字段不阻塞；大字段 body 仍
 * 懒加载走 attachment 接口）→ 前端缩略图即渲染、点开拉原图。
 *
 * 本测试覆盖（服务端；客户端渲染见 chat-bubble-restyle.test.js 同款 jsdom）：
 *   - handleCreateUpload 带 thumb → 落库（消息发送后 thumb 随搬）；
 *   - thumb 超体积（> LIMITS.THUMB_MAX_BYTES）/非 data:image → 拒绝不落库；
 *   - handleSendMessage 凭 uploadId 落消息 → messages.thumb 随搬；
 *   - handleGetMessages：image 消息返回解密 thumb（body 仍空串——大字段懒加载不变）；
 *   - 文件上传带 thumb → 忽略（thumb 只给图片）。
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
    ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare("SELECT id FROM users WHERE username=?").get(name).id;
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)')
    .run(idOf('s1'), idOf('t1'), null);
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { t1Token: await mkToken('t1'), s1Token: await mkToken('s1') };
}

const FULL = 'data:image/jpeg;base64,' + 'F'.repeat(2000);
const THUMB = 'data:image/jpeg;base64,' + 'T'.repeat(300);

test('上传带缩略图：thumb 落库；发送后随消息落库；列表返回解密 thumb（body 仍空）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token, s1Token } = await seed(db, raw);
  const up = await handleCreateUpload(db, { kind: 'image', fileData: FULL, fileName: 'a.jpg', thumb: THUMB }, reqOf(t1Token));
  assert.equal(up.status, 201);
  const { id } = await up.json();
  const upRow = raw.prepare('SELECT thumb FROM uploads WHERE id=?').get(id);
  assert.equal(await decryptField(upRow.thumb), THUMB, 'thumb 加密落暂存区，解密后一致');

  const sent = await handleSendMessage(db, 1, { uploadId: id }, reqOf(t1Token));
  assert.equal(sent.status, 201);
  const msg = raw.prepare('SELECT kind, body, thumb FROM messages ORDER BY id DESC LIMIT 1').get();
  assert.equal(msg.kind, 'image');
  assert.equal(await decryptField(msg.thumb), THUMB, 'thumb 随消息落库（密文搬移）');

  const list = await handleGetMessages(db, 1, msgUrl(1), reqOf(s1Token));
  const msgs = (await list.json()).messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].thumb, THUMB, '列表返回解密 thumb（预载即展示）');
  assert.equal(msgs[0].body, '', '大字段 body 仍不随列表下发（懒加载不变）');
});

test('缩略图超体积（> LIMITS.THUMB_MAX_BYTES）→ 拒绝，不落暂存区', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const big = 'data:image/jpeg;base64,' + 'T'.repeat(30000); // > 20000
  const up = await handleCreateUpload(db, { kind: 'image', fileData: FULL, fileName: 'a.jpg', thumb: big }, reqOf(t1Token));
  assert.equal(up.status, 400, '超体积缩略图应被拒（error 默认 400）');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 0, '不落库');
});

test('缩略图非 data:image → 拒绝；文件带 thumb → 忽略只存空', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { t1Token } = await seed(db, raw);
  const evil = await handleCreateUpload(db, { kind: 'image', fileData: FULL, fileName: 'a.jpg', thumb: 'javascript:alert(1)' }, reqOf(t1Token));
  assert.equal(evil.status, 400, '非 data:image 缩略图被拒');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, 0, '不落库');
  // 文件（非图片）带 thumb → 服务端忽略（thumb 只给图片）
  const f = await handleCreateUpload(db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: 'b.pdf', thumb: THUMB }, reqOf(t1Token));
  assert.equal(f.status, 201);
  const { id } = await f.json();
  assert.equal(raw.prepare('SELECT thumb FROM uploads WHERE id=?').get(id).thumb, '', '文件不存缩略图');
});
