/**
 * S2- attachment staging carry — C7 / security contract lock.
 *
 * Locks the uploads staging invariants carried from v2 into the new-site backend:
 * 1. dataURL blacklist (C7 active-content): svg/html/xml/javascript/ecmascript data URLs
 * are rejected at the API edge (fileDataBlocked), never reach the uploads table.
 * 2. Blacklist is case-insensitive (mutation guard: removing `.toLowerCase()` makes
 * mixed-case MIME types slip through → red).
 * 3. Case-variant data: prefixes (DATA:TEXT/HTML, data:Image/SVG+xml) are still rejected —
 * the API prefix gate is case-sensitive and rejects them earlier with FILE_TOO_LARGE
 * (defense in depth).
 * 4. filename sanitize (C7): path separators and control chars are stripped; the stored
 * name is capped at LIMITS.FILE_NAME_MAX.
 * 5. Size gate: body over LIMITS.FILE_MAX_BYTES → FILE_TOO_LARGE.
 * 6. Quota: LIMITS.UPLOAD_STAGING_MAX staging rows per user, enforced both by the API
 * fast path and by the conditional INSERT (TOCTOU guard) in dbCreateUpload.
 * 7. Encrypted at rest: upload body/thumb are encryptField ciphertext in the table and
 * decryptField round-trips back to the original data URL.
 *
 * These are DIRECT unit tests (node:test + node:sqlite DatabaseSync + the d1Shim pattern
 * from chat-send-batch.test.js). The two pure helpers (fileDataBlocked / sanitizeFileName)
 * are module-private in api.js, so they are exercised end-to-end via handleCreateUpload and
 * asserted on the stored row — a missing blocklist entry or a weakened sanitizer turns the
 * corresponding assertion red (mutation guard).
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateUpload } from '../src/server/domains/chat/api.js';
import { dbCreateUpload, dbCountUploads } from '../src/server/domains/chat/repo.js';
import { tokenDigest, decryptField } from '../src/server/core/crypto.js';
import { LIMITS } from '../src/shared/config.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// ---- d1Shim (identical to chat-send-batch.test.js) -------------------------------------
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }; } };
      return st;
    },
    batch(stmts) {
      if (!stmts.length) throw new Error('D1 batch requires at least one statement');
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

/** Fresh in-memory DB seeded with a student + teacher; returns an authenticated teacher token. */
async function setup() {
  const raw = rawOf();
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('s1','h','s','student'),('t1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const token = 't1-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), idOf('t1'), 'x', '2099-01-01 00:00:00');
  return { db, raw, token, idOf };
}

const uploadCount = raw => raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c;

/** Call handleCreateUpload and return { status, code } (stable error code from the body). */
async function uploadCode(db, token, body) {
  const res = await handleCreateUpload(db, body, reqOf(token));
  return { status: res.status, ...(await res.json()) };
}

// ---- fixture tables ----------------------------------------------------------------
// Each entry: kind must let the data URL pass the API prefix gate so the request actually
// reaches fileDataBlocked (image/svg uses kind='image' for the data:image/ prefix; all
// others use kind='file' for the generic data: prefix). Removing any one of these entries
// from the blocklist makes the upload succeed (201) → assertion red.
const BLOCKED_TYPES = [
  { kind: 'image', data: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+' },
  { kind: 'file', data: 'data:text/html;base64,PGh0bWw+PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0PjwvaHRtbD4=' },
  { kind: 'file', data: 'data:application/xhtml+xml;base64,PGh0bWw+PC9odG1sPg==' },
  { kind: 'file', data: 'data:text/xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+PG1hbGljaW91cy8+' },
  { kind: 'file', data: 'data:application/xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIj8+PG1hbGljaW91cy8+' },
  { kind: 'file', data: 'data:application/javascript;base64,YWxlcnQoMSk=' },
  { kind: 'file', data: 'data:application/x-javascript;base64,YWxlcnQoMSk=' },
  { kind: 'file', data: 'data:text/javascript;base64,YWxlcnQoMSk=' },
  { kind: 'file', data: 'data:application/ecmascript;base64,YWxlcnQoMSk=' },
  { kind: 'file', data: 'data:text/ecmascript;base64,YWxlcnQoMSk=' },
];

// Mixed-case MIME with a lowercase data: prefix — passes the API prefix gate, so it is
// blocked ONLY by the `.toLowerCase()` inside fileDataBlocked. Dropping the lowercase
// normalization lets these through → red (locks the case-insensitive blacklist).
// `data:image/Svg+xml` uses a lowercase `data:image/` prefix (passes the image gate) with a
// mixed-case `Svg` subtype, so only the lowercased blacklist catches it.
const MIXED_CASE_TYPES = [
  { kind: 'image', data: 'data:image/Svg+xml;base64,PHN2Zz4=' },
  { kind: 'file', data: 'data:Text/Html;base64,PGh0bWw+' },
  { kind: 'file', data: 'data:Application/Javascript;base64,YWxlcnQoMSk=' },
];

// Case-variant data: prefixes that fail the case-sensitive API prefix gate
// (content.startsWith('data:') / startsWith('data:image/')) BEFORE reaching the blacklist.
// They are rejected with FILE_TOO_LARGE — the exact code differs from FILE_TYPE_BLOCKED,
// but the invariant is that a case-variant scheme never reaches the table (defense in depth).
const CASE_PREFIX_REJECTED_TYPES = [
  { kind: 'file', data: 'DATA:TEXT/HTML;base64,PGh0bWw+' },
  { kind: 'image', data: 'DATA:IMAGE/SVG+XML;base64,PHN2Zz4=' },
  { kind: 'image', data: 'data:Image/SVG+xml;base64,PHN2Zz4=' },
];

// ---- tests -------------------------------------------------------------------------
test('fileDataBlocked: every blocked active-content MIME is rejected (FILE_TYPE_BLOCKED), zero rows stored', async (t) => {
  const { db, raw, token } = await setup();
  for (const { kind, data } of BLOCKED_TYPES) {
    await t.test(`${data.split(';')[0]} (kind=${kind})`, async () => {
      const before = uploadCount(raw);
      const r = await uploadCode(db, token, { kind, fileData: data, fileName: 'payload.bin' });
      assert.equal(r.status, 400, 'rejected');
      assert.equal(r.code, 'CHAT_FILE_TYPE_BLOCKED', 'stable block code');
      assert.equal(uploadCount(raw), before, 'no row stored');
    });
  }
});

test('fileDataBlocked is case-insensitive: mixed-case MIME blocked (mutation guard on toLowerCase)', async (t) => {
  const { db, raw, token } = await setup();
  for (const { kind, data } of MIXED_CASE_TYPES) {
    await t.test(`${data.split(';')[0]} (kind=${kind})`, async () => {
      const before = uploadCount(raw);
      const r = await uploadCode(db, token, { kind, fileData: data, fileName: 'payload.bin' });
      assert.equal(r.status, 400, 'mixed-case MIME rejected');
      assert.equal(r.code, 'CHAT_FILE_TYPE_BLOCKED', 'blocked by the lowercased blacklist');
      assert.equal(uploadCount(raw), before, 'no row stored');
    });
  }
});

test('case-variant data: prefix rejected by the case-sensitive prefix gate (defense in depth), zero rows stored', async (t) => {
  const { db, raw, token } = await setup();
  for (const { kind, data } of CASE_PREFIX_REJECTED_TYPES) {
    await t.test(`${data.split(';')[0]} (kind=${kind})`, async () => {
      const before = uploadCount(raw);
      const r = await uploadCode(db, token, { kind, fileData: data, fileName: 'payload.bin' });
      assert.equal(r.status, 400, 'case-variant prefix rejected');
      assert.equal(r.code, 'CHAT_FILE_TOO_LARGE', 'caught earlier by the case-sensitive prefix gate');
      assert.equal(uploadCount(raw), before, 'no row stored');
    });
  }
});

test('sanitizeFileName: strips path separators and control chars via handleCreateUpload', async () => {
  const { db, raw, token } = await setup();
  // Path-traversal attempt: '../..' + '\' + 'bad' + control(0x01) + 'name.jpg'.
  // Special chars are built with String.fromCharCode to avoid escape/control bytes in source.
  const dirty = '../..' + String.fromCharCode(92) + 'bad' + String.fromCharCode(1) + 'name.jpg';
  const res = await handleCreateUpload(
    db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: dirty }, reqOf(token));
  assert.equal(res.status, 201);
  const id = (await res.json()).id;
  const name = raw.prepare('SELECT name FROM uploads WHERE id=?').get(id).name;
  // Every '/', '\' and control char is replaced by '_':
  assert.equal(name, '.._.._bad_name.jpg');
  // Belt-and-suspenders: the stored name holds no path separators or control chars.
  const forbidden = ch => ch.charCodeAt(0) < 32 || ch === '/' || ch === String.fromCharCode(92);
  assert.equal(name.split('').some(forbidden), false, 'no path separators or control chars survive');
});

test('sanitizeFileName: stored name is capped at LIMITS.FILE_NAME_MAX', async () => {
  const { db, raw, token } = await setup();
  const long = 'x'.repeat(LIMITS.FILE_NAME_MAX + 50) + '.pdf';
  const res = await handleCreateUpload(
    db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: long }, reqOf(token));
  assert.equal(res.status, 201);
  const id = (await res.json()).id;
  const name = raw.prepare('SELECT name FROM uploads WHERE id=?').get(id).name;
  assert.equal(name.length, LIMITS.FILE_NAME_MAX, 'name truncated to the limit');
});

test('handleCreateUpload: body over LIMITS.FILE_MAX_BYTES → FILE_TOO_LARGE, zero rows', async () => {
  const { db, raw, token } = await setup();
  const big = 'data:application/octet-stream;base64,' + 'A'.repeat(LIMITS.FILE_MAX_BYTES);
  const before = uploadCount(raw);
  const r = await uploadCode(db, token, { kind: 'file', fileData: big, fileName: 'big.bin' });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'CHAT_FILE_TOO_LARGE');
  assert.equal(uploadCount(raw), before, 'oversize body not stored');
});

test('handleCreateUpload: oversized thumb → FILE_TOO_LARGE', async () => {
  const { db, raw, token } = await setup();
  const bigThumb = 'data:image/png;base64,' + 'T'.repeat(LIMITS.THUMB_MAX_BYTES);
  const r = await uploadCode(db, token, { kind: 'image', fileData: 'data:image/png;base64,AAAA', fileName: 'a.png', thumb: bigThumb });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'CHAT_FILE_TOO_LARGE');
  assert.equal(uploadCount(raw), 0, 'no row stored');
});

test('handleCreateUpload: enforces UPLOAD_STAGING_MAX staging quota (API fast path)', async () => {
  const { db, raw, token } = await setup();
  for (let i = 0; i < LIMITS.UPLOAD_STAGING_MAX; i++) {
    const res = await handleCreateUpload(
      db, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: `f${i}.pdf` }, reqOf(token));
    assert.equal(res.status, 201, `upload ${i} should succeed`);
  }
  assert.equal(uploadCount(raw), LIMITS.UPLOAD_STAGING_MAX, 'quota filled exactly');
  const r = await uploadCode(db, token, { kind: 'file', fileData: 'data:application/pdf;base64,XXXX', fileName: 'overflow.pdf' });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'CHAT_UPLOAD_STAGING_LIMIT');
  assert.equal(uploadCount(raw), LIMITS.UPLOAD_STAGING_MAX, 'no row inserted over quota');
});

test('dbCreateUpload: conditional INSERT enforces quota atomically (TOCTOU guard)', async () => {
  const { db, raw, idOf } = await setup();
  const userId = idOf('t1');
  for (let i = 0; i < LIMITS.UPLOAD_STAGING_MAX; i++) {
    const id = await dbCreateUpload(db, userId, 'file', 'encrypted-body', `f${i}.pdf`);
    assert.ok(id > 0, `insert ${i} should succeed`);
  }
  const overflowId = await dbCreateUpload(db, userId, 'file', 'encrypted-body', 'overflow.pdf');
  assert.equal(overflowId, 0, '13th insert returns 0 (conditional INSERT rejected the row)');
  assert.equal(await dbCountUploads(db, userId), LIMITS.UPLOAD_STAGING_MAX, 'row count unchanged');
  assert.equal(raw.prepare('SELECT COUNT(*) AS c FROM uploads').get().c, LIMITS.UPLOAD_STAGING_MAX);
});

test('upload body + thumb encrypted at rest; decryptField round-trips to the original data URL', async () => {
  const { db, raw, token } = await setup();
  const plaintext = 'data:image/png;base64,' + 'P'.repeat(4000);
  const thumb = 'data:image/png;base64,' + 'T'.repeat(500);
  const res = await handleCreateUpload(
    db, { kind: 'image', fileData: plaintext, fileName: 'photo.png', thumb }, reqOf(token));
  assert.equal(res.status, 201);
  const id = (await res.json()).id;
  const row = raw.prepare('SELECT body, thumb FROM uploads WHERE id=?').get(id);
  assert.ok(row && row.body, 'body column populated');
  assert.notEqual(row.body, plaintext, 'body is not stored as plaintext');
  assert.equal(await decryptField(row.body), plaintext, 'body decrypts back to the original data URL');
  assert.notEqual(row.thumb, thumb, 'thumb is not stored as plaintext');
  assert.equal(await decryptField(row.thumb), thumb, 'thumb decrypts back to the original data URL');
});
