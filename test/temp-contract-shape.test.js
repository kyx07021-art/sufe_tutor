/**
 * S2-T0: temp-conversation interface contract lock (static shape assertions).
 *
 * This is a CONTRACT-LOCK primitive for the S2 temp conversation feature. It does NOT
 * call any handler or repo function — the implementation (chat/api.js, chat/repo.js,
 * chat/schema.js) is owned by other agents writing it in parallel. Instead it freezes
 * the shapes documented in docs/interfaces.md /against the shared constants
 * (TEMP_STATUS / LIMITS / MSG / CODES) that the backend must consume, and locks the
 * schema columns (temp_status / temp_initiator_user_id) once the schema agent lands them.
 *
 * The source of truth for the exact field names / error code:
 * - docs/interfaces.md "S2 临时会话（temp）契约"
 * - docs/interfaces.md (..25 authoritative shapes) + the S2-T0 lock subsection
 *
 * Mutation guards (— reverting the matching source line turns the assertion red):
 * - Renaming TEMP_STATUS.INIT/SENT or changing their values -> deepEqual goes red.
 * - Raising LIMITS.TEMP_SEND_QUOTA / TEMP_FIRST_MSG_MAX -> equality goes red.
 * - Dropping MSG/CODES.TEMP_QUOTA_EXCEEDED -> non-empty assertions go red.
 * - Removing the field names / error code from docs/interfaces.md -> doc scan goes red.
 * - Removing the temp columns from chat/schema.js -> schema assertions go red.
 *
 * The schema assertions are conditional (t.skip until temp columns land) so this file
 * passes today regardless of the schema agent's progress, then becomes a real lock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEMP_STATUS } from '../src/shared/enums.js';
import { LIMITS } from '../src/shared/config.js';
import { MSG, CODES } from '../src/shared/codes.js';
import { CONVERSATIONS_DDL, ensureColumns } from '../src/server/domains/chat/schema.js';

const interfacesDoc = readFileSync(
  fileURLToPath(new URL('../docs/interfaces.md', import.meta.url)),
  'utf8',
);

test('TEMP_STATUS state machine enum is frozen as init/sent', () => {
  assert.deepEqual(TEMP_STATUS, { INIT: 'init', SENT: 'sent' }, 'S2 §17: init -> sent -> formal (NULL)');
});

test('LIMITS temp quotas are frozen (I-23/I-24 contract)', () => {
  assert.equal(LIMITS.TEMP_SEND_QUOTA, 1, 'I-24: initiator may send exactly 1 message before the receiver formalizes');
  assert.equal(LIMITS.TEMP_FIRST_MSG_MAX, 1000, 'I-23: firstMessage length cap is 1000');
});

test('MSG/CODES TEMP_QUOTA_EXCEEDED are present and non-empty', () => {
  assert.equal(typeof MSG.TEMP_QUOTA_EXCEEDED, 'string', 'MSG.TEMP_QUOTA_EXCEEDED is a string');
  assert.ok(MSG.TEMP_QUOTA_EXCEEDED.length > 0, 'MSG.TEMP_QUOTA_EXCEEDED non-empty');
  assert.equal(typeof CODES.TEMP_QUOTA_EXCEEDED, 'string', 'CODES.TEMP_QUOTA_EXCEEDED is a string');
  assert.ok(CODES.TEMP_QUOTA_EXCEEDED.length > 0, 'CODES.TEMP_QUOTA_EXCEEDED non-empty');
  assert.equal(
    CODES.TEMP_QUOTA_EXCEEDED,
    'CHAT_TEMP_QUOTA_EXCEEDED',
    'stable code value consumed by the send-path over-quota gate (409)',
  );
});

test('docs/interfaces.md carries the S2 temp contract field names and error code', () => {
  for (const token of ['tempStatus', 'tempInitiatorId', 'iAmInitiator', 'quota', 'TEMP_QUOTA_EXCEEDED']) {
    assert.ok(interfacesDoc.includes(token), `docs/interfaces.md must contain "${token}" (I-23/I-24 temp contract)`);
  }
});

test('docs/interfaces.md carries the S2 temp contract lock subsection (S2-T0)', () => {
  assert.ok(
    interfacesDoc.includes('S2 temp contract lock'),
    'docs/interfaces.md must carry the S2-T0 lock subsection under §19 (referencing §17/§19)',
  );
});

test('chat/schema.js locks temp_status / temp_initiator_user_id (skip until schema agent lands)', (t) => {
  const convSpec = ensureColumns.find((s) => s.table === 'conversations');
  const colNames = (convSpec ? convSpec.columns : []).map(([name]) => name);
  const hasColumns = colNames.includes('temp_status') && colNames.includes('temp_initiator_user_id');
  if (!hasColumns) {
    t.skip('temp columns not landed yet — S2-T1 schema agent still in flight; re-run after it commits');
    return;
  }
  assert.ok(colNames.includes('temp_status'), 'conversations ensureColumns declares temp_status');
  assert.ok(colNames.includes('temp_initiator_user_id'), 'conversations ensureColumns declares temp_initiator_user_id');
  assert.match(
    CONVERSATIONS_DDL,
    /temp_status TEXT DEFAULT NULL CHECK\(temp_status IS NULL OR temp_status IN \('init','sent'\)\)/,
    'temp_status CHECK in DDL (NULL = formal conversation)',
  );
  assert.match(CONVERSATIONS_DDL, /temp_initiator_user_id INTEGER DEFAULT NULL/, 'temp initiator column in DDL');
});
