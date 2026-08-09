/**
 * #174（v0.25.76）：内容哈希资产管线（worker 侧虚拟版本化）自检
 *  - 已提交 manifest.js 与当前源码哈希一致（源文件改动后忘跑 node hash-assets.mjs → 第一例即红）
 *  - renderManifest 确定性：两次调用产物逐字节相同
 *  - worker 静态辅助：versionedBase 只放行 manifest 校验通过的版本化 URL；injectManifest 改写引用 + 内联 manifest
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST } from '../manifest.js';
import { renderManifest } from '../hash-assets.mjs';
import { versionedBase, injectManifest } from '../_worker.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

test('manifest.js 与源码哈希一致（源文件改动后必须重跑 node hash-assets.mjs）', () => {
  const committed = readFileSync(REPO + 'manifest.js', 'utf8');
  assert.equal(committed, renderManifest(), 'manifest.js 过期：commit 前先跑 node hash-assets.mjs');
});

test('renderManifest 确定性：两次调用产物逐字节相同', () => {
  assert.equal(renderManifest(), renderManifest(), '内容不变 → manifest 不变');
});

test('versionedBase：仅放行 manifest 校验通过的版本化 URL', () => {
  const [base, hashed] = Object.entries(ASSET_MANIFEST.files)[0];
  assert.equal(versionedBase('/' + hashed), base, 'manifest 内哈希 URL → base 名');
  assert.equal(versionedBase('/' + base), null, 'base 名不放行（浏览器只应请求哈希名）');
  assert.equal(versionedBase('/app-chat.ffffffff.js'), null, '不在 manifest 的哈希 → 拒绝');
  assert.equal(versionedBase('/api/data-version'), null, 'API 路径不匹配');
});

test('injectManifest：改写资产引用为哈希名 + 内联 manifest；非 js/css 不动', () => {
  const out = injectManifest('<head><link rel="stylesheet" href="/style.css"><script src="/constants.js"></script></head><body>');
  assert.ok(out.includes(`href="/${ASSET_MANIFEST.files['style.css']}"`), 'CSS 引用改哈希名');
  assert.ok(out.includes(`src="/${ASSET_MANIFEST.files['constants.js']}"`), 'JS 引用改哈希名');
  assert.ok(out.includes('window.ASSET_MANIFEST'), '内联 manifest 注入（懒加载器读取）');
  const img = injectManifest('<link rel="icon" href="/favicon.ico">');
  assert.ok(img.includes('href="/favicon.ico"'), '非 js/css 引用原样保留');
});
