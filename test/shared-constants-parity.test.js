/**
 * V-1-1 共享常量同源校验：
 *   - vm 执行根 constants.js（经典脚本，保持前端加载结构不变）；
 *   - import src/shared/*，逐键/逐项 deep-equal；
 *   - MSG 每个 key 都有唯一 CODES code。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import * as config from '../src/shared/config.js';
import * as enums from '../src/shared/enums.js';
import * as codes from '../src/shared/codes.js';

const root = readFileSync('./constants.js', 'utf8');
const sandbox = vm.createContext({ console });
vm.runInContext(root, sandbox, { filename: 'constants.js' });
const AC = vm.runInContext('globalThis.APP_CONSTANTS', sandbox);
// vm 对象与 Node 对象原型不同：把 RegExp 归一为标记，再转普通对象做 deep-equal
const isReg = v => v != null && typeof v === 'object' && typeof v.source === 'string' && typeof v.flags === 'string';
const norm = v => isReg(v) ? { __regex: [v.source, v.flags] }
  : Array.isArray(v) ? v.map(norm)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
  : v;

test('CONFIG：根 constants.js 与 src/shared/config.js 逐键 deep-equal', () => {
  assert.equal(JSON.stringify(norm(config.CONFIG)), JSON.stringify(norm(AC.CONFIG)));
  assert.equal(config.INVITE_GATE_DORMANT, AC.INVITE_GATE_DORMANT, '前端门控休眠开关同源');
});

test('STATUS 与业务枚举：根 constants.js 与 src/shared/enums.js 逐项 deep-equal', () => {
  assert.equal(JSON.stringify(norm(enums.STATUS)), JSON.stringify(norm(AC.STATUS)));
  for (const key of ['SUBJECTS', 'STUDENT_GRADES', 'FIVE_FOUR_PROVINCES', 'TEACHER_GRADES', 'GENDERS',
    'TEACHING_METHODS', 'WEEKDAYS', 'PERSONALITY_TAGS', 'NONACADEMIC_PROJECTS', 'TEACHING_GOALS', 'DEMAND_TYPES']) {
    assert.equal(JSON.stringify(norm(enums[key])), JSON.stringify(norm(AC[key])), `${key} 同源`);
  }
});

test('CODES：每个 MSG key 都有唯一 code，且稳定 code 不被改值', () => {
  const keys = Object.keys(codes.MSG);
  const codeKeys = Object.keys(codes.CODES);
  // CHSI_UNVERIFIED 是动态资格码（acceptEligibility 的 reason 透传），不是 MSG 文案 key
  const dynamicCodes = ['CHSI_UNVERIFIED'];
  assert.ok(keys.every(k => codeKeys.includes(k)), '每个 MSG key 都有 CODES code');
  assert.deepEqual(new Set(codeKeys), new Set([...keys, ...dynamicCodes]), 'CODES = MSG 键 + 动态码 CHSI_UNVERIFIED');
  const vals = Object.values(codes.CODES);
  assert.equal(new Set(vals).size, vals.length, 'CODES 值唯一');
  for (const stable of ['OTP_EXHAUSTED', 'POST_NOT_FOUND', 'CONTRACT_MODIFIED_CONFLICT', 'PROFILE_INCOMPLETE', 'CHSI_UNVERIFIED']) {
    assert.equal(codes.CODES[stable], stable, `${stable} 保持稳定值`);
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
  assert.equal(codes.CODES.CHSI_UNVERIFIED, 'CHSI_UNVERIFIED', '动态 CHSI 资格码稳定');
});

test('NOTIFY_TYPES：全部为结构化通知类型契约', () => {
  assert.ok(codes.NOTIFY_TYPES.CONTRACT_SIGNED);
  assert.ok(codes.NOTIFY_TYPES.VERIFY_APPROVED);
});
