/**
 * csp.js - strict meta CSP single source (contract 8)
 * ---------------------------------------------------
 * - Vite injects this exact meta CSP into index.html at build time
 *   (vite.config.js / vite.m5.config.js -> injectCspMeta, both consume
 *   META_CSP_TAG; zero private literal copies).
 * - Minimal declaration: no default-src, no unsafe-inline. Directives not
 *   listed here fall back to '*' inside the meta policy itself, so img-src
 *   data:/blob: protection is carried by the explicit img-src declaration in
 *   _headers and src/shared/config.js SECURITY_HEADERS, applied via policy
 *   intersection. Declaring default-src 'self' here would silently tighten
 *   that data:/blob: channel through the intersection, so it stays out.
 * - csp-meta-strict.test.mjs locks this value verbatim against the three
 *   shared directives of _headers / SECURITY_HEADERS.
 */

export const META_CSP =
  "script-src 'self'; style-src-elem 'self'; style-src-attr 'none'"

export const META_CSP_TAG =
  '<meta http-equiv="Content-Security-Policy" content="' + META_CSP + '">'
