/**
 * V-1-1 共享常量自洽校验（B4：直接 import shared ESM，不再 vm 加载根 constants）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CONFIG, INVITE_GATE_DORMANT } from '../src/shared/config.js';
import { STATUS, SUBJECTS, STUDENT_GRADES, FIVE_FOUR_PROVINCES, TEACHER_GRADES, GENDERS, TEACHING_METHODS, WEEKDAYS, PERSONALITY_TAGS, NONACADEMIC_PROJECTS, TEACHING_GOALS, DEMAND_TYPES } from '../src/shared/enums.js';
import { MSG, CODES, NOTIFY_TYPES } from '../src/shared/codes.js';

test('CONFIG：核心常量在位且门控开关同源', () => {
  assert.ok(CONFIG.TOKEN_TTL_MS > 0);
  assert.ok(CONFIG.API_TIMEOUT_MS > 0);
  assert.ok(CONFIG.BATCH_GET_MAX > 0);
  assert.equal(INVITE_GATE_DORMANT, false, '前端门控休眠开关同源');
});

test('STATUS 与业务枚举：核心业务枚举全量在位', () => {
  assert.ok(STATUS.OPEN && STATUS.CONTRACTED && STATUS.REVOKED);
  for (const key of ['SUBJECTS', 'STUDENT_GRADES', 'FIVE_FOUR_PROVINCES', 'TEACHER_GRADES', 'GENDERS',
    'TEACHING_METHODS', 'WEEKDAYS', 'PERSONALITY_TAGS', 'NONACADEMIC_PROJECTS', 'TEACHING_GOALS', 'DEMAND_TYPES']) {
    assert.ok(key === 'DEMAND_TYPES' ? (typeof eval(key) === 'object' && eval(key) !== null) : Array.isArray(eval(key)), `${key} 为数组`);
  }
});

test('CODES：每个 MSG key 都有唯一 code，且稳定 code 不被改值', () => {
  const keys = Object.keys(MSG);
  const codeKeys = Object.keys(CODES);
  const dynamicCodes = ['CHSI_UNVERIFIED'];
  assert.ok(keys.every(k => codeKeys.includes(k)), '每个 MSG key 都有 CODES code');
  assert.deepEqual(new Set(codeKeys), new Set([...keys, ...dynamicCodes]), 'CODES = MSG 键 + 动态码 CHSI_UNVERIFIED');
  const vals = Object.values(CODES);
  assert.equal(new Set(vals).size, vals.length, 'CODES 值唯一');
  for (const stable of ['OTP_EXHAUSTED', 'POST_NOT_FOUND', 'CONTRACT_MODIFIED_CONFLICT', 'PROFILE_INCOMPLETE', 'CHSI_UNVERIFIED']) {
    assert.equal(CODES[stable], stable, `${stable} 保持稳定值`);
  }
});

test('服务端静态扫描：error(MSG. 与 8 处动态三元 error 调用已清零', () => {
  const files = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk('server');
  walk('src/server');
  files.push('_worker.js');
  const src = files.map(f => readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(src, /error\s*\(\s*MSG\./, '不得再出现 error(MSG. 直接调用');
  const oldTernary = [
    "error(recent ? MSG.OTP_RESEND_LIMIT",
    "error(otpChannel === 'email' ? MSG.EMAIL_ALREADY_BOUND",
    "error(otpR === 'exhausted' ? MSG.OTP_EXHAUSTED",
    "error(el.reason === 'CHSI_UNVERIFIED' ? MSG.CHSI_VERIFY_REQUIRED",
    "error(audit.layer === 'error' ? MSG.TEXT_AUDIT_UNAVAILABLE",
  ];
  for (const pattern of oldTernary) assert.ok(!src.includes(pattern), `8 处三元模式已清零：${pattern}`);
  assert.equal((src.match(/error\s*\([^)\n]*\?\s*MSG\./g) || []).length, 0, 'dynamic ternary error calls cleared');
  assert.equal(CODES.CHSI_UNVERIFIED, 'CHSI_UNVERIFIED', '动态 CHSI 资格码稳定');
});

test('NOTIFY_TYPES：全部为结构化通知类型契约', () => {
  assert.ok(NOTIFY_TYPES.CONTRACT_SIGNED);
  assert.ok(NOTIFY_TYPES.VERIFY_APPROVED);
});
