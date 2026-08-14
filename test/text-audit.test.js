/**
 * 文本审核咽喉（v0.25.113）：地址门控语义级兜底方案
 *
 * 用户需求（2026-08-10）：「二期爸爸号」「2期8霸昊」「2788好」「对门二楼左转第一间房」等
 * 谐音/语义级地址绕过，纯正则规则层兜不住 → 语义层（可选外接，fail-open）。
 * 接口 auditFreeText 独立清晰：规则层（L1）+ 语义层（L2，密钥配置后启用），未来全站统一审核
 * 只演进 text-audit 模块，调用点不变。
 *
 * 本测试覆盖：
 *   - L1 规则层：ADDRESS_GUARD 连字符变体 / 数字谐音后缀（2788好）拦截；
 *   - L2 语义层：未配置密钥 → fail-open（仅规则层，放行）；配置密钥 + AI 判 flagged → 拦截
 *     （layer:'ai'）；AI 判未命中 → 放行；AI 网络异常 → fail-open 放行；
 *   - 路由集成：教师档案 intro 谐音门牌 → 400。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditFreeText, bindTextAuditEnv } from '../server/text-audit.js';
import { initDb } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';
import { handleSaveProfile } from '../server/routes-teacher.js';

test('L1 规则层：连字符变体与数字谐音后缀拦截（2788好 等）', async () => {
  // ADDRESS_GUARD 连字符变体（v0.25.113）
  assert.equal((await auditFreeText('浦东新区杨高中路贰-柒-捌-捌-号')).ok, false, '贰-柒-捌-捌-号 拦截');
  assert.equal((await auditFreeText('杨高中路2-7-8-8号')).ok, false, '2-7-8-8号 拦截');
  // 数字谐音后缀（号→好/昊/豪）
  assert.equal((await auditFreeText('家在2788好旁边')).ok, false, '2788好（号谐音）拦截');
  assert.equal((await auditFreeText('静安区2788昊')).ok, false, '2788昊 拦截');
  // 放行：号线/纯路名/无门牌
  assert.equal((await auditFreeText('地铁九号线站附近')).ok, true, '号线放行');
  assert.equal((await auditFreeText('浦东新区杨高中路')).ok, true, '纯路名放行');
  assert.equal((await auditFreeText('')).ok, true, '空值放行');
});

test('L2 语义层：未配置密钥 → fail-open（仅规则层，规则未命中即放行）', async () => {
  bindTextAuditEnv(null); // 无 env → getSecret 空 → 不调 AI
  const r = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
  assert.equal(r.ok, true, '语义级描述在未配置 AI 时规则层放行（fail-open，不阻塞提交）');
  assert.equal(r.layer, 'rule', 'fail-open 走规则层标注');
});

test('L2 语义层：配置密钥 + AI 判含可定位住址 → 拦截（layer:ai）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).includes('api.anthropic.com'), '走 Anthropic Messages API');
    assert.ok(opts.headers['x-api-key'], '携带密钥');
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"flagged": true, "reason": "含方位描述可定位住址"}' }] }) };
  };
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    const r = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
    assert.equal(r.ok, false, 'AI 判定可定位住址 → 拦截');
    assert.equal(r.layer, 'ai', '语义层拦截标注');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

test('L2 语义层：AI 判未命中 → 放行；AI 网络异常 → fail-open 放行', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"flagged": false, "reason": "无住址信息"}' }] }) });
    bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'k' });
    const pass = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(pass.ok, true, 'AI 判未命中 → 放行');
    assert.equal(pass.layer, 'ai', '语义层放行标注');
    // 网络异常（reject）→ fail-open 回退规则层
    globalThis.fetch = async () => { throw new Error('network down'); };
    const fo = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(fo.ok, true, 'AI 异常 fail-open 放行（不阻塞提交）');
    assert.equal(fo.layer, 'rule', 'fail-open 回退规则层');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

// ---- 路由集成 ----
const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123', OTP_PROVIDER: 'mock' }; // mock：测试不真实发信
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
test('路由集成：教师档案 intro 谐音门牌（2788好）→ 400', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const db = d1Shim(raw);
  await initDb(db, ENV);
  raw.exec(`INSERT INTO users (username,password_hash,salt,role) VALUES ('tea','h','s','teacher')`);
  const id = raw.prepare("SELECT id FROM users WHERE username='tea'").get().id;
  const token = 'tea-token';
  raw.prepare('INSERT INTO auth_sessions (token_hash,user_id,label,expires_at) VALUES (?,?,?,?)')
    .run(await tokenDigest(token), id, 'x', '2099-01-01 00:00:00');
  const req = { headers: new Headers({ 'X-Auth-Token': token }) };
  bindTextAuditEnv(null); // 语义层 fail-open，规则层兜底
  const base = { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200 };
  const r = await handleSaveProfile(db, { profile: { ...base, intro: '家在2788好对面' } }, req);
  assert.equal(r.status, 400, '谐音门牌写入教师 intro → 400');
  // 正常 intro 放行
  const ok = await handleSaveProfile(db, { profile: { ...base, intro: '喜欢教学，注重方法' } }, req);
  assert.equal(ok.status, 200, '正常 intro 放行');
});
