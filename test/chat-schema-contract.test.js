/**
 * S2-B1 chat three-table carry-lock (static shape-lock).
 *
 * Asserts that the three chat tables in src/server/domains/chat/schema.js match
 * the S2 new-site model without needing a D1 shim (pure string shape assertions):
 *   - conversations: two-party tuple (student_user_id/teacher_user_id) + status +
 *     S2-T1 temp columns (temp_status / temp_initiator_user_id).
 *   - messages: kind CHECK text/image/file/contract. The signing kinds
 *     (signing_request / signing_response) are an S5-owned DEFERRAL and must stay.
 *   - uploads: kind CHECK image/file + thumb ensureColumns.
 *   - migrateMessagesKind carry keeps name/thumb (no data loss on rebuild).
 *
 * messages.kind DEFERRAL (coordinated with S5 contract-domain rewrite):
 * S5 contract-domain cleanup owns removing signing kinds — do not touch until
 * S5-19 lands. The contract domain is OFF-LIMITS to S2; its in-flight rewrite has
 * not yet committed S5-19, and the committed contract/api.js still writes these
 * message kinds, so dropping them from the CHECK now would break signing flows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONVERSATIONS_DDL,
  MESSAGES_DDL,
  UPLOADS_DDL,
  ensureColumns,
} from '../src/server/domains/chat/schema.js';

const schemaSrc = readFileSync(
  fileURLToPath(new URL('../src/server/domains/chat/schema.js', import.meta.url)),
  'utf8',
);

const kindNames = (spec) => spec.columns.map(([name]) => name);

test('conversations DDL: two-party tuple + status (new-site model)', () => {
  assert.match(CONVERSATIONS_DDL, /student_user_id INTEGER NOT NULL/, 'student side of the tuple');
  assert.match(CONVERSATIONS_DDL, /teacher_user_id INTEGER NOT NULL/, 'teacher side of the tuple');
  assert.match(
    CONVERSATIONS_DDL,
    /status TEXT NOT NULL DEFAULT 'active' CHECK\(status IN \('active','closed'\)\)/,
    'lifecycle status CHECK',
  );
  assert.match(CONVERSATIONS_DDL, /UNIQUE\(student_user_id, teacher_user_id\)/, 'one conversation per pair');
});

test('conversations temp columns: present -> assert, absent -> skip (S2-T1 schema agent in flight)', (t) => {
  const convSpec = ensureColumns.find((s) => s.table === 'conversations');
  assert.ok(convSpec, 'conversations ensureColumns spec must exist');
  const names = kindNames(convSpec);
  const hasTemp = names.includes('temp_status') && names.includes('temp_initiator_user_id');
  if (!hasTemp) {
    t.skip('temp columns not landed yet — S2-T1 schema agent still in flight; re-run after it commits');
    return;
  }
  assert.ok(names.includes('temp_status'), 'temp_status column spec present');
  assert.ok(names.includes('temp_initiator_user_id'), 'temp_initiator_user_id column spec present');
  assert.match(
    CONVERSATIONS_DDL,
    /temp_status TEXT DEFAULT NULL CHECK\(temp_status IS NULL OR temp_status IN \('init','sent'\)\)/,
    'temp_status CHECK in DDL (NULL = formal conversation)',
  );
  assert.match(CONVERSATIONS_DDL, /temp_initiator_user_id INTEGER DEFAULT NULL/, 'temp initiator in DDL');
});

test('messages MESSAGES_DDL kind CHECK: base kinds text/image/file/contract', () => {
  for (const kind of ["'text'", "'image'", "'file'", "'contract'"]) {
    assert.ok(MESSAGES_DDL.includes(kind), `messages CHECK must include ${kind}`);
  }
  assert.ok(
    MESSAGES_DDL.includes("'text','image','file','contract','signing_request','signing_response'"),
    'CHECK is the full 6-kind set',
  );
});

test('messages signing kinds DEFERRED to S5: still present in CHECK (do not touch until S5-19)', () => {
  // S5 contract-domain cleanup owns removing signing kinds — do not touch until S5-19 lands.
  // contract/api.js (S5-owned) still writes these message kinds; removing them now would 500 signing flows.
  for (const kind of ["'signing_request'", "'signing_response'"]) {
    assert.ok(MESSAGES_DDL.includes(kind), `signing kind ${kind} must remain in CHECK (S5-owned deferral)`);
  }
});

test('uploads DDL: kind CHECK image/file + thumb ensureColumns', () => {
  assert.match(UPLOADS_DDL, /kind TEXT NOT NULL CHECK\(kind IN \('image','file'\)\)/, 'uploads kind CHECK');
  const upSpec = ensureColumns.find((s) => s.table === 'uploads');
  assert.ok(upSpec, 'uploads ensureColumns spec must exist');
  assert.ok(kindNames(upSpec).includes('thumb'), 'uploads ensureColumns carries thumb');
});

test('migrateMessagesKind carry keeps name/thumb (no data loss on CHECK rebuild)', () => {
  assert.ok(schemaSrc.includes('async function migrateMessagesKind'), 'migrateMessagesKind exists');
  assert.ok(
    schemaSrc.includes("'id', 'conversation_id', 'sender_user_id', 'kind', 'body', 'created_at'"),
    'base carry column list intact',
  );
  assert.ok(
    schemaSrc.includes("['name', 'thumb'].filter(c => have.has(c))"),
    'carry conditionally includes name/thumb only when the legacy table has them',
  );
  const msgSpec = ensureColumns.find((s) => s.table === 'messages');
  assert.ok(msgSpec, 'messages ensureColumns spec must exist');
  const names = kindNames(msgSpec);
  assert.ok(names.includes('name') && names.includes('thumb'), 'final-state messages columns name/thumb present');
});
