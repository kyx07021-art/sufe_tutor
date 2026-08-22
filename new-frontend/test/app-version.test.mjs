/**
 * app-version.test.mjs - frontend version single-source lock (PA-1i-F2)
 * ----------------------------------------------------------------------
 * The AboutModal version line must derive from exactly one source:
 * src/shared/config.js APP_VERSION (S0-01), injected into the frontend build
 * via the Vite define symbol __APP_VERSION__. Any hardcoded version literal in
 * the frontend (the v2-era '0.0.1' residue) must break this lock.
 *
 * Guards:
 *  - AboutModal.vue uses __APP_VERSION__ and carries no version literal (G2: a
 *    reverted `const APP_VERSION = '0.0.1'` turns test 1 red).
 *  - Both Vite configs inject __APP_VERSION__ from the shared import, not from a
 *    private literal (a reverted `JSON.stringify('0.0.1')` turns test 2 red).
 *  - A real production build embeds the shared version and no stale literal
 *    (a reverted hardcode turns test 3 red).
 *
 * Run: node --test test/app-version.test.mjs               (from new-frontend/)
 *      node --test new-frontend/test/app-version.test.mjs  (from repo root)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { APP_VERSION } from '../../src/shared/config.js'

const FRONT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const aboutSource = readFileSync(join(FRONT_ROOT, 'src/modules/notifications/AboutModal.vue'), 'utf8')

test('AboutModal has no hardcoded version literal and uses the injected __APP_VERSION__', () => {
  assert.match(aboutSource, /__APP_VERSION__/, 'AboutModal references the Vite define symbol')
  assert.ok(
    !/\d+\.\d+\.\d+/.test(aboutSource),
    'AboutModal must not contain a hardcoded version literal (e.g. the old 0.0.1)',
  )
})

test('Vite configs inject __APP_VERSION__ from the shared source (no private literal)', () => {
  for (const file of ['vite.config.js', 'vite.m5.config.js']) {
    const source = readFileSync(join(FRONT_ROOT, file), 'utf8')
    assert.match(
      source,
      /import\s*\{[^}]*APP_VERSION[^}]*\}\s*from\s*['"]\.\.\/src\/shared\/config\.js['"]/,
      `${file} imports APP_VERSION from the shared single source`,
    )
    assert.match(
      source,
      /define\s*:\s*\{[^}]*__APP_VERSION__\s*:\s*JSON\.stringify\s*\(\s*APP_VERSION\s*\)/,
      `${file} defines __APP_VERSION__ from APP_VERSION (not a private literal)`,
    )
    assert.ok(
      !/JSON\.stringify\s*\(\s*['"]\d+\.\d+\.\d+['"]\)/.test(source),
      `${file} must not define a hardcoded version literal`,
    )
  }
})

test('built bundle embeds the shared APP_VERSION and no stale literal', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'app-version-'))
  try {
    await build({
      root: FRONT_ROOT,
      configFile: join(FRONT_ROOT, 'vite.config.js'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, write: true },
    })
    const js = readdirSync(join(outDir, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
      .join('\n')
    assert.ok(
      js.includes(APP_VERSION),
      `built bundle contains APP_VERSION ${APP_VERSION} (AboutModal version line)`,
    )
    assert.ok(!js.includes('0.0.1'), 'built bundle must not contain the stale 0.0.1 literal')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
