/**
 * notify push choke (new-site foundation, in-place reuse of v2 core/notify.js).
 *
 * Locks the acceptance surface:
 * - initNotifyTable is idempotent: re-calling it on an existing table must be a no-op
 * (rows preserved, no duplicate columns, index present).
 * - notifyUser enforces the NOTIFY_TYPES contract (D4): type must be a registered key and
 * params keys must be a subset of the type shape. Violations are refused AND recorded via
 * notify.invalid_type / notify.invalid_params — never silently stored (a stored row with a
 * bad type would render as an empty notification client-side, invisible corruption).
 * - S0 keeps the full v2 type set as an intermediate state (type reduction is S6-N2).
 * - A successful push stores a structured row.
 *
 * Mutations (reverting each fix makes these assertions go red):
 * - initNotifyTable: remove IF NOT EXISTS -> second call throws "table already exists";
 * DROP+recreate would lose rows -> red.
 * - notifyUser: remove the type-registry check -> a wrong-type row is stored -> red.
 * - notifyUser: remove the params-subset check -> an extra-key row is stored -> red.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initNotifyTable, notifyUser } from '../src/server/core/notify.js';
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

test('S0-15 initNotifyTable: idempotent — re-call preserves rows, no duplicate columns, index present', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw); // initDb already created the table via initNotifyTable
  await notifyUser(db, stu, 'CONTRACT_SIGNED', {});
  const before = raw.prepare('SELECT COUNT(*) c FROM notifications').get().c;
  await initNotifyTable(db); // mutation: unconditional CREATE / DROP+recreate -> throws or loses rows -> red
  await initNotifyTable(db); // second re-call must also be a no-op
  const cols = raw.prepare('PRAGMA table_info(notifications)').all().map(c => c.name);
  for (const required of ['id', 'user_id', 'text', 'is_read', 'created_at', 'batch_id', 'type', 'params']) {
    assert.ok(cols.includes(required), `column ${required} present after re-init`);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, before, 're-init preserves existing rows');
  const idx = raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications' AND name='idx_notify_user'").get();
  assert.ok(idx, 'idx_notify_user index present after re-init');
});

test('S0-15 notifyUser contract: unknown type refused + recorded notify.invalid_type', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  await notifyUser(db, stu, 'NOT_A_REAL_TYPE', {});
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0,
    'unknown type never stored (mutation: drop registry check -> row stored -> red)');
  const log = raw.prepare("SELECT detail FROM activity_log WHERE action='notify.invalid_type'").get();
  assert.ok(log, 'invalid type recorded for observability (E1)');
});

test('S0-15 notifyUser contract: extra params keys refused + recorded notify.invalid_params', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  await notifyUser(db, stu, 'CONTRACT_DRAFT_SENT', { name: '张老师', extra: 1 });
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, 0,
    'extra-key row never stored (mutation: drop subset check -> row stored -> red)');
  const log = raw.prepare("SELECT detail FROM activity_log WHERE action='notify.invalid_params'").get();
  assert.ok(log, 'invalid params recorded (E1)');
});

test('S0-15 notifyUser valid push: stores structured row', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  await notifyUser(db, stu, 'CONTRACT_DRAFT_SENT', { name: '张老师' });
  const row = raw.prepare('SELECT user_id, text, type, params FROM notifications').get();
  assert.equal(row.type, 'CONTRACT_DRAFT_SENT');
  assert.equal(row.text, '', 'structured rows leave text empty (client renders from type+params)');
  assert.deepEqual(JSON.parse(row.params), { name: '张老师' });
});

test('S0-15 middle state: every registered v2 type passes the push contract (reduction deferred to S6-N2)', async () => {
  const { NOTIFY_TYPES } = await import('../src/shared/codes.js');
  const raw = rawOf(); const db = d1Shim(raw);
  const { stu } = await seed(db, raw);
  for (const type of Object.keys(NOTIFY_TYPES)) {
    const params = {};
    for (const k of Object.keys(NOTIFY_TYPES[type])) params[k] = k === 'subjects' ? ['math'] : 'x';
    await notifyUser(db, stu, type, params);
  }
  assert.equal(raw.prepare('SELECT COUNT(*) c FROM notifications').get().c, Object.keys(NOTIFY_TYPES).length,
    'each registered type produces exactly one row — full v2 set kept as S0 intermediate state');
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM activity_log WHERE action LIKE 'notify.invalid_%'").get().c, 0,
    'no validation rejections across the full registered set');
});
