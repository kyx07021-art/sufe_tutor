/**
 * actions.js - M7-22 send-message navigation helper
 * -----------------------------------------------------------------
 * - navigateToConversation(conversationId) pushes the app router to the chat
 *   page (path /chat, name chat, registered by src/modules/chat/pages.js) with
 *   the conversation id as the ?conv= query — the chat route carries no route
 *   param, so a query is the matching deep-link shape.
 * - The temp-conversation creation itself is owned by the chat module boundary
 *   action startTempConversation (I-23) — M7-22 wires it from TeacherSquarePage.
 *   The former openTeacherConversation / openTeacherChat helpers were removed
 *   (W18 dead-code discipline: the chat module is the single I-23 consumer).
 * - Router is lazy-imported at call time to break an import cycle, not for
 *   Node-safety: router/index.js -> page-registry.js globs teacher-square/pages.js
 *   -> TeacherSquarePage.vue -> actions.js. A static `import { router }` here
 *   would close the cycle and hit a TDZ error ("Cannot access 'TeacherSquarePage'
 *   before initialization") because pages.js reads the component during module
 *   evaluation while the SFC is still mid-import. Deferring the router read to
 *   call time keeps the graph acyclic.
 */

/** Chat page route (path registered by src/modules/chat/pages.js, name 'chat'). */
export const CHAT_ROUTE = '/chat'

/**
 * Deep-link into the chat page for a conversation.
 * @param {number|string} conversationId - conversation to open.
 * @returns {Promise<void>} resolves after the router push settles.
 */
export async function navigateToConversation(conversationId) {
  const { router } = await import('../../router/index.js')
  await router.push({ path: CHAT_ROUTE, query: { conv: String(conversationId) } })
}
