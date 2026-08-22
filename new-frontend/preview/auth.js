/**
 * M6 auth dev preview entry (dev-only, NOT part of the production build).
 * Served by Vite dev at /preview/auth.html; smoke test drives it via Playwright.
 * AuthPreview is self-contained (renders AuthHost + UiToast), so the standalone
 * harness can open the identity-auth modal without the app shell.
 */
import { createApp } from 'vue'
import AuthPreview from '@/modules/auth/AuthPreview.vue'
import '@/styles/tokens.css'
import '@/styles/base.css'

createApp(AuthPreview).mount('#app')
