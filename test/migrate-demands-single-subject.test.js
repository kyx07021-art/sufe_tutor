/**
 * S3-3: student_demands 数组模型 → 单科目新模型 迁移脚本实测（node --test）
 *
 * Locks the migration core (scripts/migrate-demands-single-subject.mjs):
 *   1. pure helpers: parseJsonArray / mapStatus / score extraction;
 *   2. computeMigratedRows: array→per-subject split, current_score single-value extraction,
 *      preferred/address/grade field carry-over, empty target_subjects drop;
 *   3. runMigrationOnLocal full drill: old shape → new shape, status mapping, idempotency,
 *      mixed-shape (schema.js ensureColumns path) re-split, --keep-old path;
 *   4. DDL parity with src/server/domains/demand/schema.js (column sets & order);
 *   5. buildApplySql generates SQL that parses and round-trips correctly.
 *
 * Mutation guards (delete the implementation → the assertion turns red):
 *   - mapStatus('contracted') === 'closed' / mapStatus('revoked') === 'open' (delete mapping → red);
 *   - split count after a 2-subject row (drop the loop → red);
 *   - idempotency signal (drop the subject!='' early-exit → re-run splits again → red).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  STUDENT_DEMANDS_NEW_DDL,
  parseJsonArray,
  mapStatus,
  computeMigratedRows,
  runMigrationOnLocal,
  describeTable,
  buildApplySql,
  hasUnmigratedRows,
} from '../scripts/migrate-demands-single-subject.mjs';
import { STUDENT_DEMANDS_DDL } from '../src/server/domains/demand/schema.js';

function rawOf() {
  const r = new DatabaseSync(':memory:');
  r.exec('PRAGMA foreign_keys = ON');
  return r;
}

/** Minimal legacy shape (v13-era columns the migration needs). */
function legacyRow(over = {}) {
  return {
    id: 1, user_id: 1, province: 'shanghai', student_grade: 'senior1',
    target_subjects: '["math","physics"]',
    current_scores: '[{"subject":"math","mode":"score","scale":100,"score":"120"},{"subject":"physics","mode":"grade","scale":0,"score":"","grade":"A"}]',
    teaching_method: 'online', address: '黄浦区·南京东路街道', expected_time: '[{"day":"sat"}]',
    preferred_personality_tags: '["patience"]', preferred_teacher_gender: 'female',
    budget_min: 150, budget_max: 200, additional_info: '', status: 'open',
    created_at: '2026-08-01 00:00:00',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
test('parseJsonArray: valid array / invalid JSON / null', () => {
  assert.deepEqual(parseJsonArray('["math","physics"]', null), ['math', 'physics']);
  assert.deepEqual(parseJsonArray('not-json', []), []);
  assert.deepEqual(parseJsonArray('{"a":1}', []), []);
  assert.equal(parseJsonArray(null, null), null);
  assert.deepEqual(parseJsonArray(undefined, []), []);
});

test('mapStatus: open→open, contracted→closed, revoked→open, unknown→open (mutation guard)', () => {
  assert.equal(mapStatus('open'), 'open');
  assert.equal(mapStatus('contracted'), 'closed'); // delete this mapping → red
  assert.equal(mapStatus('revoked'), 'open');      // delete this mapping → red
  assert.equal(mapStatus('closed'), 'closed');
  assert.equal(mapStatus(null), 'open');
  assert.equal(mapStatus('weird'), 'open');
});

// ---------------------------------------------------------------------------
// computeMigratedRows
// ---------------------------------------------------------------------------
test('computeMigratedRows: array → per-subject rows with score extraction and field carry-over', () => {
  const { rows, warnings, stats } = computeMigratedRows([legacyRow()]);
  assert.equal(rows.length, 2);
  assert.equal(stats.newRowCount, 2);
  assert.equal(stats.dropped, 0);

  const math = rows.find(r => r.subject === 'math');
  const physics = rows.find(r => r.subject === 'physics');
  assert.ok(math && physics, 'both split subjects present');

  assert.equal(math.current_score, '120');
  assert.equal(physics.current_score, 'A');          // score empty → grade letter fallback
  assert.equal(rows[0].grade, 'senior1');
  assert.equal(rows[0].province, 'shanghai');
  assert.equal(rows[0].address_area, '黄浦区·南京东路街道');
  assert.equal(rows[0].expected_time, '[{"day":"sat"}]');
  assert.equal(rows[0].preferred_tags, '["patience"]');
  assert.equal(rows[0].preferred_gender, 'female');
  assert.equal(rows[0].budget_min, 150);
  assert.equal(rows[0].budget_max, 200);
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].created_at, '2026-08-01 00:00:00');
  assert.equal(warnings.length, 0);
});

test('computeMigratedRows: status mapping applied per new row', () => {
  const contracted = computeMigratedRows([legacyRow({ status: 'contracted' })]);
  assert.ok(contracted.rows.every(r => r.status === 'closed'));
  const revoked = computeMigratedRows([legacyRow({ status: 'revoked' })]);
  assert.ok(revoked.rows.every(r => r.status === 'open'));
});

test('computeMigratedRows: empty/invalid target_subjects dropped with warning (no dirty rows)', () => {
  const empty = computeMigratedRows([legacyRow({ target_subjects: '[]' }), legacyRow({ id: 2, target_subjects: 'garbage' })]);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.stats.dropped, 2);
  assert.equal(empty.warnings.length, 2);
});

test('computeMigratedRows: no score entry → empty current_score', () => {
  const { rows } = computeMigratedRows([legacyRow({ current_scores: '[]' })]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.current_score === ''));
});

test('computeMigratedRows: mixed-shape row with non-empty subject copied verbatim', () => {
  const mixed = {
    id: 9, user_id: 1, subject: 'math', grade: 'senior1', province: 'shanghai',
    teaching_method: 'online', current_score: '99', address_area: '黄浦区·南京东路街道',
    expected_time: '', preferred_tags: '["kind"]', preferred_gender: '',
    budget_min: 100, budget_max: 150, additional_info: '', status: 'contracted',
    created_at: '2026-08-03 00:00:00',
    // legacy columns still present (schema.js ensureColumns path)
    target_subjects: '["math","physics"]', current_scores: '[]', student_grade: 'senior1',
    address: 'x', preferred_personality_tags: '["old"]', preferred_teacher_gender: 'male',
  };
  const { rows } = computeMigratedRows([mixed], { hasSubject: true });
  assert.equal(rows.length, 1, 'already-migrated row is not re-split');
  assert.equal(rows[0].subject, 'math');
  assert.equal(rows[0].current_score, '99');
  assert.equal(rows[0].preferred_tags, '["kind"]');
  assert.equal(rows[0].status, 'closed', 'status still converged on copy');
});

// ---------------------------------------------------------------------------
// runMigrationOnLocal full drill
// ---------------------------------------------------------------------------
function buildOldSchema(raw) {
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT)`);
  raw.prepare("INSERT INTO users (username, role) VALUES ('s1','student'),('s2','student')").run();
  raw.exec(`CREATE TABLE student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      student_grade TEXT NOT NULL, student_gender TEXT NOT NULL,
      target_subjects TEXT NOT NULL, current_scores TEXT NOT NULL,
      teaching_method TEXT NOT NULL DEFAULT 'offline',
      address TEXT DEFAULT '', address_detail TEXT DEFAULT '',
      expected_time TEXT DEFAULT '',
      budget_min REAL DEFAULT 0, budget_max REAL DEFAULT 0,
      submitter_type TEXT NOT NULL, parent_contact TEXT NOT NULL,
      student_contact TEXT NOT NULL, additional_info TEXT DEFAULT '',
      target_type TEXT NOT NULL DEFAULT 'academic',
      preferred_personality_tags TEXT NOT NULL DEFAULT '[]',
      preferred_teacher_gender TEXT NOT NULL DEFAULT '',
      teaching_goal TEXT NOT NULL DEFAULT '[]',
      skill_notes TEXT NOT NULL DEFAULT '[]',
      province TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
}

function insertOld(raw, r) {
  raw.prepare(`INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects,
      current_scores, teaching_method, address, expected_time, budget_min, budget_max, submitter_type,
      parent_contact, student_contact, additional_info, preferred_personality_tags,
      preferred_teacher_gender, province, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.user_id, r.student_grade, 'female', r.target_subjects, r.current_scores,
      r.teaching_method, r.address, r.expected_time, r.budget_min, r.budget_max, 'self',
      '', '', r.additional_info, r.preferred_personality_tags,
      r.preferred_teacher_gender, r.province, r.status, r.created_at);
}

test('runMigrationOnLocal: old shape rebuilt into new shape with correct split/status/idempotency', () => {
  const raw = rawOf();
  buildOldSchema(raw);
  insertOld(raw, legacyRow({ id: 1, status: 'open' }));
  insertOld(raw, legacyRow({ id: 2, user_id: 2, student_grade: 'middle2', target_subjects: '["chinese"]',
    current_scores: '[{"subject":"chinese","mode":"grade","scale":0,"score":"","grade":"B"}]', status: 'contracted' }));
  insertOld(raw, legacyRow({ id: 3, user_id: 2, target_subjects: '[]', status: 'open' }));

  assert.equal(hasUnmigratedRows(raw, 'student_demands'), true, 'old shape needs migration');
  const r = runMigrationOnLocal(raw);
  assert.equal(r.alreadyMigrated, false);
  assert.equal(r.stats.newRowCount, 3, '2-subject + 1-subject = 3 new rows; empty row dropped');
  assert.equal(r.stats.dropped, 1);

  const cols = describeTable(raw, 'student_demands');
  assert.ok(cols.includes('subject') && !cols.includes('target_subjects'), 'new shape in place');

  const rows = raw.prepare('SELECT subject, current_score, status, user_id, province FROM student_demands ORDER BY id').all();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r2 => r2.subject).sort(), ['chinese', 'math', 'physics']);
  assert.equal(rows.find(r2 => r2.subject === 'math').current_score, '120');
  assert.equal(rows.find(r2 => r2.subject === 'physics').current_score, 'A');
  assert.equal(rows.find(r2 => r2.subject === 'chinese').current_score, 'B');
  assert.equal(rows.find(r2 => r2.subject === 'chinese').status, 'closed', 'contracted → closed');
  assert.ok(rows.filter(r2 => r2.subject !== 'chinese').every(r2 => r2.status === 'open'));
  assert.ok(rows.every(r2 => r2.province === 'shanghai'));
  assert.ok(rows.every(r2 => r2.user_id === 1 || r2.user_id === 2));

  // Idempotency: a second run must be a no-op (all subjects non-empty).
  assert.equal(hasUnmigratedRows(raw, 'student_demands'), false, 'no empty-subject rows remain');
  const again = runMigrationOnLocal(raw);
  assert.equal(again.alreadyMigrated, true, 're-run is a no-op');
  const cnt = Number(raw.prepare('SELECT COUNT(*) n FROM student_demands').get().n);
  assert.equal(cnt, 3, 'row count unchanged after re-run');
});

test('runMigrationOnLocal: --keep-old preserves the legacy table', () => {
  const raw = rawOf();
  buildOldSchema(raw);
  insertOld(raw, legacyRow({ status: 'open' }));
  const r = runMigrationOnLocal(raw, { keepOld: true });
  assert.equal(r.alreadyMigrated, false);
  const cols = describeTable(raw, 'student_demands');
  assert.ok(cols.includes('subject'), 'new table named student_demands');
  const legacyCols = describeTable(raw, 'student_demands_legacy');
  assert.ok(legacyCols.includes('target_subjects'), 'legacy table preserved with old shape');
  assert.equal(Number(raw.prepare('SELECT COUNT(*) n FROM student_demands_legacy').get().n), 1);
  assert.equal(Number(raw.prepare('SELECT COUNT(*) n FROM student_demands').get().n), 2, 'split rows present');
});

test('runMigrationOnLocal: mixed shape (subject column present + empty-subject rows) re-split correctly', () => {
  // Simulate the schema.js ensureColumns path: new columns added to the legacy table, old rows untouched.
  const raw = rawOf();
  raw.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT)`);
  raw.exec(`CREATE TABLE student_demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      subject TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL DEFAULT '', province TEXT DEFAULT '',
      teaching_method TEXT NOT NULL DEFAULT 'online', current_score TEXT DEFAULT '',
      address_area TEXT DEFAULT '', preferred_tags TEXT NOT NULL DEFAULT '[]',
      preferred_gender TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      target_subjects TEXT, current_scores TEXT, student_grade TEXT, address TEXT,
      preferred_personality_tags TEXT, preferred_teacher_gender TEXT, created_at DATETIME)`);
  raw.prepare("INSERT INTO users (username) VALUES ('s1')").run();
  // one already-migrated row + two legacy rows needing split
  raw.prepare(`INSERT INTO student_demands (user_id, subject, grade, status, target_subjects, current_scores, created_at)
    VALUES (1,'','','open','["math","physics"]','[{"subject":"math","score":"120"}]','2026-08-01 00:00:00')`).run();
  raw.prepare(`INSERT INTO student_demands (user_id, subject, grade, status, target_subjects, current_scores, created_at)
    VALUES (1,'','','contracted','["chinese"]','[{"subject":"chinese","grade":"B"}]','2026-08-02 00:00:00')`).run();

  assert.equal(hasUnmigratedRows(raw, 'student_demands'), true, 'empty-subject rows need migration');
  const r = runMigrationOnLocal(raw);
  assert.equal(r.alreadyMigrated, false);
  assert.equal(r.stats.newRowCount, 3, '2 + 1 split rows');
  const rows = raw.prepare('SELECT subject, current_score, status FROM student_demands ORDER BY subject').all();
  assert.deepEqual(rows.map(x => x.subject).sort(), ['chinese', 'math', 'physics']);
  assert.equal(rows.find(x => x.subject === 'math').current_score, '120');
  assert.equal(rows.find(x => x.subject === 'chinese').status, 'closed');
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) n FROM student_demands WHERE subject=''`).get().n), 0);
});

test('runMigrationOnLocal: throws on inconsistent intermediate state (empty subject + no target_subjects)', () => {
  const raw = rawOf();
  raw.exec(`CREATE TABLE student_demands (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open')`);
  raw.prepare(`INSERT INTO student_demands (subject, status) VALUES ('','open')`).run();
  assert.throws(() => runMigrationOnLocal(raw), /inconsistent intermediate state/);
});

// ---------------------------------------------------------------------------
// DDL parity with the S3 domain schema
// ---------------------------------------------------------------------------
test('DDL parity: script new-table columns match schema.js STUDENT_DEMANDS_DDL (names & order)', () => {
  const raw = rawOf();
  raw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  raw.exec(STUDENT_DEMANDS_NEW_DDL);
  raw.exec(STUDENT_DEMANDS_DDL);
  const scriptCols = describeTable(raw, 'student_demands_new');
  const schemaCols = describeTable(raw, 'student_demands');
  assert.deepEqual(scriptCols, schemaCols, 'column sets and order must stay in lockstep with schema.js');
  raw.close();
});

// ---------------------------------------------------------------------------
// buildApplySql (production path)
// ---------------------------------------------------------------------------
test('buildApplySql: valid SQL that round-trips split rows into the new table', () => {
  const { rows } = computeMigratedRows([legacyRow()]);
  const sql = buildApplySql(rows, { keepOld: false });
  assert.ok(sql.includes('DROP TABLE student_demands'));
  assert.ok(sql.includes('ALTER TABLE student_demands_new RENAME TO student_demands'));
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_demands_subject_status'));

  // Executing the SQL against an old-shape DB reproduces the local migration result.
  const raw = rawOf();
  buildOldSchema(raw);
  insertOld(raw, legacyRow({ status: 'open' }));
  raw.exec(sql);
  const newRows = raw.prepare('SELECT subject, current_score, status FROM student_demands ORDER BY subject').all();
  assert.deepEqual(newRows.map(x => x.subject).sort(), ['math', 'physics']);
  assert.equal(newRows.find(x => x.subject === 'math').current_score, '120');
  assert.equal(newRows.find(x => x.subject === 'physics').current_score, 'A');
  assert.ok(newRows.every(x => x.status === 'open'));
  raw.close();
});

test('buildApplySql: SQL-injection-safe escaping of single quotes in user text', () => {
  const tricky = legacyRow({ additional_info: "it's \"quoted\" — O'Brien", preferred_personality_tags: '["a","b"]' });
  const { rows } = computeMigratedRows([tricky]);
  const sql = buildApplySql(rows);
  // The single quotes are doubled, so the generated SQL parses and the text round-trips exactly.
  const raw = rawOf();
  raw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  raw.exec('INSERT INTO users (id) VALUES (1)');
  raw.exec(STUDENT_DEMANDS_NEW_DDL);
  // Manually run just the INSERT statements (they target student_demands_new; the DROP/RENAME
  // part of the file is exercised by the round-trip test above).
  const inserts = sql.split(';\n').filter(s => /^INSERT INTO student_demands_new/.test(s));
  for (const ins of inserts) raw.exec(ins);
  const row = raw.prepare(`SELECT additional_info, preferred_tags FROM student_demands_new WHERE subject='math'`).get();
  assert.equal(row.additional_info, "it's \"quoted\" — O'Brien");
  assert.equal(row.preferred_tags, '["a","b"]');
  raw.close();
});
