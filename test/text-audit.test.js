/**
 * 文本审核咽喉（v1.5.0 fail-closed）：
 *   - L1 规则层：ADDRESS_GUARD 连字符变体 / 数字谐音后缀（2788好）拦截；
 *   - L2 语义层：配置密钥 + AI 判 flagged → 拦截；未命中 → 放行；
 *   - fail-closed：未配置密钥 / 网络异常 / 解析失败 → layer:'error' 拒绝；
 *   - 路由集成：教师档案 intro 谐音门牌 → 400。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { auditFreeText, bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { auditBeforeWrite } from '../src/server/core/audit-flow.js';

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

// Z-2-F8 回归：4 位 19xx/20xx 年份（半角/全角/中文数字）后接谐音字不误判——合法内容不被 400 拒绝
// （L1 放行后走语义层，需配置 key + 放行 stub）
test('L1 规则层：年份（2019/1949/二〇二六）后接谐音字不误伤（Z-2-F8）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = SEMANTIC_PASS;
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    assert.equal((await auditFreeText('2019好老师')).ok, true, '2019好 年份不误伤');
    assert.equal((await auditFreeText('1949好日子')).ok, true, '1949好 年份不误伤');
    assert.equal((await auditFreeText('二〇二六好')).ok, true, '中文数字年份（+谐音字）不误伤——真走 isYearLike');
    assert.equal((await auditFreeText('二〇二六届毕业')).ok, true, '中文数字年份不误伤');
    // 对照：真实门牌谐音仍拦（收窄不放过真门牌）
    assert.equal((await auditFreeText('静安区2788好')).ok, false, '2788好 仍拦截');
    // 多命中：同文本含年份 + 真门牌 → 任一非年份命中即拦（some 语义）
    assert.equal((await auditFreeText('2019好老师 家在2788好对面')).ok, false, '多命中混合文本仍拦真门牌');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
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
// Q-2c-F5：域内联 audit 已删（_worker 全局断点 auditBeforeWrite 统一接管教师档案 intro/school 审计，
// 避免 DeepSeek 双审翻倍）。路由集成语义（谐音门牌 400）改由全局断点直测锁定——
// 这才是生产真实生效的审计面（_worker 对所有 /api/teacher/profile POST/PUT 调用 auditBeforeWrite）。
test('Q-2c-F5 全局断点：教师档案 intro 谐音门牌（2788好）→ 拒绝；正常 intro 语义层放行', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => SEMANTIC_PASS();
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'k' });
  try {
    const bad = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '家在2788好对面' } } });
    assert.ok(!bad.ok && bad.reject, '谐音门牌写入教师 intro → 全局断点拒绝');
    const ok = await auditBeforeWrite({ path: '/api/teacher/profile', method: 'POST', body: { profile: { intro: '喜欢教学，注重方法' } } });
    assert.equal(ok.ok, true, '正常 intro 放行');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});
