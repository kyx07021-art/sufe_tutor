#!/usr/bin/env node
/**
 * 内容哈希资产管线（worker 侧虚拟版本化）
 *
 * 在 push 前运行（commit 纪律：改完代码先 node hash-assets.mjs 再 commit）：
 * 对全部 js/css（index.html 引用的 + DOMAIN_FILES 懒加载脚本）算内容哈希，生成 manifest.js
 * （ES module：base 名 → 哈希名）。worker 据此：
 *   - 改写 index.html 里的资产引用为哈希名 + 内联 manifest（浏览器只请求哈希 URL）
 *   - 版本化 URL（/app-chat.<hash8>.js）路由到 base 文件并回 immutable 缓存头
 *
 * 设计（对比"提交哈希副本"方案）：
 *   - 源码/测试零污染：index.html 保持 base 名，manifest.js 是唯一产物；测试继续读源码文件
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

// 与 app-shell.js DOMAIN_FILES 必须同步（懒加载脚本不在 index.html）
export const DOMAIN_FILES = [
  'region-data.js', 'app-style.js', 'app-region.js', 'app-posts.js', 'app-chat.js',
  'app-contracts.js', 'app-chart.js', 'app-admin.js', 'app-demands.js', 'app-teachers.js',
  'ui-scale-reflow.js', 'app-pages.js', 'app-complaints.js',
];

const hash = s => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, HASH_LEN);
// 行尾归一化：autocrlf=true 的 Windows 检出会把 LF 转 CRLF，直接哈希原始字节
// 会让 CRLF 环境生成与 LF 环境不同的哈希 → 红线测试在 CRLF 检出下误报「manifest 过期」。
// 哈希前统一归一化为 LF（git 库内即 LF），跨环境确定性；LF 环境下归一化是 no-op，哈希不变。
const normLf = s => s.replace(/\r\n/g, '\n');

/** 纯函数：读当前源码 → 返回 manifest.js 完整内容（测试据此校验已提交 manifest 是否过期） */
export function renderManifest() {
  // index.html 引用的 js/css（base 名；本脚本不改写 index.html，改写由 worker 服务时做）
  const html = normLf(readFileSync('index.html', 'utf8'));
  const refs = [...new Set([...html.matchAll(/(?:src|href)="\/([a-zA-Z0-9._\/-]+\.(?:js|css))"/g)].map(m => m[1]))];
  const all = [...new Set([...refs, ...DOMAIN_FILES])];

  const files = {};
  for (const base of all) {
    const src = normLf(readFileSync(base, 'utf8'));
    const h = hash(src);
    files[base] = base.replace(/\.(js|css)$/, `.${h}.$1`);
  }

  return `/**
 * 自动生成 —— 勿手改：node hash-assets.mjs 重新生成（push 前运行）。
 * 内容哈希资产清单：base 名 → 哈希名；worker 服务 index.html 时改写引用 + 版本化路由。
 */
export const ASSET_MANIFEST = ${JSON.stringify({ files }, null, 2)};
`;
}

/**
 * v2 壳源模式（V-4-1h h1）：读 web/index.html 提取资产引用——
 *  - web/ 子目录资产（theme-init.js / async-css.js）按 web/<base> 解析；
 *  - 过滤 /assets/ 引用（esbuild 内容哈希直服区，非 manifest 范畴，_headers 已设 immutable）；
 *  - 零 DOMAIN_FILES（v1 懒加载概念，v2 全静态 import）。
 *  h1 阶段仅新增能力、不切实际输入（CLI 仍走 renderManifest 读根 index.html），
 *  产物 manifest.js 不变、现有测试全绿；h2h3 才把 CLI 切到本模式。
 */
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

// CLI 入口（被测试 import 时不执行）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outPath = process.argv[2] || 'manifest.js';
  writeFileSync(outPath, renderManifest());
  console.log(`${outPath} generated`);
}
