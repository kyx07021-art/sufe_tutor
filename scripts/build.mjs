#!/usr/bin/env node
/**
 * v2 薄构建层：源码 → dist/（唯一部署对象）
 *   - esbuild 把 _worker.js 连同 server/、manifest.js 打成单文件 dist/_worker.js；
 *   - 静态资源（index.html/js/css/图片/_headers）复制进 dist；
 *   - server/、docs/、test/、node_modules 等源码不再上传，黑名单逻辑将在后续架构迁移中删除。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const COPY_EXTS = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);
const COPY_NAMES = new Set(['_headers', '_b2_home.png', 'hand-mask.png', 'hand-mask-rot.png', '创造亚当手部剪影.jpg']);

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
const v2 = readFileSync(join(ROOT, 'web/index.html'), 'utf8').replace('/assets/app.js', `/assets/${appName}`);
writeFileSync(join(DIST, 'v2.html'), v2);

// v1 static shell (unchanged production behavior).
for (const name of readdirSync(ROOT)) {
  if (name === '_worker.js' || name === 'manifest.js' || name === 'hash-assets.mjs') continue; // 构建产物已由 esbuild 落 dist，根源码不得回填覆盖
  if (COPY_NAMES.has(name) || (statSync(join(ROOT, name)).isFile() && COPY_EXTS.has(name.slice(name.lastIndexOf('.'))))) {
    cpSync(join(ROOT, name), join(DIST, name));
  }
}
cpSync(join(ROOT, 'web/theme-init.js'), join(DIST, 'theme-init.js'));
// V-2-5b CSS 重组：features/*.css 目录资产（根文件循环只拷根级文件）
cpSync(join(ROOT, 'features'), join(DIST, 'features'), { recursive: true });

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

console.log('dist ready');
