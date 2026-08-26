/**
 * ZD-3（2026-08-26 休眠签约）：需求联系方式门控放宽守护测试。
 * 用户原话：「解除所有禁止在会话中发布联系方式的提醒，让用户自由沟通」。
 * 语义 = 需求 parent_contact/student_contact 从「签约后展示」放宽到「建立会话后展示」——
 * 教师与该需求学生已建立会话（dbIsMatched）→ 广场列表该需求附联系方式；
 * 未匹配教师 / 匿名列表仍剥离（陌生人防批量爬边界）。
 *
 * G2 变异守护：还原 dbGetDemands 教师分支的 matched 判定（改回 `rows.map(mapDemandRow)`）
 * → 本文件「已匹配教师可见联系方式」断言必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TEST_SECRETS } from './_test-secrets.js';
import { initDb } from '../src/server/core/db.js';
import { dbGetDemands } from '../src/server/domains/demand/repo.js';
import { encryptField } from '../src/server/core/crypto.js';

const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

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

async function seed() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES
    ('studentA','h','s','student'),('studentB','h','s','student'),('teacher1','h','s','teacher')`);
  const idOf = name => raw.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  const sa = idOf('studentA'), sb = idOf('studentB'), t = idOf('teacher1');
  // 两条需求（各自加密联系方式）；studentA 与 teacher1 建立会话，studentB 未建立
  const insDemand = async (uid, title) => {
    const pc = await encryptField(`${title}_parent_phone`);
    const sc = await encryptField(`${title}_student_phone`);
    raw.prepare(`INSERT INTO student_demands (user_id, student_grade, student_gender, target_subjects, current_scores, submitter_type, parent_contact, student_contact, status, additional_info)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(uid, 'senior1', 'female', '["math"]', '[]', 'self', pc, sc, 'open', title);
  };
  await insDemand(sa, 'A');
  await insDemand(sb, 'B');
  raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id, demand_id) VALUES (?,?,?)').run(sa, t, null);
  return { db, sa, sb, t };
}

test('ZD-3 已匹配教师（与需求学生建立会话）→ 需求附联系方式', async () => {
  const { db, t } = await seed();
  const demands = await dbGetDemands(db, { teacherUserId: t });
  const a = demands.find(d => d.additional_info === 'A');
  assert.ok(a, '需求 A 应在列表');
  assert.equal(a.parent_contact, 'A_parent_phone', `已匹配需求应附 parent_contact（实测 ${a.parent_contact}）`);
  assert.equal(a.student_contact, 'A_student_phone');
});

test('ZD-3 未匹配教师 → 全部需求联系方式剥离（零泄露）', async () => {
  const { db, t } = await seed();
  const demands = await dbGetDemands(db, { teacherUserId: t });
  const b = demands.find(d => d.additional_info === 'B');
  assert.ok(b, '需求 B 应在列表');
  assert.equal(b.parent_contact, undefined, `未匹配需求应无 parent_contact（实测 ${b.parent_contact}）`);
  assert.equal(b.student_contact, undefined);
});

test('ZD-3 匿名列表（无 teacherUserId）→ 全部剥离', async () => {
  const { db } = await seed();
  const demands = await dbGetDemands(db, {});
  for (const d of demands) {
    assert.equal(d.parent_contact, undefined, `匿名列表应零联系方式（需求 ${d.additional_info}）`);
    assert.equal(d.student_contact, undefined);
  }
});
