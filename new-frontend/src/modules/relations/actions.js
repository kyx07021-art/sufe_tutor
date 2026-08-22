/**
 * actions.js - M3 relations cross-module navigation wiring (PA-1h2-M1)
 * -------------------------------------------------------
 * - The relation card's `open-conversation` interface hat had zero consumers in
 *   the codebase (dead UI, F4). This module owns the wiring.
 * - `openRelationConversation(conversationId)`:
 *   1. Activates the conversation in the chat store (openConversation) so the
 *      specific conversation is active when /chat lands. The chat route carries
 *      the id as a ?conv= query (deep-link shape established by teacher-square's
 *      navigateToConversation); the store activation keeps the target
 *      conversation selected even before the I-17 list resolves.
 *   2. Pushes the app router to /chat?conv=<id> (memory history, zero URL races).
 * - Dependencies (openChat / push) are injectable for Node smoke tests; the
 *   production defaults are lazy-imported at call time so this module's import
 *   graph stays acyclic (the router globs this module's pages.js -> RelationsPage
 *   -> actions). No top-level imports: plain Node can import this file safely.
 * - Contract 6: zero Chinese, zero inline event/style literals.
 */

/** Chat page route (path registered by src/modules/chat/pages.js, name 'chat'). */
export const RELATIONS_CHAT_ROUTE = '/chat'

/**
 * Open the conversation page at the given conversation.
 * @param {number|null|undefined} conversationId - the session to open.
 * @param {{ openChat?: (id:number)=>void, push?: (route:object)=>Promise<unknown> }} [deps]
 *   injected dependencies for Node tests; production defaults are lazy-imported.
 * @returns {Promise<void>} resolves after the router push settles.
 */
export async function openRelationConversation(conversationId, deps = {}) {
  if (conversationId == null) return
  const { openChat, push } = deps
  const open = openChat || (await import('@/modules/chat/index.js')).openConversation
  const go = push || (await import('../../router/index.js')).router.push
  open(conversationId)
  await go({ path: RELATIONS_CHAT_ROUTE, query: { conv: String(conversationId) } })
}
