/**
 * Q-2h-L1 守护：getSecret env 读取单源 + trim 语义（startup.js 原 envSecret 本地副本已收敛）。
 * 变异：getSecret 去掉 trim → 纯空格返回 ' '（非空）→ 红；startup.js 加回本地 envSecret → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSecret } from '../server/secrets.js';

test('Q-2h-L1：getSecret trim 语义（纯空格视为未配置）', () => {
  assert.equal(getSecret({ KEY: '   ' }, 'KEY'), '', '纯空格 → 空串（trim 统一；变异：去 trim → 红）');
  assert.equal(getSecret({ KEY: 'abc' }, 'KEY'), 'abc', '正常值原样（trim 后）');
  assert.equal(getSecret({}, 'MISSING'), '', '缺 env → 空串 fail-closed');
  assert.equal(getSecret({ KEY: null }, 'KEY'), '', 'null → 空串');
});
