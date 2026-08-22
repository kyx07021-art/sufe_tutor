/**
 * S6-S4: notification broadcast-mute preference — users.notifyBroadcastMuted column.
 *
 * - The column is declared cross-domain by auth/schema.js ensureColumns (idempotent,
 *   PRAGMA-probe-then-ALTER). This test locks that initDb produces the column:
 *   dropping the auth declaration makes the PRAGMA assertion go red (G2 mutation guard).
 * - dbGetNotifyBroadcastMuted / dbSetNotifyBroadcastMuted read/write it with strict
 *   boolean normalization; invalid/absent input keeps the stored value.
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbGetNotifyBroadcastMuted, dbSetNotifyBroadcastMuted } from '../src/server/domains/settings/repo.js';

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

async function seedUser(raw) {
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('u1','h','s','student')").run();
  return raw.prepare("SELECT id FROM users WHERE username='u1'").get().id;
}

test('initDb creates users.notifyBroadcastMuted + blockSystemNotifications (auth cross-domain declaration)', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const cols = raw.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  assert.ok(cols.includes('notifyBroadcastMuted'), 'users.notifyBroadcastMuted column must exist after initDb');
  assert.ok(cols.includes('blockSystemNotifications'), 'users.blockSystemNotifications column must exist after initDb');
});

test('default unmuted (false); set true stores 1 and reads back true; set false stores 0', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const id = await seedUser(raw);
  assert.equal(await dbGetNotifyBroadcastMuted(db, id), false, 'new user defaults to unmuted');
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, true), true, 'set true reads back true');
  assert.equal(raw.prepare('SELECT notifyBroadcastMuted FROM users WHERE id=?').get(id).notifyBroadcastMuted, 1, 'stored as 1');
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, false), false, 'set false reads back false');
  assert.equal(raw.prepare('SELECT notifyBroadcastMuted FROM users WHERE id=?').get(id).notifyBroadcastMuted, 0, 'stored as 0');
});

test('invalid/absent input keeps stored value; strict normalization accepts 0/1/true/false string forms', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  const id = await seedUser(raw);
  await dbSetNotifyBroadcastMuted(db, id, 1);
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, undefined), true, 'undefined keeps current');
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, 'yes'), true, 'arbitrary string keeps current (strict reject)');
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, '0'), false, '"0" string normalized to 0');
  assert.equal(await dbSetNotifyBroadcastMuted(db, id, 'true'), true, '"true" string normalized to 1');
});
