/**
 * B3（v0.27.2 用户反馈「小学一年级语文满分 150 荒谬」）—— 主科分数上限按年级适配
 *
 * 政策调研（各省市）：高考语数外 150 全国统一；中考各省 100-150 不等（北京 100/上海数学 150/成都英语 150 等）；
 * 小学语数英 100 分制全国统一。定策：主科满分 小学=100、初中=150（取各省中考高值防拒合法高分）、高中=150（高考）。
 *
 * 覆盖：
 *   - region-data subjectMaxForStage 单源：小学主科 100 / 初中·高中主科 150 / 非主科恒 100 / 无年级回 150
 *   - buildStudentScoreRows 渲染：小学语文 max=100「/ 100」、高中语文 max=150「/ 150」
 *   - 服务端 sanitizeDemand 兜底：小学 current_scores 语文 150 → 钳到 100 落库；高中 150 → 保持
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { initDb } from '../server/db.js';
import { handleCreateDemand } from '../server/routes-demands.js';
import { tokenDigest } from '../server/crypto.js';

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

function frontCtx(files) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document, getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of files) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return ctx;
}

test('B3 subjectMaxForStage 单源：小学主科 100 / 初中·高中 150 / 非主科恒 100 / 无年级 150', () => {
  const ctx = frontCtx(['constants.js', 'region-data.js', 'app-display.js', 'app-state.js']);
  const R = vm.runInContext('globalThis.SUFE_REGIONS', ctx);
  assert.equal(R.subjectMaxForStage('chinese', 'p1'), 100, '小学一年级语文 100（核心修复）');
  assert.equal(R.subjectMaxForStage('math', 'p6'), 100, '小学六年级数学 100');
  assert.equal(R.subjectMaxForStage('english', 'junior1'), 150, '初一英语 150（中考各省高值兜底）');
  assert.equal(R.subjectMaxForStage('chinese', 'prep'), 150, '预备班（初中阶段）语文 150');
  assert.equal(R.subjectMaxForStage('chinese', 'senior1'), 150, '高一语文 150（高考口径）');
  assert.equal(R.subjectMaxForStage('physics', 'p1'), 100, '非主科恒 100');
  assert.equal(R.subjectMaxForStage('chinese', ''), 150, '无年级回 150（默认高考口径）');
});

test('B3 buildStudentScoreRows 渲染：小学语文 /100、高中语文 /150（输入 max 随学段）', () => {
  const ctx = frontCtx(['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js', 'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-region.js']);
  const ctx2 = ctx;
  // 小学 p1：主科满分 100
  const htmlPrimary = vm.runInContext(`buildStudentScoreRows('jiangsu', 'p1', ['chinese', 'math'])`, ctx2);
  assert.ok(htmlPrimary.includes('max="100"'), '小学语文输入 max=100');
  assert.equal((htmlPrimary.match(/\/ 100/g) || []).length >= 2, true, '小学语数均显示 / 100');
  assert.ok(!htmlPrimary.includes('/ 150'), '小学不出现 / 150');
  // 高中 senior1：主科满分 150
  const htmlSenior = vm.runInContext(`buildStudentScoreRows('jiangsu', 'senior1', ['chinese', 'math'])`, ctx2);
  assert.equal((htmlSenior.match(/\/ 150/g) || []).length >= 2, true, '高中语数均显示 / 150');
});

// ---------------- 服务端钳制 ----------------
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

const baseDemand = { province: 'jiangsu', student_gender: 'male',
  target_subjects: ['chinese', 'math'], teaching_method: 'online',
  address: '杨浦区', budget_min: 0, budget_max: 0,
  submitter_type: 'parent', parent_contact: '13800138000', student_contact: '13900139000', additional_info: '' };

test('B3 服务端钳制：小学一年级语文 current_scores 150 → 钳到 100 落库', async (t) => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw);
  const res = await handleCreateDemand(db, { demand: {
    ...baseDemand, student_grade: 'p1',
    current_scores: [{ subject: 'chinese', mode: 'score', scale: 150, score: '150' }],
  } }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200, '需求创建成功');
  const row = raw.prepare('SELECT current_scores FROM student_demands ORDER BY id DESC LIMIT 1').get();
  const scores = JSON.parse(row.current_scores);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].subject, 'chinese');
  assert.equal(scores[0].score, '100', '小学主科分数钳到 100');
  assert.equal(scores[0].scale, 100, '满分随学段更新为 100');
});

test('B3 服务端钳制：高中高三语文 150 保持（不误钳）', async (t) => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw, 'stu2');
  const res = await handleCreateDemand(db, { demand: {
    ...baseDemand, student_grade: 'senior3',
    current_scores: [{ subject: 'chinese', mode: 'score', scale: 150, score: '150' }],
  } }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200);
  const row = raw.prepare('SELECT current_scores FROM student_demands ORDER BY id DESC LIMIT 1').get();
  const scores = JSON.parse(row.current_scores);
  assert.equal(scores[0].score, '150', '高中主科 150 保持');
  assert.equal(scores[0].scale, 150);
});

test('B3 服务端钳制：等第模式不改数值（grade 项跳过钳制）', async (t) => {
  const raw = rawOf(); const db = d1Shim(raw);
  const { token } = await seedStudent(db, raw, 'stu3');
  const res = await handleCreateDemand(db, { demand: {
    ...baseDemand, student_grade: 'p1', target_subjects: ['chinese'],
    current_scores: [{ subject: 'chinese', mode: 'grade', scale: 0, score: '', grade: 'A' }],
  } }, { headers: new Headers({ 'X-Auth-Token': token }) });
  assert.equal(res.status, 200);
  const row = raw.prepare('SELECT current_scores FROM student_demands ORDER BY id DESC LIMIT 1').get();
  const scores = JSON.parse(row.current_scores);
  assert.equal(scores[0].grade, 'A', '等第保留');
  assert.equal(scores[0].score, '', '等第无数值不改');
});
