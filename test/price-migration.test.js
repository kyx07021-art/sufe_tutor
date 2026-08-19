/**
 * 报价区间化迁移回填回归（v0.25.2 审计修复）
 *
 * 背景：teacher_profiles.price 单报价列 → price_min/price_max 区间。存量行需回填
 * `price_min=price, price_max=price WHERE price_min IS NULL AND price IS NOT NULL`。
 * 审计发现两个必须钉死的路径：
 *   A. 存量单报价行（price=150、price_min NULL）部署跑 initDb 后回填成 150/150，且幂等（再跑不变）；
 *   B. 新写入路径必须显式写 `price=priceMin`（而非吃 DEFAULT 0）——否则「未报价」新行 price=0，
 *      下次部署回填命中 `price IS NOT NULL` 会把未报价静默误判为「报价 0」（0 是合法报价，完整性门槛被绕过）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { dbUpsertTeacherProfile } from '../src/server/domains/teacher/repo.js';

// node:sqlite → D1 形状薄封装（同 initdb-migration.test.js）
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = { _sql: sql, _params: [], bind(...p) { st._params = p; return st; } };
      st.all = (...p) => ({ results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) });
      st.first = (...p) => raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined;
      st.run = (...p) => {
        const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
        return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      };
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
const ENV = { ...TEST_SECRETS, ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
const rawOf = () => { const r = new DatabaseSync(':memory:'); r.exec('PRAGMA foreign_keys = ON'); return r; };

test('回填 A：存量单报价行 → price_min/max=price，且幂等', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t1','h','s','teacher')").run();
  // 模拟改动前的老库行：只有 price 有值，price_min/max 列存在但为 NULL
  raw.prepare(`INSERT INTO teacher_profiles (user_id,grade,gender,subjects,gaokao_scores,price)
    VALUES (1,'junior','male','[]','[]',150)`).run();
  // 部署跑 initDb → 回填触发（v0.26.12：schema 版本化——版本落后才跑迁移，模拟旧库升级）
  raw.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  await initDb(db, ENV);
  let row = raw.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=1').get();
  assert.equal(row.price_min, 150, '存量单报价回填 price_min');
  assert.equal(row.price_max, 150, '存量单报价回填 price_max');
  // 幂等：再跑一次不变
  await initDb(db, ENV);
  row = raw.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=1').get();
  assert.equal(row.price_min, 150, '回填幂等（二次 initDb 不破坏已回填值）');
});

test('回填 B：新写入路径未报价 → price/price_min 均 NULL，回填不误抓为 0', async () => {
  const raw = rawOf(); const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.prepare("INSERT INTO users (username,password_hash,salt,role) VALUES ('t2','h','s','teacher')").run();
  // 新 upsert：未填报价（无 price_min）→ 显式写 price=priceMin=null（不得吃 DEFAULT 0）
  await dbUpsertTeacherProfile(db, 1, {
    province: 'shanghai', grade: '', gender: '', subjects: [], gaokao_scores: [],
    wechat: '', email: '', intro: '', address: '', school: '', real_name: '', credential_image: '',
  });
  let row = raw.prepare('SELECT price, price_min, price_max FROM teacher_profiles WHERE user_id=1').get();
  assert.equal(row.price, null, '新行未报价 price 应为 NULL（防回填误抓）');
  assert.equal(row.price_min, null, '新行未报价 price_min 应为 NULL');
  // 再跑 initDb（v0.26.12 版本落后触发迁移）：回填 `WHERE price_min IS NULL AND price IS NOT NULL` 不命中 → 未被误判为 0
  raw.prepare(`INSERT OR REPLACE INTO schema_meta (k, v) VALUES ('schema', 0)`).run();
  await initDb(db, ENV);
  row = raw.prepare('SELECT price_min, price_max FROM teacher_profiles WHERE user_id=1').get();
  assert.equal(row.price_min, null, '未报价教师不被误回填为 0');
});
