/**
 * S2-B6 + S5 handover signing-residue lock (new-site branch).
 *
 * S5 landed the standalone `contracts` table and DROPPED signing_contracts; the S2-B6 deferral is
 * LIFTED. This is the mutation guard for that cleanup: if anyone re-adds the signing residue
 * (the 6 signing helpers, dbGetConversationBindableDemands, dbSetMessageBody in chat/repo.js /
 * server/db.js, or handleGetConversationBindableDemands in chat/api.js), this file goes red.
 *
 * It is a static lock (node:test + assert/strict, NO d1Shim):
 *   1. The 6 signing helpers are no longer exported by chat/repo.js.
 *   2. dbGetConversationBindableDemands and dbSetMessageBody are no longer exported by chat/repo.js.
 *   3. None of the removed symbols are re-exported through server/db.js.
 *   4. handleGetConversationBindableDemands is gone from chat/api.js (source-level lock; the module
 *      graph pulls in server/db.js, so importing the whole module is heavier than needed here).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chatRepo from '../src/server/domains/chat/repo.js';
import * as dbShim from '../server/db.js';

const SIGNING_HELPERS = [
  'dbGetSigningById',
  'dbDeleteSigning',
  'dbGetPendingSigningForConversation',
  'dbCreateSigning',
  'dbConfirmSigning',
  'dbRejectSigning',
];

const DELETED_REPO_FUNCTIONS = [
  'dbGetConversationBindableDemands',
  'dbSetMessageBody',
];

test('S2-B6 lifted: 6 signing helpers are GONE from chat/repo.js', () => {
  for (const name of SIGNING_HELPERS) {
    assert.equal(typeof chatRepo[name], 'undefined', `${name} must NOT be exported from chat/repo.js`);
  }
});

test('S2-B6 lifted: bindable-demands + dbSetMessageBody are GONE from chat/repo.js', () => {
  for (const name of DELETED_REPO_FUNCTIONS) {
    assert.equal(typeof chatRepo[name], 'undefined', `${name} must NOT be exported from chat/repo.js`);
  }
});

test('S2-B6 lifted: removed symbols are not re-exported through server/db.js', () => {
  for (const name of [...SIGNING_HELPERS, ...DELETED_REPO_FUNCTIONS]) {
    assert.equal(typeof dbShim[name], 'undefined', `${name} must NOT be re-exported by server/db.js`);
  }
});

test('S2-B6 lifted: handleGetConversationBindableDemands is GONE from chat/api.js', () => {
  // Source-level lock: the handler export must no longer exist in chat/api.js.
  const src = readFileSync(new URL('../src/server/domains/chat/api.js', import.meta.url), 'utf8');
  assert.ok(
    !/export\s+async\s+function\s+handleGetConversationBindableDemands/.test(src),
    'chat/api.js must NOT export handleGetConversationBindableDemands'
  );
  assert.ok(
    !src.includes('handleGetConversationBindableDemands'),
    'chat/api.js must contain no reference to handleGetConversationBindableDemands'
  );
});
