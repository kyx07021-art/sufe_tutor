#!/usr/bin/env node
/**
 * 薄构建层：源码 → dist/（唯一部署对象）
 *   - esbuild 把 _worker.js 连同 src/server/ 打成单文件 dist/_worker.js；
 *   - esbuild 打包旧客户端（src/client/app.js，code splitting → dist/assets/ 内容哈希名）；
 *   - web/index.html 的 /assets/app.js 引用替换为实际入口 chunk 名，写入 dist/index.html；
 *   - 根静态资产（CSS/图片/_headers）+ web/theme-init.js + web/async-css.js + features/ 复制进 dist；
 *   - server/、docs/、test/、node_modules 等源码不上传（部署对象固定 dist）。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

// 根级静态资产扩展名/白名单（esbuild 输出与 web/ 子目录资产单独处理）
const COPY_EXTS = new Set(['.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);
const COPY_NAMES = new Set(['_headers']);

// 1) 后端 worker 单文件 bundle（_worker.js 编排层 + src/server/ 全量内联）
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

await build({
  entryPoints: [join(ROOT, '_worker.js')],
  outfile: join(DIST, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2018',
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

// 2) 客户端 chunk（src/client/app.js 入口，code splitting 内容哈希命名）
const client = await build({
  entryPoints: [join(ROOT, 'src/client/app.js')],
  outdir: join(DIST, 'assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'none',
  minify: false,
  sourcemap: false,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  logLevel: 'info',
});

// 3) HTML 壳：web/index.html 的 /assets/app.js 引用 → 实际入口 chunk 名
const entry = Object.keys(client.metafile.outputs)
  .find(f => f.endsWith('.js') && readFileSync(f, 'utf8').includes('v2 client entry'));
const appName = entry ? entry.split(/[\/]/).pop() : readdirSync(join(DIST, 'assets')).find(f => f.startsWith('app-') && f.endsWith('.js'));
const html = readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('/assets/app.js', `/assets/${appName}`);
writeFileSync(join(DIST, 'index.html'), html);

// 4) 根级静态资产 + web/ 壳脚本 + features/ 域样式
for (const name of readdirSync(ROOT)) {
  if (name === '_worker.js') continue;
  if (COPY_NAMES.has(name) || (statSync(join(ROOT, name)).isFile() && COPY_EXTS.has(name.slice(name.lastIndexOf('.'))))) {
    cpSync(join(ROOT, name), join(DIST, name));
  }
}
cpSync(join(ROOT, 'web/theme-init.js'), join(DIST, 'theme-init.js'));
cpSync(join(ROOT, 'web/async-css.js'), join(DIST, 'async-css.js'));
cpSync(join(ROOT, 'features'), join(DIST, 'features'), { recursive: true });

// 5) 构建自检
// a. dist/_worker.js 必须是 esbuild 完整 bundle（历史事故：正则归一化曾把 bundle 截成 129 字节）
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
// b. 实测可导入：Node 真实解析并执行 esbuild 产物，证明文件未被截断。
//    default export 必须是对象或函数（Cloudflare Worker 的 fetch/scheduled handler 对象）。
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
// c. dist/assets/* 必须全为 esbuild 内容哈希名（_headers /assets/* immutable 的前提；
//    非内容寻址文件被设 immutable 会 stale 一年）
for (const f of readdirSync(join(DIST, 'assets'))) {
  if (!/^[A-Za-z0-9_-]+-[A-Za-z0-9]{8}\.js$/.test(f)) {
    console.error(`build check failed: dist/assets/${f} 不是 esbuild 内容哈希名（/assets/* immutable 不安全）`);
    process.exit(1);
  }
}
// d. dist/index.html 存在且引用的 /assets/ 资产齐全
const indexHtml = join(DIST, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('build check failed: dist/index.html 缺失');
  process.exit(1);
}
const htmlOut = readFileSync(indexHtml, 'utf8');
const refs = [...htmlOut.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => r.startsWith('/assets/'));
for (const r of refs) {
  if (!existsSync(join(DIST, r.replace(/^\/assets\//, 'assets/')))) {
    console.error(`build check failed: dist/index.html 引用 ${r} 在 dist 不存在`);
    process.exit(1);
  }
}

console.log('dist ready');
