/**
 * 文本审核咽喉（v1.5.0 fail-closed）：
 *   - L1 规则层：ADDRESS_GUARD 连字符变体 / 数字谐音后缀（2788好）拦截；
 *   - L2 语义层：配置密钥 + AI 判 flagged → 拦截；未命中 → 放行；
 *   - fail-closed：未配置密钥 / 网络异常 / 解析失败 → layer:'error' 拒绝；
 *   - 路由集成：教师档案 intro 谐音门牌 → 400。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditFreeText, bindTextAuditEnv } from '../server/text-audit.js';
import { initDb } from '../server/db.js';
import { tokenDigest } from '../server/crypto.js';
import { handleSaveProfile } from '../server/routes-teacher.js';

const SEMANTIC_PASS = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false, "reason": "无住址信息"}' } }] }) });
const SEMANTIC_FLAG = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": true, "reason": "含方位描述可定位住址"}' } }] }) });

test('L1 规则层：连字符变体与数字谐音后缀拦截（2788好 等）', async () => {
  // L1 命中在语义层之前返回，不依赖 AI 配置
  assert.equal((await auditFreeText('浦东新区杨高中路贰-柒-捌-捌-号')).ok, false, '贰-柒-捌-捌-号 拦截');
  assert.equal((await auditFreeText('杨高中路2-7-8-8号')).ok, false, '2-7-8-8号 拦截');
  assert.equal((await auditFreeText('家在2788好旁边')).ok, false, '2788好（号谐音）拦截');
  assert.equal((await auditFreeText('静安区2788昊')).ok, false, '2788昊 拦截');
  assert.equal((await auditFreeText('')).ok, true, '空值放行');
});

test('L2 fail-closed：未配置密钥 → layer:error 拒绝写入', async () => {
  bindTextAuditEnv(null);
  const r = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
  assert.equal(r.ok, false, '未配置语义层不再放行');
  assert.equal(r.layer, 'error', '标注服务不可用');
});

test('L2 语义层：配置密钥 + AI 判含可定位住址 → 拦截（layer:ai）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.ok(String(url).includes('api.deepseek.com'), '走 DeepSeek chat/completions');
    assert.ok(String(opts.headers.authorization).startsWith('Bearer '), '携带 DeepSeek Bearer 密钥');
    return SEMANTIC_FLAG();
  };
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    const r = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
    assert.equal(r.ok, false, 'AI 判定可定位住址 → 拦截');
    assert.equal(r.layer, 'ai', '语义层拦截标注');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

test('L2 语义层：AI 判未命中 → 放行；网络异常/非 JSON → fail-closed', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => SEMANTIC_PASS();
    bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'k' });
    const pass = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(pass.ok, true, 'AI 判未命中 → 放行');
    assert.equal(pass.layer, 'ai', '语义层放行标注');
    // 网络异常 → 拒绝（不再回退规则层放行）
    globalThis.fetch = async () => { throw new Error('network down'); };
    const netErr = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(netErr.ok, false, 'AI 异常 fail-closed 拒绝写入');
    assert.equal(netErr.layer, 'error');
    // 模型输出非 JSON → 拒绝
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '没法判断' } }] }) });
    const parseErr = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(parseErr.ok, false, '解析失败 fail-closed');
    assert.equal(parseErr.layer, 'error');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

// ---- 路由集成 ----
const ENV = { ADMIN_USERNAMES: ['admin_sufe'], ADMIN_DEFAULT_PASSWORD: 'test-pw-123' };
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
test('路由集成：教师档案 intro 谐音门牌（2788好）→ 400；正常 intro 语义层放行', async () => {
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
  const orig = globalThis.fetch;
  globalThis.fetch = async () => SEMANTIC_PASS();
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'k' });
  try {
    const base = { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200 };
    const r = await handleSaveProfile(db, { profile: { ...base, intro: '家在2788好对面' } }, req);
    assert.equal(r.status, 400, '谐音门牌写入教师 intro → 400');
    const ok = await handleSaveProfile(db, { profile: { ...base, intro: '喜欢教学，注重方法' } }, req);
    assert.equal(ok.status, 200, '正常 intro 放行');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});
