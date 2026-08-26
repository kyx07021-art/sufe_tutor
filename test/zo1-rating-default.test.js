/**
 * ZO-1（2026-08-26）：默认评分机制修复——生产 teacher_profiles 表 `rating REAL DEFAULT 4` 烤死
 * （旧 INITIAL_RATING=4.0 建表），INSERT 不写 rating → 新教师恒 4.0（生产实证 8/18）。修复 =
 * INSERT 显式写 rating=INITIAL_RATING + 回填条件改 `rating IS NULL OR rating <> 4.5` + SCHEMA_VERSION bump。
 * 三层守护：①生产形状表（DEFAULT 4）INSERT → 4.5（G3 夹具与生产一致）②源级契约：INSERT 含 rating 列
 * （变异删列 → 红）③回填 NULL/4.0 → 4.5（变异还原 `< 4.5` 条件 → NULL 行不升 → 红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_SECRETS } from './_test-secrets.js';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbUpsertTeacherProfile } from '../src/server/domains/teacher/repo.js';
import { INITIAL_RATING } from '../src/shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

// 生产 teacher_profiles 实际 DDL（2026-08-26 生产 D1 sqlite_master 实证：rating REAL DEFAULT 4）
const PROD_TP_DDL = `CREATE TABLE "teacher_profiles" (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
  grade TEXT, gender TEXT, subjects TEXT, gaokao_scores TEXT,
  price REAL DEFAULT 0, wechat TEXT, email TEXT,
  rating REAL DEFAULT 4,
  rating_count INTEGER DEFAULT 0, rating_sum REAL DEFAULT 0,
  updated_at DATETIME DEFAULT (datetime('now','localtime')), province TEXT DEFAULT '', intro TEXT DEFAULT '', address TEXT DEFAULT '', school TEXT DEFAULT '', real_name TEXT DEFAULT '', credential_image TEXT DEFAULT '', verified INTEGER NOT NULL DEFAULT 0, price_min REAL, price_max REAL, time_slots TEXT DEFAULT '', teaching_method TEXT DEFAULT '', personality_tags TEXT DEFAULT '', nonacademic_projects TEXT DEFAULT '', nonacademic_prices TEXT DEFAULT '', graduation_year INTEGER, chsi_school TEXT DEFAULT '', chsi_level TEXT DEFAULT '', chsi_major TEXT DEFAULT '', chsi_status TEXT DEFAULT '', chsi_enroll_year TEXT DEFAULT '', chsi_verified INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`;

function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) { const info = raw.prepare(st._sql).run(...(p.length ? p : st._params)); return { meta: { changes: Number(info.changes) } }; } };
      return st;
    },
    batch(stmts) {
      raw.exec('BEGIN');
      try { const out = []; for (const s of stmts) {
        if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
        else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes) } }); }
      } raw.exec('COMMIT'); return out; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };

const PROFILE = {
  province: 'shanghai', grade: '', gender: '', subjects: [], gaokao_scores: [],
  price: 100, wechat: '', email: '', intro: '', address: '', school: '', real_name: '',
  credential_image: '',
};

test('ZO-1 生产形状表（rating DEFAULT 4）INSERT → rating=4.5（不依赖烤死默认）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV); // 完整 schema
  raw.exec('DROP TABLE teacher_profiles'); // 用生产 DDL 重建（DEFAULT 4 烤死）
  raw.exec(PROD_TP_DDL);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('t','h','s','teacher')`);
  const uid = raw.prepare("SELECT id FROM users WHERE username='t'").get().id;
  await dbUpsertTeacherProfile(db, uid, PROFILE);
  const row = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(uid);
  assert.equal(row.rating, INITIAL_RATING, '生产形状表下新档案 rating 必须显式 4.5（非烤死 DEFAULT 4）');
});

test('ZO-1 源级契约：repo.js INSERT INTO teacher_profiles 含 rating 列（变异删列即红）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server', 'domains', 'teacher', 'repo.js'), 'utf-8');
  const insert = src.match(/INSERT INTO teacher_profiles[\s\S]*?gradYear, INITIAL_RATING\]\)?;/);
  assert.ok(insert, '找到新档案 INSERT（含 rating 列 + INITIAL_RATING 值）');
  assert.ok(insert[0].includes('rating)'), 'INSERT 列清单必须含 rating（新档案显式写默认评分）');
  assert.ok(insert[0].includes('INITIAL_RATING'), 'INSERT VALUES 应含 INITIAL_RATING 引用');
});

test('ZO-1 回填：rating_count=0 且 rating NULL/4.0 → initDb 升 4.5（版本落后重跑）', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('a','h','s','teacher'),('b','h','s','teacher')`);
  const ua = raw.prepare("SELECT id FROM users WHERE username='a'").get().id;
  const ub = raw.prepare("SELECT id FROM users WHERE username='b'").get().id;
  await dbUpsertTeacherProfile(db, ua, PROFILE);
  await dbUpsertTeacherProfile(db, ub, PROFILE);
  raw.prepare('UPDATE teacher_profiles SET rating=4.0 WHERE user_id=?').run(ua);   // 存量 4.0（旧默认）
  raw.prepare('UPDATE teacher_profiles SET rating=NULL WHERE user_id=?').run(ub);  // NULL 值兜底
  raw.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run(); // 版本落后触发迁移
  await initDb(db, ENV);
  const ra = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(ua);
  const rb = raw.prepare('SELECT rating FROM teacher_profiles WHERE user_id=?').get(ub);
  assert.equal(ra.rating, 4.5, '存量 4.0 回填 4.5');
  assert.equal(rb.rating, 4.5, 'rating NULL 回填 4.5（新条件 <> 覆盖 NULL）');
});
