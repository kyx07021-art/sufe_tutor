/**
 * Database initialization and migration orchestration (architecture v2, orchestration-only since V-1-4b).
 *
 * This file carries no business DDL / ensureColumns / domain migration SQL — all of it lives in
 * src/server/domains/<domain>/schema.js and is invoked here in ordered stages.
 *
 * Assembly contract (F1 — a domain schema that is imported but never staged is a hidden breakage):
 * every domain under src/server/domains/ must be registered in SCHEMAS below AND appear in
 * CREATE_ORDER / ENSURE_ORDER / POST_ENSURE_ORDER. New-site S1-S6 domains map to:
 *   S1 auth      -> authSchema      (users / auth_sessions / rate_limits / invite_codes)
 *   S2 chat      -> chatSchema      (conversations / messages / uploads + temp conversation columns)
 *   S3 demand    -> demandSchema    (single-subject student_demands)
 *   S4 teacher   -> teacherSchema   (teacher_profiles / teacher_verifications + experience_years / teacher_name)
 *   S5 contract  -> contractSchema  (standalone contracts table, replaces signing_contracts)
 *   S6 support   -> reviews / posts / complaints / settings / admin schema modules (awards = offline stub,
 *                  kept registered so archtest "backend domain self-ownership" stays satisfied)
 */
import { ensureColumns } from './util.js';
import { bindCryptoEnv } from './crypto.js';
import { getSecret } from '../../../server/secrets.js';
import { initMetrics } from '../../../server/telemetry.js';
import { initLogDb } from './log.js';
import { initNotifyTable } from './notify.js';
import { initVersionTable } from '../../../server/version.js';
import { initDangerCaps } from './danger-ops.js';
import { initOtpTable, bindOtpEnv } from './otp.js';
import { bindChsiEnv } from '../../../server/chsi.js';

import * as authSchema from '../domains/auth/schema.js';
import * as teacherSchema from '../domains/teacher/schema.js';
import * as demandSchema from '../domains/demand/schema.js';
import * as chatSchema from '../domains/chat/schema.js';
import * as contractSchema from '../domains/contract/schema.js';
import * as reviewsSchema from '../domains/reviews/schema.js';
import * as postsSchema from '../domains/posts/schema.js';
import * as complaintsSchema from '../domains/complaints/schema.js';
import * as settingsSchema from '../domains/settings/schema.js';
import * as awardsSchema from '../domains/awards/schema.js';
import * as adminSchema from '../domains/admin/schema.js';

const SCHEMAS = {
  auth: authSchema,
  teacher: teacherSchema,
  demand: demandSchema,
  chat: chatSchema,
  contract: contractSchema,
  reviews: reviewsSchema,
  posts: postsSchema,
  complaints: complaintsSchema,
  settings: settingsSchema,
  awards: awardsSchema,
  admin: adminSchema,
};

// create / preCreate ordering must satisfy FK "parent before child": auth(users) -> teacher -> demand -> chat -> contract -> rest
const CREATE_ORDER = ['auth', 'teacher', 'demand', 'chat', 'contract', 'reviews', 'posts', 'complaints', 'settings', 'awards', 'admin'];
// ensureColumns order mirrors the legacy initDb full-migration order (cross-domain columns land before domain migrations)
const ENSURE_ORDER = ['auth', 'complaints', 'chat', 'teacher', 'demand', 'contract', 'reviews', 'posts', 'settings', 'awards', 'admin'];
// postEnsure: cross-domain data backfill first (chat depends on demand columns), auth last (old-admin purge / username sanitize)
const POST_ENSURE_ORDER = ['chat', 'demand', 'teacher', 'contract', 'complaints', 'reviews', 'posts', 'settings', 'awards', 'admin', 'auth'];

// Admin roster is read through the secrets gateway (read-only env: Worker Secrets / .dev.vars / test injection; fail-closed, zero plaintext in repo)
const adminNamesOf = v => Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// ============================================================
// initDb uses the schema version gate: a cold isolate's first hit sends one batch
// (CREATE schema_meta idempotent + SELECT version); if already current it skips the
// full migration (~13-20 D1 round-trips would blow the cold-start budget).
// Discipline: any create/add-column/migration change MUST bump SCHEMA_VERSION +1, otherwise
// the version gate skips the migration and the column is never added (production incidents).
// ============================================================
export const SCHEMA_VERSION = 17; // S5: contracts standalone table replaces signing_contracts (14 = S3-2 demand single-subject model; 15 = S5 standalone; 16 = S4-01 teacher_name/experience_years columns; 17 = S2-T1 temp conversation columns temp_status/temp_initiator_user_id + intents/pushes backfill removal)

export async function initDb(db, env = {}) {
  bindCryptoEnv(env); // field encryption keys (FIELD_ENC_KEY falls back to LOG_ENCRYPT_KEY); re-derived on env change
  bindOtpEnv(env);    // OTP deployment config (SMS/EMAIL_OTP_TEMPLATE_CODE template codes; tests stub fetch via test/_otp-stub.js)
  bindChsiEnv(env);   // CHSI deployment config (v1.5.0+: manual only, other providers fail-closed)
  // One batch: create schema_meta (idempotent) + read version (batch executes in order, CREATE visible to the SELECT)
  let rows = null;
  try {
    rows = await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)`),
      db.prepare(`SELECT v FROM schema_meta WHERE k='schema'`),
    ]);
  } catch { /* batch failure: conservatively treat as version-behind and run the idempotent full migration (do not block init) */ }
  const cur = rows && rows[1] && rows[1].results && rows[1].results[0] ? rows[1].results[0].v : 0;
  if (cur >= SCHEMA_VERSION) return; // schema current: cold-isolate first hit skips the full migration (one D1 round-trip)
  await runFullMigration(db, env); // first deploy / version behind: run the full idempotent migration
  try { await db.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', ?)`).bind(SCHEMA_VERSION).run(); } catch { /* version write failure is silent: next run re-runs the idempotent migration */ }
}

// Full-migration orchestration (idempotent): domains own their SQL; this function only owns stage order.
async function runFullMigration(db, env) {
  bindCryptoEnv(env); // field encryption keys; re-derived on env change
  const adminNames = adminNamesOf(getSecret(env, 'ADMIN_USERNAMES'));
  const adminPassword = getSecret(env, 'ADMIN_DEFAULT_PASSWORD') || '';
  const ctx = { env, adminNames, adminPassword };
  const phase = p => ({ ...ctx, phase: p });

  // Stage 1: preCreate — legacy migrations that must run before the initial CREATE (users role expansion /
  // legacy table rebuild). If the initial batch created child tables first, renaming users would rewrite their
  // FKs to point at _users_old and orphan them.
  for (const name of CREATE_ORDER) await SCHEMAS[name].migrate(db, phase('preCreate'));

  // Stage 2: create — idempotent CREATE for every domain (domain order = parent before child)
  const createBatch = [];
  for (const name of CREATE_ORDER) {
    for (const sql of SCHEMAS[name].createStatements) createBatch.push(db.prepare(sql));
  }
  if (createBatch.length) await db.batch(createBatch);

  // Stage 3: postCreate — post-create shape migrations (CHECK rebuild / old-shape swap / seed admins / domain table init)
  for (const name of CREATE_ORDER) await SCHEMAS[name].migrate(db, phase('postCreate'));

  // Logging & metrics tables (core modules own these; the separate log-DB binding is routed via getLogDb)
  await initLogDb(db);
  await initMetrics(db); // v1.5.0 observability metric tables (request aggregation)

  // Stage 4: ensureColumns — declarative column additions; executed centrally by the single-point util.ensureColumns
  for (const name of ENSURE_ORDER) {
    for (const spec of SCHEMAS[name].ensureColumns) {
      await ensureColumns(db, spec.table, spec.columns);
    }
  }

  // Stage 5: non-domain tables (notifications / version / danger-caps / OTP) — must precede postEnsure,
  // the auth "old-admin purge" reads notifications etc. which need to exist by then.
  await initNotifyTable(db);
  await initVersionTable(db);
  await initDangerCaps(db);
  await initOtpTable(db);

  // Stage 6: postEnsure — post-column data backfill / hot & unique indexes / final cleanup
  for (const name of POST_ENSURE_ORDER) await SCHEMAS[name].migrate(db, phase('postEnsure'));
}
