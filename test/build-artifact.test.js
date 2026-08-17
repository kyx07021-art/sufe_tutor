/**
 * Build artifact contract: dist/_worker.js must stay an intact esbuild bundle.
 * Guards the historical regression where a normalization step truncated the
 * bundle to 129 bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const workerPath = join(root, 'dist/_worker.js');

test('dist/_worker.js size > 100KB, no source-relative imports, bundle markers present', () => {
  if (!existsSync(workerPath)) return; // 源工作区允许未构建；已构建时必须满足契约
  const bytes = statSync(workerPath).size;
  assert.ok(bytes > 100000, `bundle must be > 100KB, got ${bytes}`);
  const src = readFileSync(workerPath, 'utf8');
  for (const bad of ['from "./server/', 'from "./src/', "from './server/", "from './src/"]) {
    assert.ok(!src.includes(bad), `must not contain ${bad}`);
  }
  assert.ok(src.includes('injectManifest') || src.includes('worker_default'), 'bundle markers missing');
});

test('esbuild write:false compiles _worker.js to a complete output file', async () => {
  const result = await build({
    entryPoints: [join(root, '_worker.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    minify: false,
    write: false,
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  assert.ok(out, 'esbuild output missing worker bundle');
  assert.ok(out.contents.byteLength > 100000, `esbuild output too small: ${out.contents.byteLength}`);
  assert.ok(out.text.includes('injectManifest') || out.text.includes('worker_default'));
});

test('dist/_worker.js is importable and default export is an object/function', async () => {
  if (!existsSync(workerPath)) return;
  const mod = await import(pathToFileURL(workerPath).href);
  assert.ok(typeof mod.default === 'object' || typeof mod.default === 'function', 'default export missing');
});
