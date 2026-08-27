/**
 * 文本审核咽喉：
 *   - L1 规则层：ADDRESS_GUARD 连字符变体 / 数字谐音后缀（2788好）拦截（恒在，本地零成本）；
 *   - L2 语义层：经 TEXT_AUDIT.ENABLED 开关控制——当前 false（关闭），L1 通过即放行、零 LLM 调用；
 *     翻 true 恢复 fail-closed（未配置密钥 / 网络异常 / 解析失败 → layer:'error' 拒绝）；
 *   - 路由集成：教师档案 intro 谐音门牌 → 400。
 */
import { test } from 'node:test';
import { TEST_SECRETS } from './_test-secrets.js';
import assert from 'node:assert/strict';
import { auditFreeText, bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { auditBeforeWrite } from '../src/server/core/audit-flow.js';
import { TEXT_AUDIT } from '../src/shared/config.js';

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
// （L2 关闭态 L1 放行即过；fetch stub 仅兼容开关恢复场景）
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

test('L2 开关锁定：TEXT_AUDIT.ENABLED === false（DeepSeek 语义审核关闭）', () => {
  assert.equal(TEXT_AUDIT.ENABLED, false, 'L2 必须关闭——翻 true 前需先确认用户意图');
});

test('L2 开关关闭：AI 判 flag 的方位描述也放行（L1 未命中即过），零 LLM 调用', async () => {
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return SEMANTIC_FLAG(); };
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    // 纯方位描述（L1 正则不命中，曾由 L2 拦截）——L2 关闭后放行
    const r = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
    assert.equal(r.ok, true, 'L2 关闭：L1 未命中即放行');
    assert.equal(r.layer, 'rule', '规则层放行（不经语义层）');
    assert.equal(calls, 0, '零 DeepSeek 调用');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

test('L2 开关关闭：未配置 key / 网络异常 / 解析失败全零影响（根本不调 LLM）', async () => {
  const orig = globalThis.fetch;
  try {
    bindTextAuditEnv(null); // 未配置 key
    let r = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(r.ok, true, '未配置 key 也放行');
    assert.equal(r.layer, 'rule');
    bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'k' });
    globalThis.fetch = async () => { throw new Error('network down'); }; // 网络异常
    r = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(r.ok, true, '网络异常零影响（零调用）');
    assert.equal(r.layer, 'rule');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '没法判断' } }] }) }); // 非 JSON
    r = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(r.ok, true, '解析失败零影响（零调用）');
    assert.equal(r.layer, 'rule');
  } finally { globalThis.fetch = orig; bindTextAuditEnv(null); }
});

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
