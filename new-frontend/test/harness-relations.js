/**
 * test/harness-relations.js - M3 relations page render harness
 * -------------------------------------------------------
 * - Mounts RelationsPage in isolation for smoke-relations.mjs (Vite dev entry).
 * - Auth token is injected by the test via localStorage before load.
 */
import { createApp } from 'vue'
import RelationsPage from '../src/modules/relations/RelationsPage.vue'
import { chatState } from '../src/modules/chat/index.js'
import { authStore } from '../src/modules/shell/auth-store.js'
import UiToast from '../src/components/ui/UiToast.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'

const app = createApp(RelationsPage)
app.mount('#app')

// Toast singleton surface (page may show error/feedback toasts).
createApp(UiToast).mount('#app-toast')

// Test hook (smoke-relations.mjs): expose the chat store so the open-conversation
// wiring can be asserted, and the auth store so the empty-state avatar (which
// reads authStore.user.avatar) can be exercised. Same ESM module instances the
// page imports.
window.__REL_TEST__ = {
  chatState,
  setUser: (user) => { authStore.user = user },
}
