/**
 * B0 state core：会话持久化、偏好读写、缓存失效与登出重置注册表。
 * 直接 ESM 导入 src/client/core/state.js，用 jsdom 提供 storage。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  state, STATUS, setDatahubInvalidator, invalidate, saveSession, loadSession, clearSession,
  savePageState, getLastPage, setLastGuestRole, getLastGuestRole, getDeviceId,
  getThemePref, storeThemePref, getOrbPref, setOrbPref, isReturning, setReturning,
  uiScaleClamp, getUiScale, applyUiScale, setUiScale, uiScaleFillPct,
  registerLogoutReset, runLogoutResets, createSlice, setState,
} from '../src/client/core/state.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const w = dom.window;
globalThis.localStorage = w.localStorage;
globalThis.sessionStorage = w.sessionStorage;
globalThis.document = w.document;
globalThis.window = w;

function wipeSession() {
  for (const k of Object.keys(w.localStorage)) w.localStorage.removeItem(k);
  for (const k of Object.keys(w.sessionStorage)) w.sessionStorage.removeItem(k);
}

test('state 初始形态与 createSlice/setState', () => {
  assert.equal(state.user, null);
  assert.equal(STATUS.OPEN, 'open');
  assert.equal(STATUS.CONTRACTED, 'contracted');
  const slice = createSlice('tmpList', [1]);
  slice.set([2, 3]);
  assert.deepEqual(state.tmpList, [2, 3]);
  setState({ view: 'client', page: 'settings' });
  assert.equal(state.view, 'client');
  assert.equal(state.page, 'settings');
  state.view = 'landing';
  delete state.tmpList;
});

test('uiScale 钳制/换算/持久化', () => {
  assert.equal(uiScaleClamp('abc'), 100);
  assert.equal(uiScaleClamp(200), 120);
  assert.equal(uiScaleClamp(50), 80);
  assert.equal(uiScaleClamp(101.6), 102);
  assert.equal(getUiScale(), 100);
  assert.equal(uiScaleFillPct(80), '0.0');
  assert.equal(uiScaleFillPct(120), '100.0');
  assert.equal(setUiScale(110), 110);
  assert.equal(getUiScale(), 110);
  assert.equal(w.localStorage.getItem('sufe_ui_scale'), '110');
  assert.equal(document.documentElement.style.getPropertyValue('--ui-scale'), '1.100');
  setUiScale(100);
});

test('session 按角色保存/读取/清理，记住登录写 localStorage', () => {
  wipeSession();
  state.user = { id: 'u1', role: 'student', name: '小明' };
  state.authToken = 'TOK_A';
  saveSession(true);
  assert.ok(w.localStorage.getItem('sufe_session_student'));
  assert.ok(w.sessionStorage.getItem('sufe_session_student'));
  assert.equal(w.localStorage.getItem('sufe_last_role'), 'student');

  const loaded = loadSession('student');
  assert.equal(loaded.authToken, 'TOK_A');
  assert.equal(loaded.user.id, 'u1');
  assert.equal(loaded.source, 'local');

  clearSession('student');
  assert.equal(loadSession('student'), null);
  state.user = null;
  state.authToken = null;
  wipeSession();
});

test('loadSession 无角色时按 last_role 或遍历角色恢复', () => {
  wipeSession();
  state.user = { id: 't9', role: 'teacher', name: 'Teacher' };
  state.authToken = 'TOK_T';
  saveSession(false);
  const loaded = loadSession();
  assert.equal(loaded.authToken, 'TOK_T');
  assert.equal(loaded.user.role, 'teacher');
  assert.equal(loaded.source, 'session');
  state.user = null;
  state.authToken = null;
  wipeSession();
});

test('游客角色与最后页面偏好', () => {
  wipeSession();
  setLastGuestRole('teacher');
  assert.equal(getLastGuestRole(), 'teacher');
  setLastGuestRole('hacker');
  assert.equal(getLastGuestRole(), null);
  savePageState('client');
  assert.equal(getLastPage(), 'client');
});

test('设备 ID 生成 32 位 hex 并复用；其余偏好默认值', () => {
  wipeSession();
  const id = getDeviceId();
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(getDeviceId(), id);
  assert.equal(getThemePref(), 'system');
  storeThemePref('dark');
  assert.equal(getThemePref(), 'dark');
  assert.equal(getOrbPref(), 'vivid');
  setOrbPref('elegant');
  assert.equal(getOrbPref(), 'elegant');
  assert.equal(isReturning(), false);
  setReturning();
  assert.equal(isReturning(), true);
});

test('invalidate 同时清 state 域并通知 datahub 失效器', () => {
  wipeSession();
  const seen = [];
  setDatahubInvalidator(d => seen.push(d));
  state.myDemands = [{ id: 1 }];
  state.allTeachers = [{ id: 2 }];
  invalidate('demands');
  invalidate('teachers');
  assert.deepEqual(state.myDemands, []);
  assert.deepEqual(state.allTeachers, []);
  assert.deepEqual(seen, ['demands', 'teachers']);
  invalidate('unknown');
  assert.deepEqual(seen, ['demands', 'teachers']);
  setDatahubInvalidator(null);
});

test('logout reset 注册表去重、吞异常、逐个执行', () => {
  const out = [];
  const a = () => out.push('a');
  registerLogoutReset(a);
  registerLogoutReset(a);
  registerLogoutReset(() => { out.push('b'); throw new Error('x'); });
  registerLogoutReset('not-a-function');
  runLogoutResets();
  assert.deepEqual(out, ['a', 'b']);
  runLogoutResets();
  assert.deepEqual(out, ['a', 'b', 'a', 'b']);
});
