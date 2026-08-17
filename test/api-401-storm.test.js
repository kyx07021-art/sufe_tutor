/**
 * D3 401 预取风暴收敛（B4：直接 import core/api + core/state）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, setEnsureAuth } from '../src/client/core/api.js';
import { state, clearSession } from '../src/client/core/state.js';

let ensureAuthCalls = 0;
let runLogoutResetsCalls = 0;
setEnsureAuth(() => { ensureAuthCalls++; });

function reset() {
  ensureAuthCalls = 0;
  runLogoutResetsCalls = 0;
  state.authToken = null; state.user = null; state.view = 'landing';
}

const UNAUTH = () => ({ ok: false, status: 401, json: async () => ({ error: '会话已过期', code: 'AUTH_EXPIRED' }) });

test('401 风暴：同刻并发 5 个死令牌 401 只清一次会话、只跳一次登录', async () => {
  reset();
  const saved = globalThis.fetch; globalThis.fetch = async () => UNAUTH();
  state.authToken = 'tok-dead'; state.user = { role: 'student' }; state.view = 'client';
  const results = await Promise.allSettled([0,1,2,3,4].map(() => api('/api/a')));
  globalThis.fetch = saved;
  assert.deepEqual(results.map(r => r.status === 'rejected' ? r.reason.code : 'resolved'),
    ['AUTH_EXPIRED','AUTH_EXPIRED','AUTH_EXPIRED','AUTH_EXPIRED','AUTH_EXPIRED']);
  assert.equal(ensureAuthCalls, 1);
  assert.equal(state.authToken, null);
});

test('幂等键按令牌隔离：重新登录后新 401 重新走兜底', async () => {
  reset();
  const saved = globalThis.fetch; globalThis.fetch = async () => UNAUTH();
  state.authToken = 'tok1'; state.user = { role: 'student' }; state.view = 'client';
  await api('/api/a').catch(() => {});
  state.authToken = 'tok2'; state.user = { role: 'student' }; state.view = 'client';
  await api('/api/b').catch(() => {});
  globalThis.fetch = saved;
  assert.equal(ensureAuthCalls, 2);
  assert.equal(state.authToken, null);
});

test('A1 语义保留：旧令牌在途 401 落回时已重新登录 → 不误清新会话', async () => {
  reset();
  let release; const hold = new Promise(r => { release = r; });
  const saved = globalThis.fetch; globalThis.fetch = () => hold;
  state.authToken = 'tok1'; state.user = { role: 'student' }; state.view = 'client';
  const p1 = api('/api/a').catch(() => {});
  state.authToken = 'tok2'; state.user = { role: 'teacher' };
  release(UNAUTH());
  await p1;
  globalThis.fetch = saved;
  assert.equal(state.authToken, 'tok2', '新会话未被旧 401 清掉');
  assert.equal(state.user && state.user.role, 'teacher');
});
