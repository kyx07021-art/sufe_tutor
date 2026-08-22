/**
 * B3 主科分数上限按年级适配（S3 单科目新模型：current_score 单值文本钳制）。
 */
import { TEST_SECRETS } from './_test-secrets.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { handleCreateDemand } from '../src/server/domains/demand/api.js';
import { tokenDigest } from '../src/server/core/crypto.js';
import { SUFE_REGIONS } from '../src/client/constants/region-data.js';
import { buildStudentScoreRows } from '../src/client/features/region/render.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

test('B3 subjectMaxFor 省+年级单源', () => {
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'chinese', 'p1'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'math', 'p6'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'chinese', 'senior1'), 150);
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'physics', 'senior1'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('shanghai', 'math', 'prep'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('shanghai', 'math', 'junior1'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('shanghai', 'math', 'junior2'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('shanghai', 'math', 'junior3'), 150);
  assert.equal(SUFE_REGIONS.subjectMaxFor('shanghai', 'history', 'junior3'), 30);
  assert.equal(SUFE_REGIONS.subjectMaxFor('henan', 'chinese', 'junior1'), 120);
  assert.equal(SUFE_REGIONS.subjectMaxFor('yunnan', 'math', 'junior3'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('xinjiang', 'math', 'junior1'), 150);
  assert.equal(SUFE_REGIONS.subjectMaxFor('hunan', 'english', 'junior1'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('qinghai', 'math', 'junior2'), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('qinghai', 'math', 'junior3'), 120);
  assert.equal(SUFE_REGIONS.subjectMaxFor('henan', 'history', 'junior3'), 50);
  assert.equal(SUFE_REGIONS.subjectMaxFor('henan', 'politics', 'junior3'), 70);
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'chinese', ''), 100);
  assert.equal(SUFE_REGIONS.subjectMaxFor('jiangsu', 'chinese', null), 100);
});

test('B3 buildStudentScoreRows 渲染：小学 /100、高中 /150', () => {
  const primary = buildStudentScoreRows('jiangsu', 'p1', ['chinese', 'math']);
  assert.ok(primary.includes('max="100"'));
  assert.ok(!primary.includes('/ 150'));
  const senior = buildStudentScoreRows('jiangsu', 'senior1', ['chinese', 'math']);
  assert.ok(senior.includes('/ 150'));
});

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

async function seedStudent(db, raw, username = 'stu1') {
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('${username}','h','s','student')`);
  const uid = raw.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  const token = `${username}-token`;
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(await tokenDigest(token), uid, '2099-01-01 00:00:00');
  return { token, uid };
}

// S3 单科目直接 body：jiangsu 非线下许可省 → 强制 online，无需地址
const baseDemand = { province: 'jiangsu', subject: 'chinese', grade: 'p1', teachingMethod: 'online', budgetMin: 0, budgetMax: 0 };

test('B3 服务端钳制：小学一年级语文 150 → 100', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw);
  const res = await handleCreateDemand(db, { ...baseDemand, grade: 'p1', currentScore: '150' }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200);
  const row = raw.prepare('SELECT current_score FROM student_demands ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.current_score, '100', 'subjectMaxFor(jiangsu,chinese,p1)=100 钳制');
});

test('B3 服务端钳制：高中 150 保持', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw, 'stu2');
  const res = await handleCreateDemand(db, { ...baseDemand, grade: 'senior3', currentScore: '150' }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200);
  const row = raw.prepare('SELECT current_score FROM student_demands ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.current_score, '150', '高中主科 150 保持');
});

test('B3 服务端钳制：等第字母不改数值', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw, 'stu3');
  const res = await handleCreateDemand(db, { ...baseDemand, grade: 'p1', currentScore: 'A' }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200);
  const row = raw.prepare('SELECT current_score FROM student_demands ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.current_score, 'A', '等第字母原样保留');
});
