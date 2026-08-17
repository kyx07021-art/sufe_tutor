/**
 * v0.26.14 L1 登录页裸手机号验证码登录误拦修复——classifyIdentifier 判型回归。
 * B4：改为直接 import auth feature 的 actions-otp ESM 模块，不再 vm 加载经典脚本。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIdentifier } from '../src/client/features/auth/actions-otp.js';

test('裸大陆手机号 → phone（v0.26.14 L1 修复点）', () => {
  assert.equal(classifyIdentifier('13800000000'), 'phone', '纯数字大陆号判为 phone（后端自动补 +86）');
  assert.equal(classifyIdentifier('19912345678'), 'phone', '199 号段同判 phone');
});

test('带 +86 前缀手机号 → phone', () => {
  assert.equal(classifyIdentifier('+8613800000000'), 'phone');
});

test('邮箱 → email', () => {
  assert.equal(classifyIdentifier('a@b.com'), 'email');
  assert.equal(classifyIdentifier('user.name+tag@example.co.jp'), 'email');
});

test('用户名 → username（验证码登录仍被正确拦截）', () => {
  assert.equal(classifyIdentifier('qa_student'), 'username');
  assert.equal(classifyIdentifier('teacher1'), 'username');
  assert.equal(classifyIdentifier('13800000000xx'), 'username', '非法号码不判 phone');
});

test('空输入 → null', () => {
  assert.equal(classifyIdentifier(''), null);
  assert.equal(classifyIdentifier('   '), null);
});
