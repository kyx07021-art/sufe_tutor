/**
 * Q-2g-F2 守护：域 schema DDL 零 localtime（库内 UTC 契约，规则 42）。
 * 审计 F2：域 DDL created_at/updated_at DEFAULT datetime('now','localtime') 违反「库内 UTC」——
 * 生产 Worker TZ=UTC 掩盖，非 UTC 环境（本地 dev）时间域陷阱（写入 UTC 读 localtime 差 8h）。
 * 修复：全站 schema DDL + 业务写入点 + 配套查询 localtime→UTC（rate_limits 窗口自洽域除外）。
 * 变异：任一 schema.js 的 created_at DEFAULT 加回 datetime('now','localtime') → 红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDirs = ['auth', 'chat', 'complaints', 'contract', 'demand', 'posts', 'reviews', 'settings', 'teacher', 'admin'];

test('Q-2g-F2：域 schema DDL 零 datetime(now,localtime)（库内 UTC 契约）', () => {
  const offenders = [];
  for (const d of schemaDirs) {
    const p = join(ROOT, 'src/server/domains', d, 'schema.js');
    const s = readFileSync(p, 'utf-8');
    if (s.includes('datetime(\'now\',\'localtime\')') || s.includes('date(\'now\',\'localtime\')')) {
      offenders.push(`${d}/schema.js`);
    }
  }
  assert.deepEqual(offenders, [], 'schema DDL 必须 UTC（变异：加回 localtime → 红）。违例: ' + offenders.join(', '));
});
