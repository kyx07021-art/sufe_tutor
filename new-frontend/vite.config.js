import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'

/**
 * M0 new-frontend build config
 * -------------------------------------------------------
 * - Vue 3 SFC + vite-svg-loader (.svg -> Vue components, currentColor inherited).
 * - Output: dist/ SPA (index.html + assets/*); served by _worker.js on final merge.
 * - base: './' - relative asset paths, deployable at any static path.
 * - target es2018 - matches the v2 deployment surface (old-browser compatible).
 * - Strict CSP: dev mode does NOT inject the meta tag (Vite HMR needs runtime style injection);
 *   build injects via the injectCspMeta plugin:
 *   `script-src 'self'; style-src-elem 'self'; style-src-attr 'none'` (aligned with v2 contract 8).
 * - Component discipline: JS only toggles classes / CSSOM data channel (setProperty), zero inline event/style attrs.
 */
export default defineConfig({
  plugins: [vue(), svgLoader(), injectCspMeta()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2018',
    sourcemap: false,
    cssCodeSplit: true,
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    host: true,
  },
})

/** Inject strict meta CSP into index.html only on build (dev stays relaxed for HMR). */
function injectCspMeta() {
  const meta =
    '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'; style-src-elem \'self\'; style-src-attr \'none\'">'
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', '<head>\n    ' + meta)
    },
  }
}
