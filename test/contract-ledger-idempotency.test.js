/**
 * Z-5-F3 回归：合同台账跨秒幂等（幂等键 = contract_id + body_hash，与 createdAt 解耦）。
 *
 * 原缺陷：content_hash 含 toDbTime()（UTC 秒级）→ 签约 500 后跨秒重试（或并发抢签败者重试）
 * 同正文算出不同 content_hash → NOT EXISTS(content_hash) 判定不命中 → 同正文重复挂链。
 * 修复：去重判据改 body_hash（正文 sha256），createdAt 仍参与 content_hash 防篡改（F-07）。
 *
 * 场景：同合同同正文两次 ledgerRecord（间隔 ≥1.1s 确保跨秒）→ 只挂 1 条 + 第二次返回既有 hash；
 * 不同正文 → 2 条且 seq/prev 链完整（幂等不误伤正文变化）。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { initLedgerTable } from '../src/server/domains/contract/schema.js';
import { ledgerRecord, verifyChain } from '../src/server/domains/contract/api.js';
import { dbGet, dbAll } from '../src/server/core/util.js';

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
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else { const info = raw.prepare(s._sql).run(...s._params); out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }); }
        }
        raw.exec('COMMIT'); return out;
      } catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
}

const sha256Hex = async text => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  await initLedgerTable(db); // worker 启动链 initDb → initLedgerTable（env.LEDGER_DB || env.DB）
  return { raw, db };
}

test('Z-5-F3: 同合同同正文跨秒两次记账 → 只挂 1 条 + 第二次返回既有 hash', async () => {
  const { raw, db } = await setup();
  const h1 = await ledgerRecord(db, 1, '合同正文X');
  await new Promise(r => setTimeout(r, 1100)); // toDbTime 秒级，保证跨秒（修复前 createdAt 变化 → 新 hash → 重复挂链）
  const h2 = await ledgerRecord(db, 1, '合同正文X');
  assert.equal(h1, h2, '第二次返回既有 content_hash（幂等命中）');
  const rows = raw.prepare('SELECT id, content_hash, body_hash, seq FROM contract_ledger WHERE contract_id=1 ORDER BY id').all();
  assert.equal(rows.length, 1, '同正文跨秒只挂 1 条（修复前恒 2 条）');
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[0].body_hash.length, 64, 'body_hash 为 sha256 hex');
});

test('Z-5-F3: 不同正文 → 独立记账 + 链完整（幂等不误伤正文变化）', async () => {
  const { raw, db } = await setup();
  await ledgerRecord(db, 2, '正文A');
  await new Promise(r => setTimeout(r, 1100));
  const h2 = await ledgerRecord(db, 2, '正文B');
  assert.ok(h2, '不同正文应记账');
  const rows = await dbAll(db, 'SELECT id, prev_hash, seq FROM contract_ledger WHERE contract_id=2 ORDER BY id');
  assert.equal(rows.length, 2, '不同正文两条台账');
  assert.equal(rows[1].prev_hash, (await dbGet(db, 'SELECT content_hash h FROM contract_ledger WHERE contract_id=2 AND seq=1')).h, 'prev 链衔接');
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[1].seq, 2);
  // verifyChain 结构完好（链头 GENESIS + prev 连续 + seq 单调）
  const ledger = await dbAll(db, 'SELECT content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=2 ORDER BY id');
  const v = await verifyChain(ledger, { contractId: 2, contractMd: '正文B' });
  assert.equal(v.ok, true, '链结构 intact');
});

// AI-4a：台账 contract_id 旧 contracts.id → signing_contracts.id remap + content_hash 按新 id 重算 +
// prev_hash 重链（BUG-1 修复：verifyChain 逐条比较 prev_hash === 上一条 content_hash；只改 content_hash
// 不改 prev_hash，则多条目链 linksValid=false → verify invalid）。幂等：remap+重算 batch 原子，重跑零变更。
test('AI-4a：台账 remap 旧 contract_id → signing_contracts.id + content_hash 重算 + prev_hash 重链（多条目链 verify 通过）', async () => {
  const { raw, db } = await setup();
  const s = raw.prepare(`INSERT INTO users (username,password_hash,salt,role) VALUES ('l_s1','x','x','student')`).run();
  const s1 = Number(s.lastInsertRowid);
  const t = raw.prepare(`INSERT INTO users (username,password_hash,salt,role) VALUES ('l_t1','x','x','teacher')`).run();
  const t1 = Number(t.lastInsertRowid);
  const cv = raw.prepare('INSERT INTO conversations (student_user_id, teacher_user_id) VALUES (?,?)').run(s1, t1);
  const convId = Number(cv.lastInsertRowid);
  raw.prepare(`INSERT INTO signing_contracts (student_user_id,teacher_user_id,conversation_id,stage,signing_status,contract_status,contract_md,legacy_contract_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(s1, t1, convId, 'contract', 'signed', 'signed', 'md-content', 77);
  const scId = raw.prepare('SELECT id FROM signing_contracts').get().id;
  const bodyHash = await sha256Hex('md-content');
  // 两条链（一次合作两次签署 = 常态）：row1 旧 content_hash 用旧 id=77 算；row2 prev=row1 旧 hash
  const h1_old = await sha256Hex(`${bodyHash}|77|2026-08-01 00:00:00|GENESIS`);
  const h2_old = await sha256Hex(`${bodyHash}|77|2026-08-02 00:00:00|${h1_old}`);
  raw.prepare(`INSERT INTO contract_ledger (contract_id, content_hash, prev_hash, seq, body_hash, created_at) VALUES (77, ?, 'GENESIS', 1, ?, '2026-08-01 00:00:00')`).run(h1_old, bodyHash);
  raw.prepare(`INSERT INTO contract_ledger (contract_id, content_hash, prev_hash, seq, body_hash, created_at) VALUES (77, ?, ?, 2, ?, '2026-08-02 00:00:00')`).run(h2_old, h1_old, bodyHash);
  await initLedgerTable(db); // remap + 重算 + 重链
  const rows = await dbAll(db, 'SELECT id, contract_id, content_hash, prev_hash, seq, body_hash, created_at FROM contract_ledger WHERE contract_id=? ORDER BY id ASC', [scId]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].contract_id, scId, 'contract_id remap');
  const chain = await verifyChain(rows, { contractId: scId, contractMd: 'md-content' });
  assert.ok(chain.linksValid, `prev_hash 重链连续（BUG-1 修复）；row2.prev=${rows[1].prev_hash.slice(0,8)} row1.hash=${rows[0].content_hash.slice(0,8)}`);
  assert.equal(chain.lastRehashValid, true, '末条重放一致（rehash 用新 id 同 verify 规则）');
  assert.ok(chain.ok, '整链有效');
  // 幂等：再跑零变更
  const snapshot = JSON.stringify(rows.map(r => ({ id: r.id, contract_id: r.contract_id, content_hash: r.content_hash, prev_hash: r.prev_hash })));
  await initLedgerTable(db);
  const again = await dbAll(db, 'SELECT id, contract_id, content_hash, prev_hash FROM contract_ledger ORDER BY id');
  assert.equal(JSON.stringify(again), snapshot, '幂等：重跑零变更');
});
