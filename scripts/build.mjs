#!/usr/bin/env node
/**
 * v2 薄构建层：源码 → dist/（唯一部署对象）
 *   - esbuild 把 _worker.js 连同 server/、manifest.js 打成单文件 dist/_worker.js；
 *   - 静态资源（index.html/js/css/图片/_headers）复制进 dist；
 *   - server/、docs/、test/、node_modules 等源码不再上传，黑名单逻辑将在后续架构迁移中删除。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

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

for (const name of readdirSync(ROOT)) {
  if (name === 'manifest.js' || name === 'hash-assets.mjs') continue; // 已打进 _worker.js 的构建中间产物
  if (COPY_NAMES.has(name) || (statSync(join(ROOT, name)).isFile() && COPY_EXTS.has(name.slice(name.lastIndexOf('.'))))) {
    cpSync(join(ROOT, name), join(DIST, name));
  }
}

console.log('dist ready');
