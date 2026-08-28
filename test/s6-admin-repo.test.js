/**
 * S6-A3 + S6-A8 repo-layer guards (src/server/domains/admin/repo.js).
 *
 * S6-A3 (awards offline + S3 single-subject demand):
 *   - COUNT_TABLES whitelist drops teacher_awards -> dbGetCountWhere(table='teacher_awards') is 0
 *     before any SQL runs. Mutation: re-add 'teacher_awards' to COUNT_TABLES -> COUNT(*) hits a
 *     missing table -> throws -> red.
 *   - dbGetRecentDemands reads the S3 single-subject shape (subject, not the target_subjects array).
 *     Mutation: revert the SELECT to target_subjects -> no such column -> throws -> red.
 *
 * S6-A8 (signing layer dropped, S5 standalone contracts table):
 *   - CONTENT_SQL.contract reads `contracts` (no stage/signing layer). Mutation: revert to
 *     signing_contracts -> missing table -> throws -> red.
 *   - The `signing` content type is fully removed; CONTENT_TYPES auto-narrows (derived from
 *     CONTENT_SQL keys). Mutation: re-add a signing key to CONTENT_SQL -> CONTENT_TYPES contains
 *     'signing' -> assertion red.
 *
 * The test creates ONLY the tables the repo SQL touches (users/student_demands/contracts) instead of
 * running full initDb, so it stays green independently of other S3/S5/api in-flight modules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  dbGetCountWhere,
  dbGetRecentDemands,
  dbGetAllContentAdmin,
  CONTENT_TYPES,
} from '../src/server/domains/admin/repo.js';

// Same D1-shim shape as the admin/content test fixtures (prepare + batch over node:sqlite).
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
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
      const out = [];
      for (const s of stmts) out.push({ results: raw.prepare(s._sql).all(...s._params) });
      return out;
    },
  };
}

async function setup() {
  const raw = new DatabaseSync(':memory:');
  // Minimal S3/S5-shaped tables — the only ones admin/repo.js SQL touches in this test.
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT)`);
  raw.exec(`CREATE TABLE student_demands (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    subject TEXT, grade TEXT, status TEXT DEFAULT 'open', created_at DATETIME DEFAULT (datetime('now')))`);
  raw.exec(`CREATE TABLE contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, drafter_user_id INTEGER,
    plan TEXT, schedule TEXT, contract_status TEXT, created_at DATETIME DEFAULT (datetime('now')))`);
  // NOTE: no teacher_awards and no signing_contracts tables — their absence IS the mutation guard.
  const db = d1Shim(raw);
  return { raw, db };
}

test('S6-A3: COUNT_TABLES whitelist drops teacher_awards (dbGetCountWhere returns 0)', async () => {
  const { db } = await setup();
  // teacher_awards is offline () and NOT in COUNT_TABLES -> gate short-circuits to 0 before SQL.
  // Mutation: re-add 'teacher_awards' to COUNT_TABLES -> SELECT COUNT(*) hits a missing table -> throws -> red.
  assert.equal(await dbGetCountWhere(db, 'teacher_awards', "status='pending'"), 0, 'awards pending count gated to 0');
});

test('S6-A3: dbGetRecentDemands reads the S3 single-subject shape (subject, not target_subjects)', async () => {
  const { raw, db } = await setup();
  raw.prepare("INSERT INTO users (username, role) VALUES ('stu1', 'student')").run();
  const u = raw.prepare('SELECT id FROM users WHERE username=?').get('stu1');
  raw.prepare("INSERT INTO student_demands (user_id, subject, grade, status) VALUES (?, 'math', 'senior1', 'open')").run(u.id);
  const rows = await dbGetRecentDemands(db);
  assert.equal(rows.length, 1, 'one recent demand');
  assert.equal(rows[0].subject, 'math', 'subject read from single-subject column');
  assert.equal(rows[0].grade, 'senior1', 'grade read from new column');
  assert.equal(rows[0].username, 'stu1', 'joins users');
  // Mutation: revert SELECT to target_subjects -> no such column -> throws -> red.
  assert.ok(!('target_subjects' in rows[0]), 'no legacy target_subjects array field on the row');
});

test('S6-A8: CONTENT_SQL.contract reads the S5 standalone contracts table', async () => {
  const { raw, db } = await setup();
  raw.prepare("INSERT INTO users (username, role) VALUES ('teach1', 'teacher')").run();
  const u = raw.prepare('SELECT id FROM users WHERE username=?').get('teach1');
  raw.prepare("INSERT INTO contracts (drafter_user_id, plan, schedule, contract_status) VALUES (?, '每周两次', '周六下午', 'signed')").run(u.id);
  const cid = raw.prepare('SELECT MAX(id) AS id FROM contracts').get().id;
  // Mutation: revert CONTENT_SQL.contract to signing_contracts -> missing table -> throws -> red.
  const items = await dbGetAllContentAdmin(db, { type: 'contract' });
  const row = items.find(i => i.id === cid);
  assert.ok(row, 'contract extracted');
  assert.equal(row.type, 'contract');
  assert.equal(row.author.username, 'teach1', 'author from drafter_user_id join');
  assert.equal(row.status, 'signed', 'contract_status aliased to status');
  assert.ok(String(row.body).includes('每周两次'), 'body carries plan/schedule');
});

test('S6-A8: signing content type fully removed; CONTENT_TYPES auto-narrows', async () => {
  // CONTENT_TYPES is derived from CONTENT_SQL keys -> dropping the signing key narrows the list.
  // Mutation: re-add a signing key to CONTENT_SQL -> 'signing' reappears -> red.
  assert.ok(!CONTENT_TYPES.includes('signing'), 'no signing type in the content registry');
  assert.ok(CONTENT_TYPES.includes('contract'), 'contract type retained');
  assert.ok(CONTENT_TYPES.includes('post') && CONTENT_TYPES.includes('demand'), 'core types retained');
});
