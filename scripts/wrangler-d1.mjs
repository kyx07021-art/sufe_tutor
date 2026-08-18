/**
 * wrangler D1 远程执行共享层（V-4-1c 抽取；validate-prod-data 与 d1-migration-drill 共用，防相似组件重复）。
 * 零 shell：wrangler 全局 JS bin 经 process.execPath 直跑（Windows .cmd EINVAL 绕开、无注入面）。
 * 本网络对 Cloudflare API 有偶发抖动（fetch failed 实测命中）→ runWrangler 内建 3 次重试（全新子进程，无状态残留）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RETRIES = 3;
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// 全局 wrangler 常见安装路径（Windows %APPDATA%\npm\node_modules；POSIX /usr/lib 或 /usr/local/lib）
export function resolveWranglerBin() {
  const candidates = process.platform === 'win32' && process.env.APPDATA
    ? [join(process.env.APPDATA, 'npm', 'node_modules', 'wrangler', 'bin', 'wrangler.js')]
    : ['/usr/lib/node_modules/wrangler/bin/wrangler.js', '/usr/local/lib/node_modules/wrangler/bin/wrangler.js'];
  return candidates.find(existsSync) || null;
}

const WRANGLER_BIN = resolveWranglerBin();

/** 执行 wrangler 命令（参数数组），3 次重试后仍失败则抛最后一次错误 */
export function runWrangler(cmd, { encoding = 'utf8', maxBuffer = 20 * 1024 * 1024 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (WRANGLER_BIN) return execFileSync(process.execPath, [WRANGLER_BIN, ...cmd], { encoding, maxBuffer });
      // 兜底：全局 bin 不在常见路径时走 npx（Windows 需 shell 解析 .cmd）。
      // 全部参数为常量字面量且经 fail-closed 字符校验，无注入面（DEP0190 仅兜底路径触发）。
      for (const a of cmd) {
        if (/["%!^`]/.test(a)) throw new Error(`runWrangler 拒绝含 shell 特殊字符的参数（fail-closed）：${a}`);
      }
      return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...cmd],
        { encoding, maxBuffer, shell: process.platform === 'win32' });
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      const waitMs = 2000 * attempt;
      console.log(`  ↻ wrangler 重试 ${attempt}/${RETRIES - 1}（${String(e.message).split('\n')[0].slice(0, 70)}… ${waitMs}ms 后）`);
      sleepSync(waitMs);
    }
  }
}

/**
 * D1 远程只读查询：断言 wrangler meta changed_db=false 且 changes=0（语义级只读闸门；
 * PRAGMA 的 rows_written 报告偶不稳定，不以其为准），返回行数组。
 */
export function d1ReadQuery(dbName, sql) {
  const out = runWrangler(['d1', 'execute', dbName, '--remote', '--json', '--command', sql]);
  const { results, meta } = JSON.parse(out)[0]; // wrangler 结构：[{ results, success, meta }]，只读字段在 meta 子对象
  if (meta.changed_db !== false || meta.changes !== 0) {
    throw new Error(`非只读查询！changed_db=${meta.changed_db} changes=${meta.changes}: ${sql}`);
  }
  return (results || []).map(r => ({ ...r }));
}

/** D1 远程导出（schema + 数据）到本地 SQL 文件（副本演练/备份用；写本地文件非生产库） */
export function d1Export(dbName, outputPath) {
  runWrangler(['d1', 'export', dbName, '--remote', '--output', outputPath, '--skip-confirmation'],
    { maxBuffer: 100 * 1024 * 1024 });
}
