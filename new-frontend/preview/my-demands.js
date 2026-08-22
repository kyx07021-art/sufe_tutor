/**
 * M8 my-demands dev preview entry (dev-only, NOT part of the production build).
 * Served by Vite dev at /preview/my-demands.html; smoke test drives it via Playwright.
 */
import { createApp } from 'vue'
import MyDemandsPreview from '@/modules/my-demands/MyDemandsPreview.vue'
import '@/styles/tokens.css'
import '@/styles/base.css'

createApp(MyDemandsPreview).mount('#app')
