#!/usr/bin/env node
/**
 * 新站薄构建层：源码 → dist/（唯一部署对象）
 *   - Vite 构建 new-frontend（Vue 3 + Vite：内容哈希资产 + 严格 meta CSP 注入，
 *     见 new-frontend/vite.config.js）→ 拷贝 index.html + assets/*；
 *   - esbuild 把 _worker.js 连同 server/ 打成单文件 dist/_worker.js；
 *   - _headers（静态层安全头 + /assets/* immutable）复制进 dist；
 *   - v2 内容哈希管线（hash-assets.mjs → manifest.js → worker 改写引用）已删除（S0-24 + S0-22）：
 *     Vite 原生内容哈希 + _headers /assets/* immutable 已覆盖其职责；manifest.js 与 _worker.js
 *     的 injectManifest/versionedBase 引用已随 S0-22 一并移除（HTML 原样透传，worker 零改写）。
 *   - server/、docs/、test/、node_modules 等源码不再上传（部署对象固定 dist）。
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const NEW_FRONTEND = join(ROOT, 'new-frontend');

// 1) Vite 构建新前端（内容哈希资产 + meta CSP 注入，见 new-frontend/vite.config.js）
const viteBin = join(NEW_FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawnSync(process.execPath, [viteBin, 'build'], { cwd: NEW_FRONTEND, stdio: 'inherit' });
if (vite.error) {
  console.error(`build failed: 无法运行 Vite（${vite.error.message}）——new-frontend 依赖是否已安装？`);
  process.exit(1);
}
if (vite.status !== 0) {
  console.error(`build failed: vite build 退出码 ${vite.status}`);
  process.exit(vite.status ?? 1);
}

// 2) 组装最小可部署 dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
const nfDist = join(NEW_FRONTEND, 'dist');
for (const e of readdirSync(nfDist)) cpSync(join(nfDist, e), join(DIST, e), { recursive: true });

// 3) 后端 worker 单文件 bundle（_worker.js 编排层 + server/ 全量内联）
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

// 4) 静态层响应头（/* 安全头 + /assets/* immutable，见 _headers）
cpSync(join(ROOT, '_headers'), join(DIST, '_headers'));

// 5) 构建自检
//   a. dist/_worker.js 必须是 esbuild 完整 bundle（历史事故：早前版本曾正则归一化把 420KB bundle 截成 129 字节）。
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

//   b. Vite 产物检查：index.html 的 /assets/ 绝对资产引用齐全（base:'/'）；dist/assets/* 全为
//      Vite 内容哈希名（_headers /assets/* immutable 前提；非内容寻址文件被设 immutable 会 stale 一年）。
//      Vite 内容哈希名 = [name]-[8 位 base64url 哈希].ext（如 index-CW2XfQw1.js / gallery-4-b-ZihcSF.png）。
const htmlPath = join(DIST, 'index.html');
if (!existsSync(htmlPath)) {
  console.error('build check failed: dist/index.html 缺失（Vite 产物异常）');
  process.exit(1);
}
const html = readFileSync(htmlPath, 'utf8');
// base:'/' (PA-2-F14): absolute /assets/* refs so a deep-link SPA fallback still
// resolves from the site root. Refs must be absolute-rooted, not './relative'
// (which would resolve against the deep path and 404).
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => /^\/assets\//.test(r));
if (!refs.length) {
  console.error('build check failed: dist/index.html 零 /assets/ 绝对资产引用（非 Vite SPA 形态）');
  process.exit(1);
}
for (const r of refs) {
  const rel = r.replace(/^\/assets\//, 'assets/').replace(/[?#].*$/, '');
  if (!existsSync(join(DIST, rel))) {
    console.error(`build check failed: dist/index.html 引用 ${r} 在 dist 不存在`);
    process.exit(1);
  }
}
if (/(?:src|href)="\.\//.test(html)) {
  console.error('build check failed: dist/index.html 残留相对 ./asset 引用（base 应为 \'/\'）');
  process.exit(1);
}
const assetsDir = join(DIST, 'assets');
if (!existsSync(assetsDir)) {
  console.error('build check failed: dist/assets 缺失（Vite 产物异常）');
  process.exit(1);
}
const viteAsset = /^(.*)-([A-Za-z0-9_-]{8})\.[A-Za-z0-9]+$/;
function checkAsset(f, dir) {
  const abs = join(dir, f);
  if (statSync(abs).isDirectory()) {
    for (const sub of readdirSync(abs)) checkAsset(sub, abs);
    return;
  }
  if (!viteAsset.test(f)) {
    console.error(`build check failed: ${join(dir, f)} 不是 Vite 内容哈希名（/assets/* immutable 不安全）`);
    process.exit(1);
  }
}
for (const f of readdirSync(assetsDir)) checkAsset(f, assetsDir);

console.log('dist ready');
