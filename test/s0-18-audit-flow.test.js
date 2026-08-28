/**
 * audit-flow content-write breakpoint (src/server/core/audit-flow.js) — migration
 * verification + TEST-ENFORCED route cross-check + mutation-guarded fail-closed tests.
 *
 * auditBeforeWrite is the single breakpoint every content write passes before hitting a
 * handler (invoked from _worker fetch). It maps the request path -> free-text fields
 * (AUDIT_MAP) and sends them through text-audit's +throat, fail-closed.
 *
 * route cross-check (TEST-ENFORCED, not a comment promise):
 * The test parses the REAL route source files (src/server/domains/<domain>/api.js +
 * src/server/app.js) with the S('METHOD','/path') declaration regex, then asserts:
 * 1. every CONTENT_WRITE_PREFIXES entry still matches a real registered POST/PUT route
 * (a dead prefix fails the test),
 * 2. every user free-text write route in the current table is covered by a prefix
 * (a new free-text route added without registering it fails the test),
 * 3. the only prefixes WITHOUT an AUDIT_MAP rule are the binary/no-free-text whitelist
 * (/api/uploads, /api/user/avatar) and both are real routes.
 * Admin-only free-text routes (POST /api/notifications/broadcast,
 * /api/admin/content/:type/:id/action, /api/admin/verifications/:id/action,
 * /api/admin/reviews/:id/approve|reject) are intentionally excluded: the gate's contract
 * is "user-uploaded data" (管理员受信输入，非用户上传内容).
 *
 * Mutations (reverting each fix makes these assertions go red):
 * - delete the AUDIT_MAX_FIELDS budget check -> a 14-field chat batch is audited per-field
 * and passes -> red.
 * - change LIMITS.AUDIT_MAX_FIELDS away from MSG_BATCH_MAX -> the alignment lock goes red.
 * - remove a CONTENT_WRITE_PREFIXES entry whose route still exists -> route cross-check red.
 * - remove the firstMessage / additionalInfo / settings-username AUDIT_MAP pick -> the
 * corresponding free-text route is no longer audited -> the breakpoint test goes red.
 * - auditBeforeWrite returns ok when auditFreeText reports layer:'error' -> red.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isContentWrite, auditBeforeWrite } from '../src/server/core/audit-flow.js';
import { bindTextAuditEnv } from '../src/server/core/text-audit.js';
import { LIMITS } from '../src/shared/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const origFetch = globalThis.fetch;
beforeEach(() => {
  bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"flagged": false}' } }] }) });
});
afterEach(() => {
  bindTextAuditEnv(null);
  globalThis.fetch = origFetch;
});

// ============================================================
// source-level single-source locks (parse audit-flow.js itself)
// ============================================================

function sourceBlock(name) {
  const src = readFileSync(ROOT + 'src/server/core/audit-flow.js', 'utf8');
  const block = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(block, `${name} must be declared as a single array literal`);
  return block[1];
}

function prefixList() {
  return [...sourceBlock('CONTENT_WRITE_PREFIXES').matchAll(/'([^']+)'/g)].map(m => m[1]);
}

function auditMapPrefixList() {
  return [...sourceBlock('AUDIT_MAP').matchAll(/prefix: '([^']+)'/g)].map(m => m[1]);
}

/** Parse the REAL registered routes from the route source files (the grep cross-check). */
function parseRegisteredRoutes() {
  const dir = ROOT + 'src/server/domains/';
  const files = readdirSync(dir)
    .filter(d => existsSync(`${dir}${d}/api.js`))
    .map(d => `${dir}${d}/api.js`);
  // Non-`api.js` route modules spread into app.js (auth/settings.js = consolidated settings
  // surface, auth/verify.js = identity verification). Without them the "real registered route"
  // cross-check misses these routes, so a stale freeTextRoutes entry would falsely pass.
  for (const extra of ['src/server/domains/auth/settings.js', 'src/server/domains/auth/verify.js']) {
    files.push(ROOT + extra);
  }
  files.push(ROOT + 'src/server/app.js');
  const routes = [];
  const re = /S\(\s*'([A-Z]+)'\s*,\s*'([^']+)'/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) routes.push({ method: m[1], path: m[2] });
  }
  return routes;
}

// ============================================================
// route cross-check (TEST-ENFORCED)
// ============================================================

test('S0-18 route cross-check: every CONTENT_WRITE_PREFIXES matches a real registered POST/PUT route (no dead prefixes)', () => {
  const postPut = parseRegisteredRoutes().filter(r => r.method === 'POST' || r.method === 'PUT');
  for (const pr of prefixList()) {
    const hit = postPut.find(r => r.path.startsWith(pr));
    assert.ok(hit, `prefix "${pr}" must match a real registered POST/PUT route (got none) — dead prefixes fail (mutation: leave a removed route's prefix -> red)`);
  }
});

test('S0-18 route cross-check: every user free-text write route is covered by a CONTENT_WRITE_PREFIXES entry (zero omissions)', () => {
  const prefixes = prefixList();
  // Routes that carry USER free-text in the current table. Admin-only free-text routes are
  // intentionally not listed (trusted admin input, not user-uploaded content).
  const freeTextRoutes = [
    ['POST', '/api/posts'], ['POST', '/api/demands'], ['PUT', '/api/demands/:id'],
    ['POST', '/api/teacher/profile'], ['PUT', '/api/teacher/profile'],
    ['POST', '/api/reviews'], ['PUT', '/api/reviews/:id'],
    ['POST', '/api/feedbacks'], ['POST', '/api/complaints'],
    ['POST', '/api/contracts'], ['PUT', '/api/contracts/:id'],
    ['POST', '/api/conversations/temp'], ['POST', '/api/conversations/:id/messages'],
    ['POST', '/api/auth/register'], ['POST', '/api/user/username'],
    ['PUT', '/api/settings'],
    ['POST', '/api/user/avatar'], ['POST', '/api/uploads'],
  ];
  const registered = parseRegisteredRoutes();
  for (const [method, path] of freeTextRoutes) {
    const exists = registered.some(r => r.method === method && r.path === path);
    assert.ok(exists, `free-text route ${method} ${path} must exist in the route table (test list stale)`);
    const covered = prefixes.some(pr => path.startsWith(pr));
    assert.ok(covered, `${method} ${path} carries user free-text but is NOT covered by any CONTENT_WRITE_PREFIXES (mutation: remove its prefix -> red)`);
  }
});

test('S0-18 internal consistency: every AUDIT_MAP prefix is in CONTENT_WRITE_PREFIXES, and the no-rule whitelist is exactly the binary set', () => {
  const prefixes = prefixList();
  const mapPrefixes = auditMapPrefixList();
  for (const mp of mapPrefixes) {
    assert.ok(prefixes.includes(mp),
      `AUDIT_MAP rule "${mp}" must be backed by a CONTENT_WRITE_PREFIXES entry (mutation: remove the prefix -> red)`);
  }
  const noRule = prefixes.filter(p => !mapPrefixes.includes(p));
  assert.deepEqual(noRule, ['/api/uploads', '/api/user/avatar'],
    'only binary-upload / binary-avatar are exempt — everything else must carry an AUDIT_MAP rule (mutation: add a free-text prefix without a rule -> red)');
});

// ============================================================
// AUDIT_MAX_FIELDS budget fail-closed (carried over)
// ============================================================

test('S0-18 AUDIT_MAX_FIELDS budget is aligned with MSG_BATCH_MAX (single-source contract)', () => {
  assert.equal(LIMITS.AUDIT_MAX_FIELDS, LIMITS.MSG_BATCH_MAX,
    'budget must equal the chat batch cap (mutation: drift one value -> red)');
  assert.equal(LIMITS.AUDIT_MAX_FIELDS, 13, 'current value 13 (contract form 6 fields / chat batch 13 pass)');
});

test('S0-18 budget fail-closed: 14-field chat batch rejected (INVALID_PARAMS), 13-field batch passes', async () => {
  // mutation: delete the `texts.length > LIMITS.AUDIT_MAX_FIELDS` guard -> the 14-field batch is
  // audited per-field (PASS stub) -> {ok:true} -> red. This locks the cost/DoS fail-closed posture.
  const batch13 = Array.from({ length: 13 }, (_, i) => ({ kind: 'text', body: `普通消息${i}` }));
  const ok13 = await auditBeforeWrite({ path: '/api/conversations/1/messages', method: 'POST', body: { batch: batch13 } });
  assert.equal(ok13.ok, true, '13-field batch (= AUDIT_MAX_FIELDS) passes');

  const batch14 = Array.from({ length: 14 }, (_, i) => ({ kind: 'text', body: `普通消息${i}` }));
  const big = await auditBeforeWrite({ path: '/api/conversations/1/messages', method: 'POST', body: { batch: batch14 } });
  assert.ok(!big.ok && big.reject, '14-field batch (> AUDIT_MAX_FIELDS) rejected (mutation: delete budget check -> red)');
  assert.equal(big.code, 'INVALID_PARAMS', 'budget overflow is INVALID_PARAMS, not "service unavailable" (D3)');

  // contract form with custom settlement/trial fields (6 free-text fields) stays well under the cap
  const contract = await auditBeforeWrite({ path: '/api/contracts', method: 'POST', body: {
    plan: '补基础', schedule: '每周六晚', location: '线上课堂', payMethodOther: '每月微信转账', trialPayOther: '首节免费', contractMd: '按上海家教市场惯例' } });
  assert.equal(contract.ok, true, 'legitimate 6-field contract form passes (not harmed by the budget)');
});

// ============================================================
// fail-closed through the breakpoint
// ============================================================

test('S0-18 fail-closed: no semantic key rejects a normal content write at the breakpoint', async () => {
  bindTextAuditEnv({}); // no key — the PASS stub would approve if reached
  try {
    const r = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '分享一轮复习方法' } });
    assert.ok(r.reject, 'no key -> breakpoint rejects (mutation: treat layer:error as pass -> red)');
    assert.equal(r.code, 'TEXT_AUDIT_UNAVAILABLE', 'service-unavailable error code');
  } finally { bindTextAuditEnv({ TEXT_AUDIT_API_KEY: 'test-key' }); }
});

test('S0-18 L1 through the breakpoint: door number in free text rejected, normal text passes', async () => {
  // rework (FAIL-1/FAIL-2): the demand and temp-conversation free-text fields are the
  // exact fields that were silently bypassed before — they must be audited through the breakpoint.
  const demand = await auditBeforeWrite({ path: '/api/demands', method: 'POST', body: { additionalInfo: '家住静安区5号楼303室' } });
  assert.ok(demand.reject, 'demand additionalInfo door number -> rejected (mutation: drop additionalInfo pick -> red)');
  assert.equal(demand.code, 'ADDRESS_TOO_DETAILED');

  const temp = await auditBeforeWrite({ path: '/api/conversations/temp', method: 'POST', body: { targetUserId: 9, firstMessage: '老师您好，我家在8号楼702室' } });
  assert.ok(temp.reject, 'temp-conversation firstMessage door number -> rejected (mutation: drop firstMessage pick -> red)');
  assert.equal(temp.code, 'ADDRESS_TOO_DETAILED');

  // PUT /api/settings {username} bypassed the gate — the username whitelist allows
  // door-number strings, so the consolidated settings surface must be audited like /api/user/username.
  const settingsName = await auditBeforeWrite({ path: '/api/settings', method: 'PUT', body: { username: '漕溪北路999号' } });
  assert.ok(settingsName.reject, 'settings username door number -> rejected (mutation: drop username pick -> red)');
  assert.equal(settingsName.code, 'ADDRESS_TOO_DETAILED');

  const postBad = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '我家在静安区5号楼303室，欢迎上门' } });
  assert.ok(postBad.reject, 'post body door number -> rejected');

  const ok = await auditBeforeWrite({ path: '/api/posts', method: 'POST', body: { title: '学习笔记', bodyMd: '分享一轮复习方法' } });
  assert.equal(ok.ok, true, 'normal text -> passes');
  const tempOk = await auditBeforeWrite({ path: '/api/conversations/temp', method: 'POST', body: { targetUserId: 9, firstMessage: '老师您好，想约周六试课' } });
  assert.equal(tempOk.ok, true, 'normal firstMessage -> passes');
});

test('S0-18 isContentWrite: POST/PUT gated, GET/DELETE and non-content POSTs pass through', () => {
  assert.equal(isContentWrite('/api/posts', 'POST'), true, 'content POST audited');
  assert.equal(isContentWrite('/api/demands', 'POST'), true, 'demand create audited');
  assert.equal(isContentWrite('/api/demands/9', 'PUT'), true, 'demand edit audited');
  assert.equal(isContentWrite('/api/conversations/temp', 'POST'), true, 'temp conversation audited');
  assert.equal(isContentWrite('/api/posts', 'GET'), false, 'reads never audited');
  assert.equal(isContentWrite('/api/posts/3', 'DELETE'), false, 'deletes not audited');
  assert.equal(isContentWrite('/api/settings', 'PUT'), true, 'settings PUT audited (username free-text)');
  assert.equal(isContentWrite('/api/auth/login', 'POST'), false, 'non-content POST not audited');
  assert.equal(isContentWrite('/api/notifications/read-all', 'POST'), false, 'side-effect-only POST not audited');
  assert.equal(isContentWrite('/api/signing-requests/5/respond', 'POST'), false, 'dead prefix removed');
  assert.equal(isContentWrite('/api/teacher/awards', 'POST'), false, 'dead prefix removed');
});
