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
    AbortController, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
  vm.createContext(sandbox);
  // A1 审计（v0.25.104）：载入 app-api 以覆盖 401 兜底（旧令牌在途 401 误清新角色会话的回归）
  for (const f of ['constants.js', 'app-state.js', 'app-api.js']) {
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

test('loadSession 无角色参数：按 sufe_last_role 恢复（v0.24.1 后由主页角色按钮触发）', () => {
  const ctx = makeCtx();
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 't'; saveSession(false);`, ctx);
  const s = vm.runInContext(`loadSession()`, ctx);
  assert.equal(s && s.authToken, 't', '应恢复上次使用角色（teacher）的会话');
});

test('clearSession 无角色参数 = 空操作（v0.24.2 审计：不误删他角色会话）', () => {
  const ctx = makeCtx();
  vm.runInContext(`state.user = { id: 1, role: 'student' }; state.authToken = 'a'; saveSession(true);`, ctx);
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 'b'; saveSession(true);`, ctx);
  vm.runInContext(`clearSession()`, ctx); // 401 兜底在角色切换（state.user 为空）曾以 '' 走此路径
  assert.equal(vm.runInContext(`loadSession('student')`, ctx).authToken, 'a', '学生记住会话应保留');
  assert.equal(vm.runInContext(`loadSession('teacher')`, ctx).authToken, 'b', '教师记住会话应保留');
  vm.runInContext(`clearSession('student')`, ctx); // 显式清角色仍正常工作
  assert.equal(vm.runInContext(`loadSession('student')`, ctx), null, '显式角色清理应生效');
  assert.equal(vm.runInContext(`loadSession('teacher')`, ctx).authToken, 'b', '他角色不受影响');
});

test('A1 审计：401 兜底按发起时刻令牌校验——旧令牌在途 401 不清新角色会话（B2 跨角色误删根因）', async () => {
  const ctx = makeCtx();
  // 预置学生记住会话（旧角色在盘）
  vm.runInContext(`state.user = { id: 1, role: 'student' }; state.authToken = 'stu-token'; saveSession(true);`, ctx);
  // 在途请求：以旧令牌（stu-token）发起，fetch 挂起等测试放行
  let release;
  ctx.fetch = async () => new Promise(res => { release = () => res({ ok: false, status: 401, json: async () => ({ error: '会话过期' }) }); });
  const p = vm.runInContext(`state.user = { id: 1, role: 'student' }; state.authToken = 'stu-token'; api('/api/slow');`, ctx);
  // 期间用户登出旧角色、登录新角色（新令牌 + 教师会话落盘）
  vm.runInContext(`state.user = { id: 2, role: 'teacher' }; state.authToken = 'new-token'; saveSession(true); state.view = 'client';`, ctx);
  // 旧请求此刻才落回 401 —— 兜底必须识别「非当前令牌」，只作废自己
  release();
  await assert.rejects(p, /会话过期/, '401 仍抛业务错误（调用方照常 catch）');
  assert.equal(vm.runInContext(`loadSession('teacher')`, ctx).authToken, 'new-token', '新角色教师会话未被误删');
  assert.equal(vm.runInContext(`loadSession('student')`, ctx).authToken, 'stu-token', '旧角色学生记住会话仍在（401 只作废自己）');
  assert.equal(vm.runInContext('state.authToken', ctx), 'new-token', '当前令牌未被旧请求作废');
  assert.equal(vm.runInContext('state.user.role', ctx), 'teacher', '当前登录态未被旧请求清空');
});
