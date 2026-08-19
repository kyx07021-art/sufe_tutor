#!/usr/bin/env node
/**
 * 内容哈希资产管线（worker 侧虚拟版本化）
 *
 * 在 push 前运行（commit 纪律：改完代码先 node hash-assets.mjs 再 commit）：
 * 对 web/index.html 引用的全部 js/css 算内容哈希，生成 manifest.js
 * （ES module：base 名 → 哈希名）。worker 据此：
 *   - 改写 HTML 里的资产引用为哈希名（浏览器只请求哈希 URL）
 *   - 版本化 URL（/base.<hash8>.ext）路由到 base 文件并回 immutable 缓存头
 *
 * V-4-1h：v1 壳删除后唯一 HTML 形态为 v2 ESM 页（web/index.html → dist/index.html），
 *   - web/ 子目录资产（theme-init.js / async-css.js）按 web/<base> 解析；
 *   - 过滤 /assets/ 引用（esbuild 内容哈希直服区，非 manifest 范畴，_headers 已设 immutable）；
 *   - 零 DOMAIN_FILES（v1 懒加载概念已删，v2 全静态 import）。
 *
 * 设计（对比"提交哈希副本"方案）：
 *   - 源码/测试零污染：web/index.html 保持 base 名，manifest.js 是唯一产物；测试继续读源码文件
 *   - immutable 只加在 manifest 校验通过的版本化 URL 上（worker 逐请求核对），base 名永不 immutable
 *   - 内容变 → 哈希变 → 新 URL；index.html no-cache 每载取新 → 零陈旧
 *   - 失忆防线：test/hash-build.test.js 校验已提交 manifest 与当前源码哈希一致，
 *     忘跑本脚本 → 测试即红。提交前的 commit 步骤必须包含 node hash-assets.mjs。
 *
 * 用法：node hash-assets.mjs [输出路径]（默认 manifest.js）
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HASH_LEN = 8;

const hash = s => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, HASH_LEN);
// 行尾归一化：autocrlf=true 的 Windows 检出会把 LF 转 CRLF，直接哈希原始字节
// 会让 CRLF 环境生成与 LF 环境不同的哈希 → 红线测试在 CRLF 检出下误报「manifest 过期」。
// 哈希前统一归一化为 LF（git 库内即 LF），跨环境确定性；LF 环境下归一化是 no-op，哈希不变。
const normLf = s => s.replace(/\r\n/g, '\n');

/** 纯函数：读 web/index.html 提取资产引用 → 返回 manifest.js 完整内容（测试据此校验 manifest 是否过期） */
export function renderManifestV2() {
  const html = normLf(readFileSync('web/index.html', 'utf8'));
  const refs = [...new Set([...html.matchAll(/(?:src|href)="\/([a-zA-Z0-9._\/-]+\.(?:js|css))"/g)].map(m => m[1]))]
    .filter(base => !base.startsWith('assets/'));
  const files = {};
  for (const base of refs) {
    const srcPath = existsSync(base) ? base : `web/${base}`;
    if (!existsSync(srcPath)) throw new Error(`hash-assets v2: 找不到资产 ${base}`);
    const h = hash(normLf(readFileSync(srcPath, 'utf8')));
    files[base] = base.replace(/\.(js|css)$/, `.${h}.$1`);
  }
  return `/**
 * 自动生成 —— 勿手改：node hash-assets.mjs 重新生成（push 前运行）。
 * v2 内容哈希资产清单（V-4-1h 起）：base 名 → 哈希名；worker 服务 HTML 时改写引用 + 版本化路由。
 */
export const ASSET_MANIFEST = ${JSON.stringify({ files }, null, 2)};
`;
}

// CLI 入口（被测试 import 时不执行）。v2 源模式（根 index.html 已删，v1 壳下线）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outPath = process.argv[2] || 'manifest.js';
  writeFileSync(outPath, renderManifestV2());
  console.log(`${outPath} generated`);
}
