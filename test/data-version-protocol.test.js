/**
 * T-6-F7：跨栈数据版本域键协议锁（需求 T-4 耦合残留 M4）。
 *
 * GET /api/data-version 下发的域键集合（server/version.js DOMAINS + getVersions 默认 0 键）
 * 是前端缓存失效协议（datahub.js dhProbeTick → dhRefreshDomain(domain)）的共享键：
 * 服务端 bump 的每个域，前端必须有对应缓存域键，否则 dhRefreshDomain 找不到缓存条目，
 * 该域的跨端一致性更新静默失效（「数据库有更新 → 客户端静默拉一次」不成立）。
 * 本测试锁定「服务端域 ⊆ 前端缓存域键」，新增 bump 域未同步前端即红（G2 变异）。
 * 前端特有域豁免：'account'（纯认证/个人游标，服务端不 bump）、'misc'（dhGet 默认域）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function serverDomains() {
  const src = readFileSync('./server/version.js', 'utf8');
  const m = /const DOMAINS = \{([^}]*)\}/.exec(src);
  assert.ok(m, 'version.js DOMAINS 定义存在');
  return [...m[1].matchAll(/([A-Z_]+): '([a-z-]+)'/g)].map(x => x[2]);
}

function clientDomainKeys() {
  const src = readFileSync('./src/client/core/datahub.js', 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/\[('[^']*'),\s*'([a-z-]+)'\]/g)) keys.add(m[2]); // DH_PREFETCH 表项
  for (const m of src.matchAll(/domain:\s*'([a-z-]+)'/g)) keys.add(m[1]); // dhGet/dhBatchGet 显式域
  keys.add('misc'); // dhGet 默认域
  return keys;
}

test('T-6-F7 跨栈域键协议：服务端 bump 域 ⊆ 前端缓存域键（新增域须双侧同步）', () => {
  const sd = serverDomains();
  const cd = clientDomainKeys();
  assert.ok(sd.length >= 7, `服务端域 ≥7（${sd.join(',')}）`);
  // 服务端 7 域：demands/teachers/posts/contracts/chat/notifications/admin 必须全部前端可消费
  const missing = sd.filter(d => !cd.has(d));
  assert.deepEqual(missing, [],
    `服务端 bump 域必须在前端缓存域键集合中：缺 ${missing.join(',')} —— 新增域须同步 datahub.js DH_PREFETCH/dhGet（否则 dhRefreshDomain 静默失效）`);
  // 前端缓存域相对服务端域的增量只允许豁免域（account/misc）
  const extra = [...cd].filter(d => !sd.includes(d));
  assert.deepEqual(extra.filter(d => d !== 'account' && d !== 'misc'), [],
    `前端缓存域不得出现服务端协议外域（除 account/misc 豁免）：${extra.join(',')}`);
});
