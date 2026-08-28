/**
 * （中）通知列表接口形状不符 —— 服务端渲染 + 偏好过滤守护测试
 *
 * 锁定的验收面（docs/interfaces.md）：
 * - GET /api/notifications 每行携带 { id, type, title, content, created_at, is_read, avatar_src }；
 * title/content 由服务端按 type + params 渲染（前端零自行渲染）。
 * - 服务端按用户偏好过滤：blockSystemNotifications=true 滤系统类通知（avatar_src='system'），
 * notifyBroadcastMuted=true 滤广播（type='BROADCAST'）。
 * - 旧行（type NULL）回落存储 text 作 content。
 * - renderCompletenessGap 为空——新增 NOTIFY_TYPES 键必须同时补渲染条目/avatar_src 分类（D4 同变更集纪律）。
 *
 * 变异守护（，还原修复即红 → 还原绿）：
 * - 删 notif-render.js NOTIF_RENDER 条目 / renderNotification 返回空 title → title 断言红。
 * - 删 mapNotification 的 rendered 装配 → title/content/avatar_src 缺失 → 红。
 * - 删 handleGetNotifications 的 blockSystemNotifications 过滤分支 → 系统通知仍出现 → 红。
 * - 删 notifyBroadcastMuted 过滤分支 → 广播仍出现 → 红。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import {
  notifyUser, dbBroadcastNotification, handleGetNotifications,
} from '../src/server/core/notify.js';
import {
  renderNotification, renderCompletenessGap,
} from '../src/server/core/notif-render.js';
import { NOTIFY_TYPES } from '../src/shared/codes.js';
import { tokenDigest } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('a','h','s','student'),('b','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const a = idOf('a'), b = idOf('b');
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { a, b, aToken: await mkToken('a'), bToken: await mkToken('b') };
}

const setPref = (raw, userId, col, v) => raw.prepare(`UPDATE users SET ${col}=? WHERE id=?`).run(v ? 1 : 0, userId);

// ============================ 渲染纯函数 ============================

test('PA-1a2-F1 renderNotification: every registered type renders non-empty title/content + classified avatar_src', async () => {
  const { NOTIFY_TYPES } = await import('../src/shared/codes.js');
  for (const type of Object.keys(NOTIFY_TYPES)) {
    const params = {};
    for (const k of Object.keys(NOTIFY_TYPES[type])) {
      params[k] = k === 'verifyType' ? 'chsi' : k === 'action' ? 'ban' : '张老师';
    }
    if (type === 'BROADCAST') { params.title = '版本更新'; params.text = '本次更新了若干内容'; }
    const r = renderNotification(type, params);
    assert.ok(r.title, `${type} title non-empty`);
    assert.ok(r.content, `${type} content non-empty`);
    assert.ok(r.avatar_src === 'user' || r.avatar_src === 'system', `${type} avatar_src classified`);
  }
});

test('PA-1a2-F1 renderNotification: exact Chinese for contract / verify / penalty / broadcast', () => {
  assert.deepEqual(renderNotification('CONTRACT_DRAFT_SENT', { name: '张老师' }), {
    title: '合同确认', content: '「张老师」发来一份合同草案，请前往「我的合同」查看并确认', avatar_src: 'user',
  });
  assert.deepEqual(renderNotification('VERIFY_APPROVED', { verifyType: 'chsi', detail: '上海财经大学' }), {
    title: '核验通过', content: '学信网学籍核验已通过\n核验信息：上海财经大学', avatar_src: 'system',
  });
  assert.equal(renderNotification('VERIFY_APPROVED', { verifyType: 'admission' }).content,
    '录取通知书核验已通过，你的接单资格已开放');
  assert.equal(renderNotification('CONTENT_PENALTY', { label: '帖子', rule: '违规', action: 'ban', reason: '广告', summary: '某正文' }).content,
    '你的帖子因违反规则「违规」被管理员封禁账户。原因：广告。触发内容：某正文');
  assert.equal(renderNotification('CONTENT_PENALTY', { label: '帖子', action: 'remove' }).content,
    '你的帖子因违反规则「平台规则」被管理员移除内容。原因：');
  assert.deepEqual(renderNotification('BROADCAST', { title: '版本更新', text: '本次更新了若干内容' }), {
    title: '版本更新', content: '本次更新了若干内容', avatar_src: 'system',
  });
});

test('PA-1a2-F1 renderNotification: unknown / legacy type degrades to empty title/content with system avatar', () => {
  assert.deepEqual(renderNotification(null, null), { title: '', content: '', avatar_src: 'system' });
  assert.deepEqual(renderNotification('SIGNING_REQUEST_SENT', {}), { title: '', content: '', avatar_src: 'system' });
});

test('PA-1a2-F1 renderCompletenessGap: every NOTIFY_TYPES key has a render entry + avatar classification', () => {
  // 同变更集纪律：新增通知类型必须同时补渲染，否则前端渲染空通知不可见。
  assert.deepEqual(renderCompletenessGap(), [], 'no registered type missing render/avatar entry');
});

// ============================ 端点（） ============================

test('I-26 handleGetNotifications: rows carry title/content/avatar_src (server-side rendered)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'CONTRACT_DRAFT_SENT', { name: '张老师' });
  await notifyUser(db, a, 'VERIFY_APPROVED', { verifyType: 'chsi', detail: '上海财经大学' });
  const res = await handleGetNotifications(db, reqOf(aToken));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.notifications), 'body carries { notifications: [...] }');
  assert.equal(body.notifications.length, 2);
  const byType = Object.fromEntries(body.notifications.map(n => [n.type, n]));
  // mutation: drop mapNotification rendered assembly -> title/content/avatar_src absent -> red
  assert.equal(byType.CONTRACT_DRAFT_SENT.title, '合同确认');
  assert.equal(byType.CONTRACT_DRAFT_SENT.content, '「张老师」发来一份合同草案，请前往「我的合同」查看并确认');
  assert.equal(byType.CONTRACT_DRAFT_SENT.avatar_src, 'user');
  assert.equal(byType.VERIFY_APPROVED.title, '核验通过');
  assert.equal(byType.VERIFY_APPROVED.content, '学信网学籍核验已通过\n核验信息：上海财经大学');
  assert.equal(byType.VERIFY_APPROVED.avatar_src, 'system');
});

test('I-26 blockSystemNotifications=true filters system notifications, keeps user events', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'CONTRACT_SIGNED', {});          // user event
  await notifyUser(db, a, 'VERIFY_APPROVED', { verifyType: 'chsi' }); // system
  await dbBroadcastNotification(db, '版本更新', '本次更新了若干内容'); // system
  setPref(raw, a, 'blockSystemNotifications', true);
  const res = await handleGetNotifications(db, reqOf(aToken));
  const body = await res.json();
  const types = body.notifications.map(n => n.type);
  // mutation: drop the blockSystem filter branch -> system rows reappear -> red
  assert.deepEqual(types, ['CONTRACT_SIGNED'], 'system notifications filtered, user event kept');
});

test('I-26 notifyBroadcastMuted=true filters broadcast only, keeps others', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'CONTRACT_SIGNED', {});
  await notifyUser(db, a, 'VERIFY_APPROVED', { verifyType: 'chsi' });
  await dbBroadcastNotification(db, '版本更新', '本次更新了若干内容');
  setPref(raw, a, 'notifyBroadcastMuted', true);
  const res = await handleGetNotifications(db, reqOf(aToken));
  const body = await res.json();
  const types = body.notifications.map(n => n.type);
  // mutation: drop the mutedBroadcast filter branch -> BROADCAST reappears -> red
  assert.deepEqual(types, ['VERIFY_APPROVED', 'CONTRACT_SIGNED'], 'broadcast filtered, contract + verify kept');
});

test('I-26 prefs off: no filtering', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  await notifyUser(db, a, 'CONTRACT_SIGNED', {});
  await dbBroadcastNotification(db, '版本更新', '本次更新了若干内容');
  const res = await handleGetNotifications(db, reqOf(aToken));
  const body = await res.json();
  assert.equal(body.notifications.length, 2, 'no prefs -> all rows returned');
});

test('I-26 legacy rows (type NULL) fall back to stored text as content', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { a, aToken } = await seed(db, raw);
  raw.prepare("INSERT INTO notifications (user_id, text, type, params) VALUES (?, '旧渲染文案', NULL, NULL)").run(a);
  const res = await handleGetNotifications(db, reqOf(aToken));
  const body = await res.json();
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].title, '', 'legacy row has no structured title');
  assert.equal(body.notifications[0].content, '旧渲染文案', 'legacy row content falls back to stored text');
  assert.equal(body.notifications[0].avatar_src, 'system', 'legacy row classified as system');
  assert.equal(body.notifications[0].params, null);
});
