/**
 * v2 session data hub: per-endpoint cache, single-flight dedupe, batched prefetch,
 * epoch guard and app-version invalidation.
 *
 * Cache invalidation has exactly two paths (no version-probe protocol):
 *   - write path: a feature calls invalidate(domain) after a write, clearing that
 *     domain's cache entries so the next read refetches;
 *   - release path: dhCheckAppVersion detects an APP_VERSION change -> full clear
 *     (stale cache from a previous deployment is dropped).
 */
import { CONFIG, APP_VERSION } from '../../shared/config.js';
import { api, apiBatch } from './api.js';
import { setDatahubInvalidator, registerLogoutReset, invalidate } from './state.js';

const dhCache = new Map();
const dhInflight = new Map();
let dhEpoch = 0;
const DH_MAX_KEYS = 40;
const DH_VERSION_KEY = 'sufe_app_version';

export function dhPeek(endpoint) {
  const e = dhCache.get(endpoint);
  if (!e) return null;
  if (Date.now() - e.fetchedAt > CONFIG.DH_TTL_MS) { dhCache.delete(endpoint); return null; }
  return e.data;
}

export function dhReady(endpoint) {
  return dhPeek(endpoint) !== null || dhInflight.has(endpoint);
}

export async function dhGet(endpoint, { domain = 'misc', forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const hit = dhPeek(endpoint);
    if (hit !== null) return hit;
  }
  if (dhInflight.has(endpoint)) return dhInflight.get(endpoint);
  const epoch = dhEpoch;
  const p = api(endpoint).then(data => {
    if (epoch !== dhEpoch) return data;
    dhCache.set(endpoint, { domain, data, fetchedAt: Date.now() });
    dhCapCache();
    return data;
  });
  dhInflight.set(endpoint, p);
  try { return await p; } finally { dhInflight.delete(endpoint); }
}

export async function dhBatchGet(entries, { forceRefresh = false } = {}) {
  const list = entries.map(e => (typeof e === 'string' ? { path: e, domain: 'misc' } : e));
  const out = new Map();
  const epoch = dhEpoch;
  const toFetch = [];
  const seen = new Set();

  for (const { path, domain } of list) {
    if (!forceRefresh) {
      const hit = dhPeek(path);
      if (hit !== null) { out.set(path, hit); continue; }
    }
    if (dhInflight.has(path)) {
      try { out.set(path, await dhInflight.get(path)); } catch { /* failed inflight: key not in result */ }
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    toFetch.push({ path, domain });
  }

  if (toFetch.length) {
    const resolvers = new Map();
    for (const { path } of toFetch) {
      const pr = new Promise((res, rej) => resolvers.set(path, { res, rej }));
      pr.catch(() => {});
      dhInflight.set(path, pr);
    }
    let results = new Map();
    const chunkSize = CONFIG.BATCH_GET_MAX || 16;
    try {
      for (let i = 0; i < toFetch.length; i += chunkSize) {
        const chunk = toFetch.slice(i, i + chunkSize);
        const part = await apiBatch(chunk.map(t => t.path));
        for (const [k, v] of part) results.set(k, v);
      }
    } catch (e) {
      for (const { path } of toFetch) { dhInflight.delete(path); resolvers.get(path).rej(e); }
      throw e;
    }
    for (const { path, domain } of toFetch) {
      dhInflight.delete(path);
      const r = results.get(path);
      const pr = resolvers.get(path);
      if (r && r.status === 200) {
        if (epoch === dhEpoch) { dhCache.set(path, { domain, data: r.data, fetchedAt: Date.now() }); dhCapCache(); }
        out.set(path, r.data);
        pr.res(r.data);
      } else {
        const e = new Error((r && r.data && r.data.error) || TEXT.ERROR_REQUEST_FAILED);
        e.code = (r && r.data && r.data.code) || 'BATCH_FAILED';
        pr.rej(e);
      }
    }
  }
  return out;
}

export function dhCapCache() {
  if (dhCache.size <= DH_MAX_KEYS) return;
  const entries = [...dhCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (const [k] of entries.slice(0, dhCache.size - DH_MAX_KEYS)) dhCache.delete(k);
}

export function dhInvalidateDomain(domain) {
  for (const [k, v] of dhCache) if (v.domain === domain) dhCache.delete(k);
}

export function dhInvalidateAll() {
  dhCache.clear();
  dhEpoch++;
}

export function dhCheckAppVersion() {
  try {
    const cur = String(APP_VERSION || '');
    if (!cur) return;
    const prev = localStorage.getItem(DH_VERSION_KEY);
    if (prev && prev !== cur) dhInvalidateAll();
    localStorage.setItem(DH_VERSION_KEY, cur);
  } catch { /* storage unavailable: skip version check */ }
}

export const DH_PREFETCH = {
  student: [
    ['/api/student/demands?scope=mine', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/contracts/my', 'contracts'],
    ['/api/conversations', 'chat'],
    ['/api/notifications', 'notifications'],
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  teacher: [
    ['/api/student/demands?scope=for-teacher', 'demands'],
    ['/api/demand-pushes', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'],
    ['/api/contracts/my', 'contracts'],
    ['/api/conversations', 'chat'],
    ['/api/notifications', 'notifications'],
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  admin: [
    ['/api/admin/stats', 'admin'],
    ['/api/admin/users?role=student', 'admin'],
    ['/api/admin/users?role=teacher', 'admin'],
    ['/api/admin/reviews', 'admin'],
    ['/api/admin/contracts', 'contracts'],
    ['/api/posts', 'posts'],
    ['/api/feedbacks', 'admin'],
    ['/api/auth/sessions', 'account'],
    ['/api/privacy-settings', 'account'],
    ['/api/user/username/status', 'account'],
    ['/api/user/creds', 'account'],
  ],
  'student-guest': [
    ['/api/student/demands', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'],
  ],
  'teacher-guest': [
    ['/api/student/demands', 'demands'],
    ['/api/teachers', 'teachers'],
    ['/api/posts?sort=new', 'posts'],
  ],
};

export function dhPrefetch(role) {
  const keys = DH_PREFETCH[role] || [];
  return dhBatchGet(keys.map(([endpoint, domain]) => ({ path: endpoint, domain }))).catch(() => new Map());
}

/** Test-only reset: clears cache/inflight/baselines so direct-import tests are isolated. */
export function _dhResetForTests() {
  dhCache.clear();
  dhInflight.clear();
  dhEpoch = 0;
}

/**
 * Test-only seed: pre-fill the cache so cache-hit tests start from a known state.
 * entries are {endpoint, domain, data}.
 */
export function _dhSeedForTests({ cache = [] } = {}) {
  for (const e of cache) dhCache.set(e.endpoint, { domain: e.domain, data: e.data, fetchedAt: Date.now() });
}

setDatahubInvalidator(dhInvalidateDomain);
registerLogoutReset(() => { dhInvalidateAll(); });
dhCheckAppVersion();
export { invalidate };
