/**
 * 按角色会话分键（v0.23.1 主页双按钮分流）回归
 *
 * 覆盖：
 *   - saveSession 按 state.user.role 落键：学生/教师会话互不覆盖
 *   - loadSession(role) 读指定角色；无角色参数按 sufe_last_role 恢复
 *   - clearSession(role) 只清该角色——另一角色会话保留（登出学生后教师会话仍可恢复）
 *
 * 沙箱：constants + app-state（in-memory localStorage/sessionStorage 桩）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  // localStorage 与 sessionStorage 须独立存储（浏览器语义：removeItem 互不影响）
  const makeStorage = () => {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k),
    };
  };
  const sandbox = {
    console,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    SUFE_DISPLAY: {},
  };
  vm.createContext(sandbox);
  for (const f of ['constants.js', 'app-state.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

test('按角色会话分键：学生/教师互不覆盖；清当前角色保留另一角色', () => {
  const ctx = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'student' }; state.authToken = 'stu-token'; saveSession(true);`, ctx);
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 'tea-token'; saveSession(true);`, ctx);
  const stu = vm.runInContext(`loadSession('student')`, ctx);
  const tea = vm.runInContext(`loadSession('teacher')`, ctx);
  assert.equal(stu && stu.authToken, 'stu-token', '学生会话应可单独读出');
  assert.equal(tea && tea.authToken, 'tea-token', '教师会话应可单独读出（不被学生覆盖）');
  vm.runInContext(`clearSession('student')`, ctx); // 登出学生
  assert.equal(vm.runInContext(`loadSession('student')`, ctx), null, '学生会话应被清');
  assert.equal(vm.runInContext(`loadSession('teacher')`, ctx).authToken, 'tea-token', '教师会话应保留');
});

test('loadSession 无角色参数：按 sufe_last_role 恢复（页面自动登录用）', () => {
  const ctx = makeCtx();
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 't'; saveSession(false);`, ctx);
  const s = vm.runInContext(`loadSession()`, ctx);
  assert.equal(s && s.authToken, 't', '应恢复上次使用角色（teacher）的会话');
});

test('clearSession 无角色参数 = 全清（含 last_role 标记）', () => {
  const ctx = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'student' }; state.authToken = 'a'; saveSession(true);`, ctx);
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 'b'; saveSession(true);`, ctx);
  vm.runInContext(`clearSession()`, ctx);
  assert.equal(vm.runInContext(`loadSession()`, ctx), null, '全清后任何角色都不应可恢复');
  assert.equal(vm.runInContext(`loadSession('teacher')`, ctx), null);
});
