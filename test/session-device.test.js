/**
 * v0.25.11 设备会话去重回归（用户反馈「一堆 Edge 登录记录」根因修复）
 *
 * 根因：旧模型「设备 = 登录事件」——每次登录（新窗口/新标签/重登）都插一行 auth_sessions，
 * 账户设置设备列表堆成山（生产实证：kyx 账号一周 11 条 Edge，两条仅隔 11 秒）。
 * 修复：「设备 = 浏览器档案」——前端 localStorage 生成持久 deviceId，登录/注册随请求上传，
 * 服务端 issueAuthToken 按 (user_id, device_id) UPSERT 复用同一行（部分唯一索引 WHERE device_id != ''）。
 *
 * 覆盖（node:sqlite 真库，同 initdb-migration.test.js 的 D1 shim）：
 *   - 同 deviceId 反复登录 → 恒 1 行、session_id 稳定、旧令牌失效新令牌生效
 *   - 不同 deviceId → 各一行（多浏览器/无痕/手机）
 *   - 无 deviceId（老客户端/curl 脚本）→ 回落旧行为：每次登录新行（部分索引不约束空 device_id）
 *   - 非法 deviceId 格式 → 按无标识处理
 *   - 吊销后同设备重登 → 槽位释放新建行（新 session_id）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { issueAuthToken, getSessionByToken, listSessions, revokeSession } from '../src/server/core/session.js';

// node:sqlite → D1 形状薄封装（同 initdb-migration.test.js）
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else {
            const info = raw.prepare(s._sql).run(...s._params);
            out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
          }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  await initDb(d1Shim(raw), ENV);
  const uid = raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id;
  return { raw, uid };
}
const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const count = (raw, uid) => raw.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id=?').get(uid).n;

test('同 deviceId 反复登录：恒 1 行、session_id 稳定、旧令牌失效新令牌生效', async () => {
  const { raw, uid } = await setup();
  const t1 = await issueAuthToken(d1Shim(raw), uid, 'Windows · Edge', DEV_A);
  const first = raw.prepare('SELECT session_id FROM auth_sessions WHERE user_id=?').get(uid);
  assert.equal(count(raw, uid), 1, '首次登录 1 行');

  const t2 = await issueAuthToken(d1Shim(raw), uid, 'Windows · Edge', DEV_A);
  assert.equal(count(raw, uid), 1, '同设备重登仍 1 行（UPSERT 复用，不再堆行）');
  const second = raw.prepare('SELECT session_id, device_id, label FROM auth_sessions WHERE user_id=?').get(uid);
  assert.equal(second.session_id, first.session_id, 'session_id 稳定（设备管理同一入口）');
  assert.equal(second.device_id, DEV_A, 'device_id 落库');

  const db = d1Shim(raw);
  assert.equal(await getSessionByToken(db, uid, t1), undefined, '旧令牌已被新令牌顶替（token_hash 刷新）');
  assert.ok(await getSessionByToken(db, uid, t2), '新令牌有效');
});

test('不同 deviceId → 各一行（多浏览器/无痕/手机各自独立）', async () => {
  const { raw, uid } = await setup();
  await issueAuthToken(d1Shim(raw), uid, 'Windows · Edge', DEV_A);
  await issueAuthToken(d1Shim(raw), uid, 'Android · Chrome', DEV_B);
  assert.equal(count(raw, uid), 2, '两台设备两行');
  const db = d1Shim(raw);
  assert.equal((await listSessions(db, uid)).length, 2, '设备列表两条');
});

test('无 deviceId（老客户端/curl 脚本）→ 回落旧行为：每次登录新行', async () => {
  const { raw, uid } = await setup();
  await issueAuthToken(d1Shim(raw), uid, '未知设备 · 浏览器');
  await issueAuthToken(d1Shim(raw), uid, '未知设备 · 浏览器');
  assert.equal(count(raw, uid), 2, '无标识两次登录两行（部分唯一索引不约束空 device_id）');
});

test('非法 deviceId 格式按无标识处理（校验咽喉：仅接受 32 位 hex）', async () => {
  const { raw, uid } = await setup();
  await issueAuthToken(d1Shim(raw), uid, 'x', 'not-a-hex-device');
  await issueAuthToken(d1Shim(raw), uid, 'x', 'not-a-hex-device');
  assert.equal(count(raw, uid), 2, '非法格式不参与去重');
});

test('吊销后同设备重登：槽位释放新建行（新 session_id）', async () => {
  const { raw, uid } = await setup();
  const db = d1Shim(raw);
  await issueAuthToken(db, uid, 'Windows · Edge', DEV_A);
  const s = (await listSessions(db, uid))[0];
  assert.equal(await revokeSession(db, uid, s.session_id), true, '吊销命中');
  assert.equal(count(raw, uid), 0, '吊销后无行');
  await issueAuthToken(db, uid, 'Windows · Edge', DEV_A);
  assert.equal(count(raw, uid), 1, '重登新建一行');
  const s2 = (await listSessions(db, uid))[0];
  assert.notEqual(s2.session_id, s.session_id, '新会话新 session_id');
});
