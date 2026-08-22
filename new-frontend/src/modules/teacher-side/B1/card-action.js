/**
 * card-action.js - B1-7 demand card click -> conversation/temp conversation
 * -------------------------------------------------------------------------
 * - Builds the intent payload for opening a conversation with the demand owner.
 * - Consumes the teacher-side data-cap seam (M8-05) + I-23 temp-conversation cap.
 * - The chat shell (M4) is not built yet: the page shows the session-cap toast
 *   instead of navigating. `openConversationFromDemand` stays a pure intent builder
 *   so M4 can wire it without changing the card.
 */

/** Pure: build the conversation-open intent from a demand card. */
export function openConversationFromDemand(demand) {
  return {
    demandId: demand && demand.id,
    targetUserId: demand && demand.user_id,
    studentName: demand && demand.studentName,
  }
}
