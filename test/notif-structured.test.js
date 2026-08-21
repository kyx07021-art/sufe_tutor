/**
 * V-2-4 structured notifications regression:
 *  - server: notifyUser stores type + JSON params (text column empty for new rows),
 *    broadcast stores type='BROADCAST' + {title,text}; GET /api/notifications maps
 *    params back to an object.
 *  - client: notifBodyText / notifTypeText / notifSubjectsText render each type to
 *    the exact v1-parity text from constants/text.js single source; legacy rows
 *    (type NULL) fall back to the stored text; isBroadcastNotif accepts both the
 *    structured type and the legacy prefix.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { notifyUser, dbBroadcastNotification, initNotifyTable, handleGetNotifications } from '../src/server/core/notify.js';
import { logEvent, logDropStats } from '../src/server/core/log.js'; // Q-2b-F3/F4/F6 守护测试
import { tokenDigest } from '../src/server/core/crypto.js';
import { TEXT } from '../src/client/constants/text.js';
import { notifBodyText, notifTypeText, notifSubjectsText } from '../src/client/features/notif/render.js';
import { isBroadcastNotif } from '../src/client/core/notif-pref.js';

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

async function seed(db, raw) {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('stu','h','s','student'),('tea','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const mkToken = async name => {
    const token = `${name}-token`;
    raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
      .run(await tokenDigest(token), idOf(name), 'x', '2099-01-01 00:00:00');
    return token;
  };
  return { stu: idOf('stu'), tea: idOf('tea'), stuToken: await mkToken('stu'), teaToken: await mkToken('tea') };
}

// ============================ server ============================

test('notifyUser stores type + JSON params (text empty for new rows)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  await notifyUser(db, stu, 'INTENT_REJECTED', { subjects: ['math'], target_type: 'academic' });
  const row = raw.prepare('SELECT user_id, text, type, params FROM notifications').get();
  assert.equal(row.type, 'INTENT_REJECTED');
  assert.equal(row.text, '', '新结构化行 text 留空');
  assert.deepEqual(JSON.parse(row.params), { subjects: ['math'], target_type: 'academic' });
});

test('GET /api/notifications maps params JSON to an object', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu, stuToken } = await seed(db, raw);
  await notifyUser(db, stu, 'CONTRACT_DRAFT_SENT', { name: '张老师' });
  const res = await handleGetNotifications(db, { headers: new Headers({ 'X-Auth-Token': stuToken }) });
  assert.equal(res.status, 200);
  const { notifications } = (await res.json());
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'CONTRACT_DRAFT_SENT');
  assert.deepEqual(notifications[0].params, { name: '张老师' });
  assert.equal(notifications[0].text, '');
});

test('dbBroadcastNotification stores BROADCAST type + {title,text} with batch_id', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const count = await dbBroadcastNotification(db, '版本更新', '本次更新了若干内容');
  assert.ok(count >= 2, '所有未注销用户（seed 的 stu/tea + initDb 的 admin）都收到');
  const row = raw.prepare('SELECT type, params, batch_id FROM notifications LIMIT 1').get();
  assert.equal(row.type, 'BROADCAST');
  assert.deepEqual(JSON.parse(row.params), { title: '版本更新', text: '本次更新了若干内容' });
  assert.ok(row.batch_id, '广播带 batch_id（整批删除用）');
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications WHERE batch_id=?').get(row.batch_id).c, count);
});

// ============================ client render ============================

test('notifSubjectsText: academic via region names, nonacademic via projects, empty -> fallback', () => {
  assert.equal(notifSubjectsText(['math', 'chinese'], 'academic'), '数学、语文');
  assert.equal(notifSubjectsText(['music'], 'nonacademic'), '乐器/音乐');
  assert.equal(notifSubjectsText([], 'academic'), TEXT.NOTIF_SUBJECTS_FALLBACK);
});

test('notifBodyText renders each structured type to the v1-parity text', () => {
  const cases = [
    ['INTENT_ACCEPTED', {}, TEXT.NOTIF_INTENT_ACCEPTED],
    ['INTENT_REJECTED', { subjects: ['math'], target_type: 'academic' },
      '关于「数学」的家教需求，学生已经和更合适的老师建立了联系。你的档案仍在教师广场展示，新的匹配机会会继续推送。'],
    ['PUSH_ACCEPTED', {}, TEXT.NOTIF_PUSH_ACCEPTED],
    ['CONTRACT_DRAFT_SENT', { name: '张老师' }, '「张老师」发来一份合同草案，请前往「我的合同」查看并确认'],
    ['CONTRACT_SIGNED', {}, TEXT.NOTIF_CONTRACT_SIGNED],
    ['CONTRACT_REVOKED', { name: '张老师' }, '「张老师」已撤销双方签署的合同，活跃数据已抹除，存证留档保留。'],
    ['CONVERSATION_CLOSED', { name: '张老师' }, '「张老师」已结束与你的合作关系，本会话已关闭。进行中的签约已自动取消，未完成的合同已自动撤销。'],
    ['SIGNING_REQUEST_SENT', { name: '张老师' }, '「张老师」向你发送了签约请求'],
    ['FEEDBACK_COMPLAINT_RESOLVED', {}, TEXT.NOTIF_FEEDBACK_COMPLAINT_RESOLVED],
    ['VERIFY_APPROVED', { verifyType: 'chsi', detail: '示例大学 · 大一' },
      `学信网学籍核验已通过\n核验信息：示例大学 · 大一`],
    ['VERIFY_APPROVED', { verifyType: 'admission', detail: '示例大学' },
      `录取通知书核验已通过，你的接单资格已开放\n核验信息：示例大学`],
    ['VERIFY_REJECTED', { reason: '图片模糊' }, `学信网学籍核验未通过，请重新提交验证码\n图片模糊`],
    ['VERIFY_REVOKED', { reason: '材料造假' }, `你的接单资格已被管理员撤销，可重新提交学信网核验\n材料造假`],
    ['AWARD_APPROVED', { title: '数学竞赛' }, '你的荣誉奖项「数学竞赛」已通过审核，将展示在你的教师主页。'],
    ['CONTENT_PENALTY', { label: '帖子', rule: '广告', reason: '营销内容', summary: 'xxx', action: 'ban' },
      '你的帖子因违反规则「广告」被管理员封禁账户。原因：营销内容。触发内容：xxx'],
    ['CONTENT_PENALTY', { label: '评价', rule: '', reason: '不当言论', summary: '', action: 'remove' },
      `你的评价因违反规则「${TEXT.NOTIF_RULE_FALLBACK}」被管理员移除内容。原因：不当言论`],
  ];
  for (const [type, params, expected] of cases) {
    assert.equal(notifBodyText({ type, params }), expected, `type ${type}`);
  }
});

test('notifBodyText: legacy rows (type NULL) fall back to stored text; broadcast composes prefix', () => {
  assert.equal(notifBodyText({ type: null, text: '旧文案' }), '旧文案');
  assert.equal(
    notifBodyText({ type: 'BROADCAST', params: { title: '版本更新', text: '正文' } }),
    `${TEXT.NOTIFY_BROADCAST_PREFIX}版本更新\n正文`);
  assert.equal(notifBodyText({ type: 'BROADCAST', params: { title: '', text: '无标题广播' } }), '无标题广播');
});

test('isBroadcastNotif: structured BROADCAST type and legacy prefix both classify', () => {
  assert.equal(isBroadcastNotif({ type: 'BROADCAST', params: {}, text: '' }), true);
  assert.equal(isBroadcastNotif({ type: 'INTENT_ACCEPTED', text: '' }), false);
  assert.equal(isBroadcastNotif({ type: null, text: `${TEXT.NOTIFY_BROADCAST_PREFIX}旧广播` }), true);
  assert.equal(isBroadcastNotif({ type: null, text: '普通旧通知' }), false);
});

// NOTIFY_TYPES registry is the single source: every type key has a NOTIF_<KEY> template
test('NOTIFY_TYPES registry completeness: every type has a client template', async () => {
  const { NOTIFY_TYPES } = await import('../src/shared/codes.js');
  const SPECIAL = ['VERIFY_APPROVED', 'VERIFY_REJECTED', 'VERIFY_REVOKED', 'CONTENT_PENALTY', 'BROADCAST']; // 特殊渲染（条件/子类组合），上面已逐型断言
  for (const type of Object.keys(NOTIFY_TYPES)) {
    if (SPECIAL.includes(type)) continue;
    assert.ok(TEXT['NOTIF_' + type], `type ${type} has NOTIF_${type} template`);
  }
  assert.equal(notifTypeText('SIGNING_CONFIRMED', {}), TEXT.NOTIF_SIGNING_CONFIRMED);
});

// ========== Q-2b-F6/F4/F3 守护测试（Q-2a~Q-2e 审计 FAIL 点补齐，2026-08-20）==========
// F6: notifyUser 错 type/多余 params 键拒绝写入 + 留档（变异删校验块 → 红）
test('Q-2b-F6：notifyUser 错 type/多余键拒绝写入 + 留档 notify.invalid_*', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  await notifyUser(db, stu, 'NOT_A_TYPE', {});
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0, '错 type 不落库');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM activity_log WHERE action='notify.invalid_type'").get().c, 1, '错 type 留档 notify.invalid_type');
  await notifyUser(db, stu, 'CONTRACT_DRAFT_SENT', { name: 'x', extra: 1 });
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0, '多余 params 键不落库');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM activity_log WHERE action='notify.invalid_params'").get().c, 1, '多余键留档 notify.invalid_params');
  await notifyUser(db, stu, 'CONTRACT_DRAFT_SENT', { name: '合法' });
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 1, '合法调用仍落库');
});

// F4: 通知插入失败留档 notify.fail（变异删 catch 留档 → 红）
test('Q-2b-F4：通知插入失败留档 notify.fail（不再静默吞）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('INSERT INTO notifications')) throw new Error('D1 down');
    return origPrepare(sql);
  };
  await notifyUser(db, stu, 'INTENT_ACCEPTED', {});
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0, '通知未落库');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM activity_log WHERE action='notify.fail'").get().c, 1, '失败留档 notify.fail');
});

// F3: logEvent 写库失败 dropped 计数递增（变异删 droppedLogs++ → 红）
test('Q-2b-F3：logEvent 写库失败 dropped 计数递增（零可观测性修复）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await seed(db, raw);
  const before = logDropStats().dropped;
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (String(sql).includes('INSERT INTO activity_log')) throw new Error('log db down');
    return origPrepare(sql);
  };
  await logEvent(db, { action: 'test.fail', actorUserId: 1, entity: 'x', detail: {} });
  const after = logDropStats().dropped;
  assert.ok(after > before, `dropped 递增（before=${before} after=${after}）`);
});
