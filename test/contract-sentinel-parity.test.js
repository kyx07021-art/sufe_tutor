/**
 * T-6-F6：合同业务条款哨兵跨栈 parity 锁（需求 T-4 耦合残留 M3）。
 *
 * 前端 contract/render.js 的 split/strip（:21/:25）依赖「前端前缀 CONTRACT_BIZ_END
 * ⊆ 服务端全句 CONTRACT_BUSINESS_END」的隐含前缀关系。两端是双源字面量且此前零
 * parity 测试——服务端改哨兵措辞（如「业务条款结束」→「商业条款结束」）会让前端
 * split/strip 静默失效（合同正文解析断线且无红例拦截）。本测试锁定该前缀关系：
 * 改动任一端哨兵措辞，startsWith 断言即红，必须同步另一端（G2：变异即红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('T-6-F6 合同哨兵跨栈 parity：前端前缀 ⊆ 服务端全句（防静默失配断线）', () => {
  const clientSrc = readFileSync('./src/client/constants/text.js', 'utf8');
  const serverSrc = readFileSync('./src/server/domains/contract/api.js', 'utf8');
  const clientMarker = /"CONTRACT_BIZ_END":\s*"([^"]*)"/.exec(clientSrc)?.[1];
  const serverMarker = /CONTRACT_BUSINESS_END = '([^']*)'/.exec(serverSrc)?.[1];
  assert.ok(clientMarker, '前端 CONTRACT_BIZ_END 定义存在（text.js）');
  assert.ok(serverMarker, '服务端 CONTRACT_BUSINESS_END 定义存在（contract/api.js）');
  assert.ok(
    serverMarker.startsWith(clientMarker),
    `服务端全句必须以客户端前缀开头（前端 split/strip 依赖此前缀关系）——前端 "${clientMarker}" 服务端 "${serverMarker}"。改动哨兵措辞必须同步两端。`
  );
});
