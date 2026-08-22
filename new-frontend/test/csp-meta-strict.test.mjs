/**
 * csp-meta-strict.test.mjs - META_CSP single-source posture lock (S0-23)
 * ---------------------------------------------------------------------
 * Locks the new-frontend strict meta CSP constant (src/constants/csp.js) to
 * the three shared directives of the two HTTP-layer policies:
 *   - _headers (site-level static CSP, source 2)
 *   - src/shared/config.js SECURITY_HEADERS (worker /api CSP, source 3)
 * Verbatim, directive by directive. Any incremental relaxation — a default-src
 * prefix, an unsafe-inline source, an extra directive — must break the lock
 * (the old substring checks did not catch such relaxations).
 *
 * Also guards that the two Vite configs consume the constant instead of
 * carrying a private literal copy (single-source regression guard).
 *
 * Run: node --test test/csp-meta-strict.test.mjs  (from new-frontend/)
 *      node --test new-frontend/test/csp-meta-strict.test.mjs  (from repo root)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { META_CSP } from '../src/constants/csp.js'

const SHARED_DIRECTIVES = ['script-src', 'style-src-elem', 'style-src-attr']

function extractDirective(policy, name) {
  const part = policy
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.split(/\s+/)[0] === name)
  return part ? part.split(/\s+/).slice(1).join(' ') : null
}

/** First non-comment, non-blank Content-Security-Policy line in a _headers-style text. */
function extractHeadersCsp(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = trimmed.match(/^Content-Security-Policy:\s*(.*)$/)
    if (m) return m[1].trim()
  }
  return ''
}

/** Canonical form of the three shared directives, in policy order. */
function sharedDirectives(policy) {
  return SHARED_DIRECTIVES.map((name) => {
    const value = extractDirective(policy, name)
    assert.ok(value !== null, `directive ${name} present in policy`)
    return `${name} ${value}`
  }).join('; ')
}

test('META_CSP matches the three shared directives of _headers and SECURITY_HEADERS verbatim', () => {
  const headersPolicy = extractHeadersCsp(
    readFileSync(new URL('../../_headers', import.meta.url), 'utf8'),
  )
  const configPolicy =
    readFileSync(new URL('../../src/shared/config.js', import.meta.url), 'utf8').match(
      /Content-Security-Policy['"]:\s*"([^"]+)"/,
    )?.[1] ?? ''
  assert.ok(headersPolicy && configPolicy, 'both HTTP-layer policies present')

  for (const [label, policy] of [
    ['_headers', headersPolicy],
    ['SECURITY_HEADERS', configPolicy],
  ]) {
    assert.equal(
      sharedDirectives(policy),
      META_CSP,
      `${label} three shared directives verbatim equal to META_CSP`,
    )
  }

  // META_CSP carries exactly the three shared directives and nothing else.
  const names = META_CSP.split(';')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean)
  assert.deepEqual(names, SHARED_DIRECTIVES, 'META_CSP has exactly the three shared directives')
  assert.equal(extractDirective(META_CSP, 'script-src'), "'self'", 'META_CSP script-src only self')
  assert.equal(extractDirective(META_CSP, 'style-src-elem'), "'self'", 'META_CSP style-src-elem only self')
  assert.equal(extractDirective(META_CSP, 'style-src-attr'), "'none'", 'META_CSP style-src-attr none')
  assert.ok(!/default-src/.test(META_CSP), 'META_CSP has no default-src')
  assert.ok(!/unsafe-inline/.test(META_CSP), 'META_CSP has no unsafe-inline')
  assert.ok(!/unsafe-eval/.test(META_CSP), 'META_CSP has no unsafe-eval')
})

test('vite configs consume META_CSP_TAG from the single source (no private literal copy)', () => {
  for (const file of ['vite.config.js', 'vite.m5.config.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(
      source,
      /import\s*\{[^}]*META_CSP_TAG[^}]*\}\s*from\s*['"]\.\/src\/constants\/csp\.js['"]/,
      `${file} imports META_CSP_TAG from src/constants/csp.js`,
    )
    assert.ok(
      !/script-src 'self'; style-src-elem/.test(source),
      `${file} has no inline CSP meta literal`,
    )
  }
})
