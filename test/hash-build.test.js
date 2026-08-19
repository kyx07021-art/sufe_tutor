/**
 * #174（v0.25.76）：内容哈希资产管线（worker 侧虚拟版本化）自检
 *  - 已提交 manifest.js 与当前源码哈希一致（源文件改动后忘跑 node hash-assets.mjs → 第一例即红）
 *  - renderManifestV2 确定性：两次调用产物逐字节相同
 *  - worker 静态辅助：versionedBase 只放行 manifest 校验通过的版本化 URL；injectManifest 改写引用（零内联 manifest）
 * V-4-1h：v1 壳删除后 manifest 为纯 v2（CSS + web/ 脚本），renderManifest/DOMAIN_FILES 已删。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST } from '../manifest.js';
import { renderManifestV2 } from '../hash-assets.mjs';
import { versionedBase, injectManifest } from '../_worker.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

test('manifest.js 与源码哈希一致（源文件改动后必须重跑 node hash-assets.mjs）', () => {
  const committed = readFileSync(REPO + 'manifest.js', 'utf8');
  assert.equal(committed, renderManifestV2(), 'manifest.js 过期：commit 前先跑 node hash-assets.mjs');
});

test('renderManifestV2 确定性：两次调用产物逐字节相同', () => {
  assert.equal(renderManifestV2(), renderManifestV2(), '内容不变 → manifest 不变');
});

test('versionedBase：仅放行 manifest 校验通过的版本化 URL', () => {
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files)[0];
  assert.equal(versionedBase('/' + hashed), base, 'manifest 内哈希 URL → base 名');
  assert.equal(versionedBase('/' + base), null, 'base 名不放行（浏览器只应请求哈希名）');
  assert.equal(versionedBase('/app-chat.ffffffff.js'), null, '不在 manifest 的哈希 → 拒绝');
  assert.equal(versionedBase('/api/data-version'), null, 'API 路径不匹配');
});

test('injectManifest：改写资产引用为哈希名，零内联 manifest（v2 ESM 形态）', () => {
  const out = injectManifest('<head><link rel="stylesheet" href="/tokens.css"><script type="module" src="/assets/app.js"></script><script src="/theme-init.js"></script></head><body>');
  assert.ok(out.includes(`href="/${ASSET_MANIFEST.files['tokens.css']}"`), 'CSS 引用改哈希名');
  assert.ok(out.includes(`src="/${ASSET_MANIFEST.files['theme-init.js']}"`), 'web/ 脚本引用改哈希名');
  assert.ok(out.includes('src="/assets/app.js"'), 'esbuild 内容哈希区不改写（非 manifest 范畴）');
  assert.ok(!out.includes('window.ASSET_MANIFEST'), 'v2 零内联 manifest（严格 script-src 前提，V-3-1d 契约）');
  const img = injectManifest('<link rel="icon" href="/favicon.ico">');
  assert.ok(img.includes('href="/favicon.ico"'), '非 js/css 引用原样保留');
});

// V-4-1h h1：renderManifestV2 工具链能力（自足 fixture，用真实 web/index.html + 根/web 资产）
test('V-4-1h h1：renderManifestV2 覆盖 v2 资产（web/ 子目录解析 + /assets/ 过滤 + 零 v1 残留）', () => {
  const m = renderManifestV2();
  const files = JSON.parse(m.split('export const ASSET_MANIFEST = ')[1].replace(/;\s*$/, '')).files;
  // v2 资产全覆盖：根 CSS + features/ 子目录 + web/ 子目录脚本
  for (const want of ['tokens.css', 'base.css', 'glass.css', 'responsive.css',
    'features/chat.css', 'features/posts.css', 'features/region.css', 'theme-init.js', 'async-css.js']) {
    assert.ok(files[want], `manifest 含 ${want}`);
    assert.match(files[want], /^[A-Za-z0-9_\/-]+\.([0-9a-f]{8})\.(js|css)$/, `${want} 哈希名格式`);
  }
  // 零 v1 壳资产（v2 源模式零 DOMAIN_FILES）
  assert.ok(!Object.keys(files).some(k => k.startsWith('app-') || ['constants.js', 'region-data.js', 'style-pref.js', 'ui-scale-reflow.js'].includes(k)),
    '零 v1 壳资产');
  // 零 /assets/ 引用（esbuild 内容哈希直服区，非 manifest 范畴）
  assert.ok(!Object.keys(files).some(k => k.startsWith('assets/')), '零 /assets/ 引用');
  // 确定性
  assert.equal(renderManifestV2(), renderManifestV2(), 'v2 模式确定性');
});
