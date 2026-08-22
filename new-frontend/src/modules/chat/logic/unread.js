/**
 * unread.js - M4-05 unread red-dot lifecycle state machine (pure logic).
 * ----------------------------------------------------------------------
 * Four-path state machine from plan C2.3 L405:
 *   receive          : new message arrives -> unread + 1 (red dot appears)
 *   openFromCard     : user actively clicks the conversation card -> unread clears instantly
 *   enterFromOutside : user enters from elsewhere (relation graph jump, etc.) -> dot STAYS
 *                      until the user either taps that card again OR does any input-bar action
 *   inputActivity    : user does any action in the input bar -> unread clears
 *   (leave with no action above -> dot stays; there is no explicit leave handler)
 *
 * All functions mutate the passed `conversations` rows in place (Vue-reactive
 * friendly) and return the resulting unread value (null when the row is absent).
 * Pure logic: no DOM / no imports / Node-importable for unit tests.
 * UI wiring lives in ChatListPane / ChatConversationPane (module lead).
 */

/**
 * Received a new message: unread + 1.
 * @param {Array<{conversationId:number, unread:number}>} conversations
 * @param {number} convId
 * @returns {number|null} new unread value, or null if the row is missing.
 */
export function unreadReceive(conversations, convId) {
  const row = conversations.find((c) => c.conversationId === convId)
  if (!row) return null
  row.unread = (row.unread || 0) + 1
  return row.unread
}

/**
 * User actively clicked the conversation card: unread clears instantly (L405).
 * @returns {number|null} 0, or null if the row is missing.
 */
export function unreadOpenFromCard(conversations, convId) {
  const row = conversations.find((c) => c.conversationId === convId)
  if (!row) return null
  row.unread = 0
  return 0
}

/**
 * User entered from elsewhere: dot STAYS (unread unchanged). Returns current unread.
 * @returns {number|null} current unread, or null if the row is missing.
 */
export function unreadEnterFromOutside(conversations, convId) {
  const row = conversations.find((c) => c.conversationId === convId)
  if (!row) return null
  return row.unread || 0
}

/**
 * User did any input-bar action: unread clears.
 * @returns {number|null} 0, or null if the row is missing.
 */
export function unreadInputActivity(conversations, convId) {
  const row = conversations.find((c) => c.conversationId === convId)
  if (!row) return null
  row.unread = 0
  return 0
}
