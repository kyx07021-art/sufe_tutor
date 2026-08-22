/**
 * test/harness-chat-shell.js - M4 chat shell render harness
 * -------------------------------------------------------
 * - Mounts ChatPage in isolation for smoke-chat-shell.mjs (Vite dev entry),
 *   bypassing the M2 router/auth (the chat shell's skeleton state is fixture-seeded).
 */
import { createApp } from 'vue'
import ChatPage from '../src/modules/chat/ChatPage.vue'
import UiToast from '../src/components/ui/UiToast.vue'
import '../src/styles/tokens.css'
import '../src/styles/base.css'

const app = createApp(ChatPage)
app.mount('#app')

createApp(UiToast).mount('#app-toast')
