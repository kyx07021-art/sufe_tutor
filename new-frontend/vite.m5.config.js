import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { META_CSP_TAG } from './src/constants/csp.js'

/**
 * M5 standalone preview build (test isolation)
 * - Builds m5-preview.html (module harness) into dist-m5/ so the smoke test can run
 *   against a stable snapshot, free of dev-server HMR interference from parallel modules.
 * - Also injects the strict meta CSP (same plugin + single source as the main build)
 *   so the smoke test can assert CSP compliance.
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
    outDir: 'dist-m5',
    target: 'es2018',
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./m5-preview.html', import.meta.url)),
    },
  },
})

function injectCspMeta() {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', '<head>\n    ' + META_CSP_TAG)
    },
  }
}
