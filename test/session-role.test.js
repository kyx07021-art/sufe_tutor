/**
 * 按角色会话分键回归（B4：直接 import core/state + core/api）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, saveSession, loadSession, clearSession } from '../src/client/core/state.js';
import { api } from '../src/client/core/api.js';

function makeStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k,v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

function reset() {
  for (const role of ['student', 'teacher', '']) clearSession(role);
  state.user = null; state.authToken = null; state.view = 'landing';
}

test('按角色会话分键：学生/教师互不覆盖；清当前角色保留另一角色', () => {
  reset();
  state.user = { id: 1, role: 'student' }; state.authToken = 'stu-token'; saveSession(true);
  state.user = { id: 2, role: 'teacher' }; state.authToken = 'tea-token'; saveSession(true);
  assert.equal(loadSession('student').authToken, 'stu-token');
  assert.equal(loadSession('teacher').authToken, 'tea-token');
  clearSession('student');
  assert.equal(loadSession('student'), null);
  assert.equal(loadSession('teacher').authToken, 'tea-token');
});

test('loadSession 无角色参数：按 sufe_last_role 恢复', () => {
  reset();
  state.user = { id: 2, role: 'teacher' }; state.authToken = 't'; saveSession(false);
  assert.equal(loadSession().authToken, 't');
});

test('clearSession 无角色参数 = 空操作', () => {
  reset();
  state.user = { id: 1, role: 'student' }; state.authToken = 'a'; saveSession(true);
  state.user = { id: 2, role: 'teacher' }; state.authToken = 'b'; saveSession(true);
  clearSession();
  assert.equal(loadSession('student').authToken, 'a');
  assert.equal(loadSession('teacher').authToken, 'b');
  clearSession('student');
  assert.equal(loadSession('student'), null);
  assert.equal(loadSession('teacher').authToken, 'b');
});

test('A1 审计：401 兜底按发起时刻令牌校验——旧令牌在途 401 不清新角色会话', async () => {
  reset();
  state.user = { id: 1, role: 'student' }; state.authToken = 'stu-token'; saveSession(true);
  let release; const hold = new Promise(r => { release = () => r({ ok: false, status: 401, json: async () => ({ error: '会话过期' }) }); });
  const saved = globalThis.fetch; globalThis.fetch = () => hold;
  const p = api('/api/slow');
  state.user = { id: 2, role: 'teacher' }; state.authToken = 'new-token'; saveSession(true); state.view = 'client';
  release();
  await assert.rejects(p, /会话过期/);
  globalThis.fetch = saved;
  assert.equal(loadSession('teacher').authToken, 'new-token');
  assert.equal(loadSession('student').authToken, 'stu-token');
  assert.equal(state.authToken, 'new-token');
  assert.equal(state.user.role, 'teacher');
});
