/**
 * text-audit throat (src/server/core/text-audit.js) — migration verification +
 * mutation-guarded tests for the new-site foundation (in-place reuse of v2 core/text-audit.js,
 * already routed the LLM-response JSON block through safeJsonObject).
 *
 * The throat is the single audit entry for every free-text field. Two layers:
 * deterministic rule layer (ADDRESS_GUARD + digit-harmony suffix) — blocks door-number
 * variants ("2788好" = "号" written as a homophone, hyphenated "2-7-8-8号", Chinese-numeral
 * "贰柒捌捌号") WITHOUT any semantic dependency.
 * semantic layer (DeepSeek chat/completions) — fail-closed: no key / HTTP non-OK / network
 * exception / non-JSON model output ALL reject the write (layer:'error'), never fail open.
 *
 * Mutations (reverting each fix makes these assertions go red):
 * - auditSemantic drops `if (!key) return UNAVAILABLE` -> no-key + PASS stub returns
 * {ok:true} -> red (no-key fail-closed is the core mutation).
 * - auditFreeText drops the isYearLike() exclusion inside the harmonic `some()` -> a
 * legitimate "2019好" year is flagged -> red.
 * - auditSemantic drops the `typeof j.flagged !== 'boolean'` parse guard -> model content
 * "{}" (flagged undefined, falsy) or '{"flagged":"yes"}' (truthy string) is treated as a
 * pass / semantic rejection instead of service-unavailable -> the layer assertion goes red.
 * - auditSemantic drops the `!res.ok` guard -> an HTTP 500 whose body still carries a valid
 * {"flagged":false} is parsed as a pass -> red.
 *
 * The two last guards need dedicated shapes: plain non-JSON prose ("没法判断") has no JSON block
 * (j=null) and would reject through the `!j` branch even if the flagged-boolean guard were
 * dropped, and a bare `{ok:false, json:()=>({choices:[]})}` would reject through the empty
 * choices branch even if `!res.ok` were dropped — so those shapes do NOT lock the guards. The
 * shapes below (empty object, non-boolean flag, HTTP error + valid body) are the ones that
 * actually distinguish the guard's presence.
 *
 * Note: the semantic tests share module-level AUDIT_ENV and stub globalThis.fetch — run
 * serially and always restore fetch + env in finally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFreeText, bindTextAuditEnv } from '../src/server/core/text-audit.js';

const PASS = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false, "reason": "no address"}' } }] }) });
const FLAG = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": true, "reason": "locatable address"}' } }] }) });

test('S0-17 L1: door-number variants rejected at the rule layer (no semantic dependency)', async () => {
  bindTextAuditEnv(null); // no key — hits happen BEFORE the semantic layer, so no key is irrelevant
  try {
    const cases = [
      '浦东新区杨高中路2-7-8-8号',
      '浦东新区杨高中路贰-柒-捌-捌-号',
      '家在贰柒捌捌号旁边',
      '静安区5号楼303室',
      '八号楼二单元',
      '静安区壹拾贰号403室',
    ];
    for (const t of cases) {
      const r = await auditFreeText(t);
      assert.equal(r.ok, false, `「${t}」must be blocked at L1 (mutation: drop ADDRESS_GUARD check -> red)`);
      assert.equal(r.layer, 'rule', 'L1 rejection is deterministic, not a semantic call');
    }
  } finally { bindTextAuditEnv(null); }
});

test('S0-17 L1: 4-digit 19xx/20xx year + harmony char is NOT a door number (Z-2-F8 exemption)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = PASS;
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' }); // years pass -> must reach the semantic layer
  try {
    const years = ['2019好老师', '1949好日子', '二〇二六好', '2026届毕业'];
    for (const t of years) {
      const r = await auditFreeText(t);
      assert.equal(r.ok, true, `「${t}」year must not be flagged (mutation: drop isYearLike exclusion -> red)`);
    }
    // a real door number with a harmony suffix is still blocked — the exemption is narrow
    const real = await auditFreeText('静安区2788好');
    assert.equal(real.ok, false, '「2788好」real door number still blocked (exemption must not swallow real numbers)');
    // mixed text with both a year and a real door number must still block (some() semantics)
    const mixed = await auditFreeText('2019好老师 家在2788好对面');
    assert.equal(mixed.ok, false, 'mixed year+door-number text still blocked');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});

test('S0-17 L2 fail-closed: no key rejects even when the semantic API would pass', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = PASS; // the semantic API would approve this text if it were reached
  bindTextAuditEnv({}); // no TEXT_AUDIT_API_KEY
  try {
    const r = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(r.ok, false, 'no key -> fail-closed reject (mutation: drop the key check -> PASS stub -> red)');
    assert.equal(r.layer, 'error', 'marked service-unavailable');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});

test('S0-17 L2 fail-closed: non-JSON / empty-object / malformed-flag model output all reject', async () => {
  const origFetch = globalThis.fetch;
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    // plain non-JSON prose: no JSON block -> j=null -> reject through the !j branch
    globalThis.fetch = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '没法判断' } }] }) });
    const prose = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(prose.ok, false, 'non-JSON prose -> fail-closed reject');
    assert.equal(prose.layer, 'error');

    // empty JSON object: flagged is undefined (falsy) — dropping the boolean guard would PASS it
    globalThis.fetch = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }] }) });
    const emptyObj = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(emptyObj.ok, false, '"{}" (undefined flag) -> fail-closed reject (mutation: drop the flagged-boolean guard -> undefined falsy pass -> red)');
    assert.equal(emptyObj.layer, 'error', 'service-unavailable, not a pass');

    // malformed flag: "yes" is truthy — dropping the boolean guard would block (layer ai) instead
    // of reporting the service unavailable (layer error); the layer assertion carries the guard
    globalThis.fetch = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged":"yes"}' } }] }) });
    const strFlag = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(strFlag.ok, false, 'non-boolean flag still rejects');
    assert.equal(strFlag.layer, 'error', 'non-boolean flag is service-unavailable (mutation: drop the boolean guard -> layer ai -> red)');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});

test('S0-17 L2 fail-closed: HTTP error with a VALID pass body, and network exception, both reject', async () => {
  const origFetch = globalThis.fetch;
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    // HTTP 500 whose body still carries a well-formed {"flagged":false} — dropping the !res.ok
    // guard would parse the body and PASS it, so this shape is the one that locks the guard.
    globalThis.fetch = () => ({ ok: false, status: 500, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) });
    const httpErr = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(httpErr.ok, false, 'HTTP non-OK even with a valid pass body -> fail-closed (mutation: drop !res.ok guard -> parsed pass -> red)');
    assert.equal(httpErr.layer, 'error');

    globalThis.fetch = async () => { throw new Error('network down'); };
    const netErr = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(netErr.ok, false, 'network exception -> fail-closed (mutation: drop the catch -> throw propagates -> red)');
    assert.equal(netErr.layer, 'error');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});

test('S0-17 L2 semantic: AI flagged=true blocks (layer ai); flagged=false passes (layer ai)', async () => {
  const origFetch = globalThis.fetch;
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    globalThis.fetch = FLAG;
    const blocked = await auditFreeText('丁香国际对门学校上二楼左转第一间房');
    assert.equal(blocked.ok, false, 'AI flags locatable address -> blocked');
    assert.equal(blocked.layer, 'ai', 'semantic-layer rejection marker');
    assert.equal(blocked.reason, 'ADDRESS_TOO_DETAILED');

    globalThis.fetch = PASS;
    const allowed = await auditFreeText('希望老师耐心一些，孩子基础一般');
    assert.equal(allowed.ok, true, 'AI finds no address -> allowed');
    assert.equal(allowed.layer, 'ai', 'semantic-layer pass marker');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});

test('S0-17 empty/whitespace text passes at L1 without a semantic call', async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return PASS(); };
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  try {
    assert.equal((await auditFreeText('')).ok, true, 'empty string passes');
    assert.equal((await auditFreeText('   ')).ok, true, 'whitespace passes');
    assert.equal((await auditFreeText(null)).ok, true, 'null passes');
    assert.equal(calls, 0, 'empty text never reaches the semantic layer (no DeepSeek call)');
  } finally { globalThis.fetch = origFetch; bindTextAuditEnv(null); }
});
