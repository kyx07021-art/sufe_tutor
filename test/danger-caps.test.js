/**
 * 网安审计 N-02 —— capToken D1 持久化回归（server/danger-ops.js）
 *
 * 背景：capToken 曾存 per-isolate 内存 Map，Cloudflare 多 isolate 分发下 re-auth 签发与
 * 危险操作请求落到不同 isolate → 校验间歇性失败。本测试用「共享 D1 模拟内存」模拟两个
 * 独立 isolate（各自调用 danger-ops 接口），验证 D1 持久化后状态跨实例一致。
 *
 * 断言面：
 *   - 跨实例：isolate A 签发 → isolate B 校验通过（原内存版必失败）
 *   - 一次性：校验命中即删（同 capToken 二次校验失败）
 *   - 会话绑定：异会话复用同一 capToken 失败（原版仅绑 userId 可复用）
 *   - 摘要存储：danger_caps 只存 SHA-256，明文 token 永不入库
 *   - 过期失效：expires 已过的 capToken 校验失败
 *   - 明文 token 仅签发时回传一次
 *
 * fake D1：内存表模拟 prepare().bind().all()/run()/first()，跨两次「isolate 调用」共享
 * 同一表（模拟 D1 全局存储），而 danger-ops 的模块级状态被隔离（无模块级状态可隔离——
 * 这正是本测试要证明的：校验不再依赖任何 per-isolate 内存）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueCapToken, confirmDangerOtp, initDangerCaps } from '../server/danger-ops.js';

// ============================================================
// 内存表 fake D1（prepare/bind/all|first|run 链；按 SQL 表路由，表跨调用共享模拟 D1 全局性）
// 支持三种形状：authUser 的 JOIN 查询（auth_sessions s JOIN users u）、getSessionByToken 的
// auth_sessions 单表查、danger_caps 的 INSERT/DELETE。足够覆盖 danger-ops 依赖链。
// ============================================================
function memDb() {
  const tables = {}; // name → row[]
  const sqlCalls = [];
  const db = {
    sqlCalls,
    _tables: tables,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all: async () => ({ results: execSelect(sql, params) }),
            first: async () => execSelect(sql, params)[0] || null,
            run: async () => execRun(sql, params),
          };
        },
      };
    },
  };

  function tableOf(sql) {
    // auth_sessions JOIN users（authUser）：命中 auth_sessions 表
    const join = sql.match(/JOIN\s+users/i);
    if (join && /auth_sessions/i.test(sql)) return 'auth_sessions';
    const m = sql.match(/(?:INTO|FROM|UPDATE)\s+(\w+)/i);
    if (!m) return null;
    if (['danger_caps', 'auth_sessions', 'users'].includes(m[1]) && !tables[m[1]]) tables[m[1]] = [];
    return m[1];
  }
  function colNames(sql) {
    const ins = sql.match(/INSERT INTO \w+\s*\(([^)]*)\)/i);
    if (ins) return ins[1].split(',').map(s => s.trim());
    const sel = sql.match(/SELECT\s+([^FROM]+)\s+FROM/i);
    if (sel) return sel[1].split(',').map(s => s.trim().replace(/^u\.|^s\.|^r\./, ''));
    return [];
  }
  function execSelect(sql, params) {
    sqlCalls.push({ sql, params });
    const t = tableOf(sql);
    const rows = (t && tables[t]) ? tables[t].slice() : [];
    if (t === 'auth_sessions' && /JOIN\s+users/i.test(sql)) {
      // authUser：SELECT u.id,u.username,u.role,u.avatar,u.banned,s.expires_at AS token_expires ... WHERE s.token_hash=?
      const th = params[0];
      const s = rows.find(r => r.token_hash === th);
      if (!s) return [];
      const u = (tables['users'] || []).find(r => r.id === s.user_id) || {};
      return [{ id: u.id, username: u.username, role: u.role, avatar: u.avatar, banned: u.banned, token_expires: s.expires_at }];
    }
    if (t === 'auth_sessions') {
      // getSessionByToken：SELECT session_id ... WHERE user_id=? AND token_hash=?
      const [uid, th] = params;
      return rows.filter(r => r.user_id === uid && r.token_hash === th).map(r => ({ session_id: r.session_id }));
    }
    if (t === 'danger_caps') return rows; // 测试断言用
    return [];
  }
  function execRun(sql, params) {
    sqlCalls.push({ sql, params });
    const t = tableOf(sql);
    if (!t) return { meta: { changes: 1 } };
    if (t === 'danger_caps' && /DELETE FROM/i.test(sql)) {
      const rows = tables[t] || [];
      const before = rows.length;
      // WHERE session_id=? AND token_hash=? AND expires_at > datetime('now','localtime')
      //  —— 命中即删（一次性）；expires_at 已过的行不命中（mock 用真实时间比较，等价 datetime('now')）
      const [sessionId, tokenHash] = params;
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const kept = rows.filter(r => !(r.session_id === sessionId && r.token_hash === tokenHash && r.expires_at > now));
      tables[t] = kept;
      return { meta: { changes: before - kept.length } };
    }
    if (t === 'danger_caps' && /INSERT INTO/i.test(sql)) {
      if (!tables[t]) tables[t] = [];
      const cols = colNames(sql);
      const conflict = sql.match(/ON CONFLICT\(([^)]*)\)/i);
      const keyCols = conflict ? conflict[1].split(',').map(s => s.trim()) : [];
      const obj = {};
      cols.forEach((c, i) => { obj[c] = params[i]; });
      if (keyCols.length) {
        const idx = tables[t].findIndex(r => keyCols.every(k => r[k] === obj[k]));
        if (idx >= 0) { tables[t][idx] = obj; return { meta: { changes: 1, last_row_id: 0 } }; }
      }
      tables[t].push(obj);
      return { meta: { changes: 1, last_row_id: tables[t].length } };
    }
    return { meta: { changes: 1 } };
  }
  return db;
}

const sha256Hex = async s =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

function makeReq(token = 'TOKEN1') {
  return { headers: { get: h => (h === 'X-Auth-Token' ? token : null) } };
}

/** 预置：用户 1 两个会话（S1=TOKEN1 主设备，S2=TOKEN2 另一设备），token_hash 为摘要 */
async function seedSessions(db) {
  db._tables['users'] = [{ id: 1, username: 'u1', role: 'student', banned: 0 }];
  db._tables['auth_sessions'] = [
    { id: 1, token_hash: await sha256Hex('TOKEN1'), session_id: 'S1', user_id: 1, label: 'dev', expires_at: '2099-01-01 00:00:00' },
    { id: 2, token_hash: await sha256Hex('TOKEN2'), session_id: 'S2', user_id: 1, label: 'other-device', expires_at: '2099-01-01 00:00:00' },
  ];
}

test('跨实例：isolate A 签发 → isolate B 校验通过（D1 全局一致，N-02 根因）', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  const cap = await issueCapToken(db, makeReq('TOKEN1')); // isolate A 签发
  assert.ok(cap && cap.length > 20, '签发返回明文 capToken');
  const ok = await confirmDangerOtp(db, makeReq('TOKEN1'), { capToken: cap }); // isolate B 校验
  assert.equal(ok, true, '异 isolate 校验应通过（D1 持久化而非 per-isolate 内存）');
});

test('一次性：命中即删，同 capToken 二次校验失败', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  const cap = await issueCapToken(db, makeReq('TOKEN1'));
  assert.equal(await confirmDangerOtp(db, makeReq('TOKEN1'), { capToken: cap }), true);
  assert.equal(await confirmDangerOtp(db, makeReq('TOKEN1'), { capToken: cap }), false, '二次使用应失败');
});

test('会话绑定：异会话复用同 capToken 失败（原版仅绑 userId 可复用）', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  const cap = await issueCapToken(db, makeReq('TOKEN1')); // S1 签发
  const okOther = await confirmDangerOtp(db, makeReq('TOKEN2'), { capToken: cap }); // S2 尝试复用
  assert.equal(okOther, false, '异会话不得复用 capToken');
  const okSelf = await confirmDangerOtp(db, makeReq('TOKEN1'), { capToken: cap }); // 签发会话仍可正常用（未被异会话烧毁）
  assert.equal(okSelf, true, '签发会话应正常使用');
});

test('摘要存储：danger_caps 只存 SHA-256，明文 capToken 永不入库', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  const cap = await issueCapToken(db, makeReq('TOKEN1'));
  const rows = db._tables['danger_caps'] || [];
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, cap, '库内不得存明文');
  assert.equal(rows[0].token_hash, await sha256Hex(cap), '库内为 SHA-256 摘要');
});

test('过期失效：expires 已过的 capToken 校验失败', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  const cap = await issueCapToken(db, makeReq('TOKEN1'));
  const rows = db._tables['danger_caps'];
  rows[0].expires_at = '2000-01-01 00:00:00';
  const ok = await confirmDangerOtp(db, makeReq('TOKEN1'), { capToken: cap });
  assert.equal(ok, false, '过期 capToken 校验失败');
});

test('缺少凭据：无 capToken / 无会话 均失败', async () => {
  const db = memDb();
  await initDangerCaps(db);
  await seedSessions(db);
  assert.equal(await confirmDangerOtp(db, makeReq('TOKEN1'), {}), false, '无 capToken 失败');
  assert.equal(await confirmDangerOtp(db, makeReq('NOPE'), { capToken: 'x' }), false, '未知会话失败');
});
