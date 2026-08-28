/**
 * + guard: getSecret single-source env read + trim semantics + fail-closed zero plaintext fallback + isProductionRuntime detection.
 * Mutations: getSecret loses trim -> pure-space returns ' ' (non-empty) -> red; getSecret adds a repo plaintext fallback for a real key -> red;
 * isProductionRuntime misjudges local/prod -> red. (startup.js re-adds local envSecret -> red is guarded by worker-release-gate.test.js, not this file.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSecret, isProductionRuntime } from '../src/server/core/secrets.js';

test('Q-2h-L1：getSecret trim 语义（纯空格视为未配置）', () => {
  assert.equal(getSecret({ KEY: '   ' }, 'KEY'), '', '纯空格 → 空串（trim 统一；变异：去 trim → 红）');
  assert.equal(getSecret({ KEY: 'abc' }, 'KEY'), 'abc', '正常值原样（trim 后）');
  assert.equal(getSecret({}, 'MISSING'), '', '缺 env → 空串 fail-closed');
  assert.equal(getSecret({ KEY: null }, 'KEY'), '', 'null → 空串');
});

test('S0-05：isProductionRuntime 判定（仅 CF_PAGES_* 生产信号为真）', () => {
  assert.equal(isProductionRuntime(null), false, 'null → 非生产');
  assert.equal(isProductionRuntime({}), false, '空 env → 非生产');
  assert.equal(isProductionRuntime({ LOG_ENCRYPT_KEY: 'x' }), false, '仅密钥无生产信号 ≠ 生产（本地/测试不受生产门槛约束）');
  assert.equal(isProductionRuntime({ CF_PAGES_URL: 'https://x.pages.dev' }), true, 'CF_PAGES_URL 生产信号 → 生产');
  assert.equal(isProductionRuntime({ CF_PAGES_COMMIT_SHA: 'abc123' }), true, 'CF_PAGES_COMMIT_SHA 生产信号 → 生产');
});

test('S0-05：零仓库明文回落（真实密钥键缺 env → 空串 fail-closed；变异：加仓库明文回落 → 红）', () => {
  assert.equal(getSecret({}, 'FIELD_ENC_KEY'), '', 'FIELD_ENC_KEY 缺 env → 空串（绝不回落仓库明文）');
  assert.equal(getSecret({}, 'LOG_ENCRYPT_KEY'), '', 'LOG_ENCRYPT_KEY 缺 env → 空串');
  assert.equal(getSecret({}, 'ADMIN_DEFAULT_PASSWORD'), '', '管理员口令缺 env → 空串');
  assert.equal(getSecret({}, 'TEXT_AUDIT_API_KEY'), '', '审核密钥缺 env → 空串');
});
