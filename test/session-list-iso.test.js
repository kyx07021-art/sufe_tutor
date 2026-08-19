/**
 * Q-2a-L4 守护：listSessions 出口时间戳 ISO-8601 带 Z（自描述时区）。
 * 审计：库内 UTC 'YYYY-MM-DD HH:MM:SS' 不自描述，客户端裸 new Date() 按本地解析（早 8 小时）。
 * 修复：auth/api.js handleListSessions 出口 created_at/expires_at 转 ISO（toIso）。
 * 变异：去掉 toIso（直接吐库内格式）→ 断言 Z 后缀失败 → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initDb } from '../src/server/core/db.js';
import { issueAuthToken } from '../src/server/core/session.js';
import { handleListSessions } from '../src/server/domains/auth/api.js';

// node:sqlite → D1 形状薄封装（同 session-device.test.js）
function d1Shim(raw) {
  return {
    prepare(sql) {
      const st = {
        _sql: sql, _params: [],
        bind(...p) { st._params = p; return st; },
        all(...p) { return { results: raw.prepare(st._sql).all(...(p.length ? p : st._params)) }; },
        first(...p) { return raw.prepare(st._sql).get(...(p.length ? p : st._params)) ?? undefined; },
        run(...p) {
          const info = raw.prepare(st._sql).run(...(p.length ? p : st._params));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return st;
    },
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(s._sql)) out.push({ results: raw.prepare(s._sql).all(...s._params) });
          else {
            const info = raw.prepare(s._sql).run(...s._params);
            out.push({ meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
          }
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      }
    },
  };
}

const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };

test('Q-2a-L4：handleListSessions 出口时间 ISO-8601 带 Z（UTC 自描述）', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  await initDb(d1Shim(raw), ENV);
  const uid = raw.prepare("SELECT id FROM users WHERE username='admin_sufe'").get().id;
  const token = await issueAuthToken(d1Shim(raw), uid, 'Windows · Edge');
  const req = { headers: { get: h => (h === 'X-Auth-Token' ? token : null) } };
  const res = await handleListSessions(d1Shim(raw), req);
  assert.equal(res.status, 200, 'handler 200');
  const body = await res.json();
  assert.ok(body && Array.isArray(body.sessions), '返回 sessions 数组');
  const s = body.sessions[0];
  assert.ok(s, '有一条会话');
  assert.match(s.expires_at, /Z$/, `expires_at 带 Z 后缀（变异：吐库内格式 → 无 Z → 红），实际: ${s.expires_at}`);
  assert.match(s.created_at, /Z$/, 'created_at 带 Z 后缀');
  assert.ok(!Number.isNaN(new Date(s.expires_at).getTime()), 'expires_at 可被 Date 正确解析');
  assert.ok(!Number.isNaN(new Date(s.created_at).getTime()), 'created_at 可被 Date 正确解析');
});
