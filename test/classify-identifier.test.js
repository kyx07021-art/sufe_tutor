/**
 * v0.26.14 L1 登录页裸手机号验证码登录误拦修复——classifyIdentifier 判型回归：
 *
 * 背景（用户实证）：登录页先输用户名 → 改成纯数字手机号 → 点「验证码登录」→ 误报
 * 「用户名账户请使用密码登录」。根因 = 前端 toggleLoginMode 原判型 validatePhone 要求
 * +86 前缀（startsWith），而服务端 classifyIdentifier/normalizeIdentifier 认裸大陆号
 * （CN_MOBILE 自动补 +86）——口径不一致，纯数字手机号在前端被误判为 username。
 * 修复 = 前端判型收口 classifyIdentifier（app-otp.js，与服务端同语义），toggleLoginMode
 * 按 kind==='phone'/'email' 放行；用户名仍拦。
 *
 * 覆盖：裸大陆号→phone / 带+86→phone / 邮箱→email / 用户名→username / 空→null。
 * v0.26.15 收敛大陆单区：多地区前缀（+852/+659 等）用例随 PHONE_REGIONS 砍除。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const sandbox = { console, SUFE_DISPLAY: {} };
  vm.createContext(sandbox);
  // CONFIG/UI 顶层解构在 app-state.js（全局词法环境共享，后续脚本裸引 CONFIG.*/UI.*）——
  // 加载序与 index.html 一致：constants → app-state → app-otp
  for (const f of ['constants.js', 'app-state.js', 'app-otp.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const kind = (ctx, s) => vm.runInContext(`classifyIdentifier(${JSON.stringify(s)})`, ctx);

test('裸大陆手机号 → phone（v0.26.14 L1 修复点）', () => {
  const ctx = makeCtx();
  assert.equal(kind(ctx, '13800000000'), 'phone', '纯数字大陆号判为 phone（后端自动补 +86）');
  assert.equal(kind(ctx, '19912345678'), 'phone', '199 号段同判 phone');
});

test('带 +86 前缀手机号 → phone', () => {
  const ctx = makeCtx();
  assert.equal(kind(ctx, '+8613800000000'), 'phone');
});

test('邮箱 → email', () => {
  const ctx = makeCtx();
  assert.equal(kind(ctx, 'a@b.com'), 'email');
  assert.equal(kind(ctx, 'user.name+tag@example.co.jp'), 'email');
});

test('用户名 → username（验证码登录仍被正确拦截）', () => {
  const ctx = makeCtx();
  assert.equal(kind(ctx, 'qa_student'), 'username');
  assert.equal(kind(ctx, 'teacher1'), 'username');
  assert.equal(kind(ctx, '13800000000xx'), 'username', '非法号码不判 phone');
});

test('空输入 → null', () => {
  const ctx = makeCtx();
  assert.equal(kind(ctx, ''), null);
  assert.equal(kind(ctx, '   '), null);
});
