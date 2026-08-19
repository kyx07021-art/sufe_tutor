#!/usr/bin/env node
/**
 * v2 薄构建层：源码 → dist/（唯一部署对象）
 *   - esbuild 把 _worker.js 连同 server/、manifest.js 打成单文件 dist/_worker.js；
 *   - 静态资源（index.html/js/css/图片/_headers）复制进 dist；
 *   - server/、docs/、test/、node_modules 等源码不再上传，黑名单逻辑将在后续架构迁移中删除。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const COPY_NAMES = new Set(['_headers', 'hand-mask.png', 'hand-mask-rot.png']); // 非内容哈希资产（站点头/静态图，CSS 静态引用）手动清单

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(ROOT, '_worker.js')],
  outfile: join(DIST, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// Client chunks: esbuild code splitting (feature dynamic imports will join later batches).
const client = await build({
  entryPoints: [join(ROOT, 'src/client/app.js')],
  outdir: join(DIST, 'assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  entryNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  metafile: true,
  logLevel: 'info',
});
const entry = Object.keys(client.metafile.outputs).find(f => f.endsWith('.js') && readFileSync(f, 'utf8').includes('v2 client entry'));
const appName = entry ? entry.split(/[\/]/).pop() : readdirSync(join(DIST, 'assets')).find(f => f.startsWith('app-') && f.endsWith('.js'));
// V-4-1h h2h3：v2 页面直接作为站点入口 index.html（v1 壳已删，/ 承重；原 v2.html 过渡路径下线）
const v2 = readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('/assets/app.js', `/assets/${appName}`);
writeFileSync(join(DIST, 'index.html'), v2);

// Z-12-F3：静态资产按 manifest.js 复制（hash-assets 自动生成的完整清单，杜绝手动清单漂移——
// 新增资产只改源码 + 重跑 hash-assets，build 零维护）。源位置按清单键自动解析：根级 / web/ / features/。
// 清单列出却定位不到源码 = 构建失败（fail-fast，防发陈旧前端）。
const { ASSET_MANIFEST } = await import(pathToFileURL(join(ROOT, 'manifest.js')).href);
for (const base of Object.keys(ASSET_MANIFEST.files)) {
  const src = existsSync(join(ROOT, base)) ? join(ROOT, base)
    : existsSync(join(ROOT, 'web', base)) ? join(ROOT, 'web', base)
    : null;
  if (!src) { console.error(`build failed: manifest 资产 ${base} 源码缺失（hash-assets 后须能定位）`); process.exit(1); }
  const dest = join(DIST, base);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}
// 非内容哈希资产（站点头 _headers / 静态图）手动清单
for (const name of COPY_NAMES) cpSync(join(ROOT, name), join(DIST, name));

// 部署自检：dist/_worker.js 必须是 esbuild 完整 bundle，且构建脚本绝不改写 esbuild 产物内容。
// 失败历史：早前版本曾正则归一化 default export 并回写文件，把 420KB bundle 截成 129 字节。
const workerPath = join(DIST, '_worker.js');
const workerBytes = statSync(workerPath).size;
if (workerBytes < 100000) {
  console.error(`build check failed: dist/_worker.js is only ${workerBytes} bytes (expected esbuild bundle > 100000 bytes)`);
  process.exit(1);
}
const workerCheck = readFileSync(workerPath, 'utf8');
for (const bad of ['from "./server/', 'from "./src/', "from './server/", "from './src/"]) {
  if (workerCheck.includes(bad)) {
    console.error(`build check failed: dist/_worker.js contains source-relative import ${bad}`);
    process.exit(1);
  }
}
// 实测可导入：Node 真实解析并执行 esbuild 产物，证明文件未被截断。
// default export 必须是对象或函数（Cloudflare Worker 的 fetch/scheduled handler 对象）。
try {
  const mod = await import(pathToFileURL(workerPath).href);
  if (typeof mod.default !== 'object' && typeof mod.default !== 'function') {
    console.error('build check failed: dist/_worker.js default export is neither object nor function');
    process.exit(1);
  }
} catch (err) {
  console.error('build check failed: dist/_worker.js cannot be imported by Node:', err && err.message);
  process.exit(1);
}
// V-4-1e 审计 F3 闸门：dist/assets/* 必须全为 esbuild 内容哈希名（_headers /assets/* immutable 的前提；
// 非内容寻址文件被设 immutable 会 stale 一年）。esbuild 哈希 = [name]-[8 位 base62]。
for (const f of readdirSync(join(DIST, 'assets'))) {
  if (!/^[A-Za-z0-9_-]+-[A-Za-z0-9]{8}\.js$/.test(f)) {
    console.error(`build check failed: dist/assets/${f} 不是 esbuild 内容哈希名（/assets/* immutable 不安全）`);
    process.exit(1);
  }
}

console.log('dist ready');
