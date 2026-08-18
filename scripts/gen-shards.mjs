/**
 * 测试分片生成器（V-4-1b）：把 test/*.test.js 均衡切成 SHARDS 个批次写入 .test-shards/batch_??。
 * 每行一个相对路径（run-shards.sh 用 tr '\n' ' ' 拼参）。连续字母序切块，确定性可复现。
 * 用法：node scripts/gen-shards.mjs [shards=4]
 * 背景：W-6 收口后新增测试文件未进分片 → 分片回归漏跑 5 文件/24 测试（V-4-1b 抓出），本脚本杜绝再漂移。
 */
import { readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARDS = Number(process.argv[2] || 4);
// 审计 F4：SHARDS 必须 1..99 正整数（0/负数/NaN 拒绝；>99 会让 batch_100+ 逃逸 run-shards 的 batch_?? glob 静默漏跑——F2）
if (!Number.isInteger(SHARDS) || SHARDS < 1 || SHARDS > 99) {
  throw new Error(`SHARDS 必须为 1..99 的整数（实 ${process.argv[2] || '(默认)'}）`);
}

const files = readdirSync(join(root, 'test')).filter(f => f.endsWith('.test.js')).sort();
if (!files.length) throw new Error('test/*.test.js 无匹配');
const per = Math.ceil(files.length / SHARDS);
const dir = join(root, '.test-shards');
mkdirSync(dir, { recursive: true });
// 审计 F1：再生成前清掉旧批次，防 SHARDS 减小后 batch_04.. 残留被 run-shards 捡起重复跑
for (const f of readdirSync(dir)) if (/^batch_[0-9]+$/.test(f)) rmSync(join(dir, f));
for (let i = 0; i < SHARDS; i++) {
  const chunk = files.slice(i * per, (i + 1) * per);
  if (!chunk.length) continue;
  writeFileSync(join(dir, `batch_${String(i).padStart(2, '0')}`), chunk.map(f => `test/${f}`).join('\n') + '\n');
}
console.log(`gen-shards: ${files.length} 文件 → ${SHARDS} 批（${per} 文件/批），.test-shards/batch_00..${String(SHARDS - 1).padStart(2, '0')}`);
