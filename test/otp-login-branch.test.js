/**
 * v0.26.16 requestOtpCode 登录分支裸大陆号发码回归（B4：直接 import auth actions-otp）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { requestOtpCode } from '../src/client/features/auth/actions-otp.js';

function setup(identifierValue) {
  const calls = [];
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  dom.window.document.body.innerHTML = `<input id="login-identifier" value="${identifierValue}"><button id="login-send"></button><input id="login-code">`;
  globalThis.document = dom.window.document;
  const savedFetch = globalThis.fetch;
  const savedSetInterval = globalThis.setInterval;
  const savedClearInterval = globalThis.clearInterval;
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  globalThis.setInterval = () => 1; // avoid keeping event loop alive from bindCountdown
  globalThis.clearInterval = () => {};
  return { calls, restore: () => { globalThis.fetch = savedFetch; globalThis.setInterval = savedSetInterval; globalThis.clearInterval = savedClearInterval; delete globalThis.document; } };
}

test('裸大陆号发送验证码：target 补 +86 发码', async () => {
  const { calls, restore } = setup('13812345678');
  await requestOtpCode('login', 'sms');
  restore();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].opts.body).target, '+8613812345678');
});

test('带 +86 前缀：target 原样', async () => {
  const { calls, restore } = setup('+8613812345678');
  await requestOtpCode('login', 'sms');
  restore();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].opts.body).target, '+8613812345678');
});

test('用户名：不发 OTP 请求', async () => {
  const { calls, restore } = setup('qa_student');
  await requestOtpCode('login', 'sms');
  restore();
  assert.equal(calls.length, 0);
});

test('邮箱：channel=email 原样发码', async () => {
  const { calls, restore } = setup('stu@sufe.edu.cn');
  await requestOtpCode('login', 'sms');
  restore();
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.target, 'stu@sufe.edu.cn');
  assert.equal(body.channel, 'email');
});
