/**
 * test/chat-list-card.mjs — M4-03 selection card + M4-05 unread wiring (Node-runnable)
 * -------------------------------------------------------------------------------------
 * Covers the M4-03 acceptance ("select toggles class / ended grayed + negative path")
 * to the extent that is Node-runnable without a browser:
 *   1. M4-05 unread helpers (pure logic): unreadReceive increments, unreadOpenFromCard
 *      clears, and a closed-conversation row keeps its unread cleared (M4-03 negative path:
 *      an ended card never shows / resurrects a red dot).
 *   2. ChatListPane.vue SFC parses (template/script/style well-formed).
 *   3. Source-level wiring locks for the DOM behavior that needs Playwright:
 *      the pane imports unreadOpenFromCard, gates the red dot on `showDot(c)`
 *      (which returns false for status === 'closed'), and wires the card click
 *      through `onCardClick` (clears unread then emits 'open').
 *
 * DOM behavior (covered by the module shell smoke, test/smoke-chat-shell.mjs):
 *   - selecting a card adds .is-active; an ended card is grayed (.is-closed) but
 *     remains clickable to open read-only history (the send-gate lives in
 *     ChatConversationPane via state.isChatInputVisible), and shows no red dot.
 *
 * Run: node test/chat-list-card.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'

import {
  unreadReceive,
  unreadOpenFromCard,
  unreadEnterFromOutside,
  unreadInputActivity,
} from '../src/modules/chat/logic/unread.js'

const COMPONENT = fileURLToPath(
  new URL('../src/modules/chat/components/ChatListPane.vue', import.meta.url),
)
const source = readFileSync(COMPONENT, 'utf8')

/* ============ 1. M4-05 unread helpers (pure logic) ============ */
// unreadReceive increments; unreadOpenFromCard clears.
{
  const rows = [{ conversationId: 1, unread: 0, status: 'active' }]
  assert.equal(unreadReceive(rows, 1), 1, 'unreadReceive increments to 1')
  assert.equal(rows[0].unread, 1, 'row unread is 1 after receive')
  assert.equal(unreadOpenFromCard(rows, 1), 0, 'unreadOpenFromCard clears to 0')
  assert.equal(rows[0].unread, 0, 'row unread is 0 after openFromCard')
}

// Closed-conversation row keeps unread cleared (M4-03 negative path):
// an ended card must never accumulate / resurrect a red dot.
{
  const closed = [{ conversationId: 9, unread: 3, status: 'closed' }]
  // Defensive bad data -> clicking the card clears it.
  assert.equal(unreadOpenFromCard(closed, 9), 0, 'closed row: openFromCard clears to 0')
  // Entering from elsewhere does NOT re-mark a closed row.
  assert.equal(unreadEnterFromOutside(closed, 9), 0, 'closed row: enterFromOutside keeps it cleared')
  // Any input-bar activity also stays cleared.
  assert.equal(unreadInputActivity(closed, 9), 0, 'closed row: inputActivity keeps it cleared')
  // Missing row -> no-op null (never throws).
  assert.equal(unreadOpenFromCard(closed, 999), null, 'missing row -> null')
}

/* ============ 2. SFC parse check ============ */
{
  const { errors } = parse(source, { filename: 'ChatListPane.vue' })
  assert.deepEqual(errors, [], 'ChatListPane.vue parses without errors')
}

/* ============ 3. Source-level wiring locks (DOM behavior needs Playwright) ============ */
{
  // The pane imports the unread helper from the module single source.
  assert.match(
    source,
    /import\s*\{[^}]*unreadOpenFromCard[^}]*\}\s*from\s*'\.\.\/logic\/unread\.js'/,
    'ChatListPane imports unreadOpenFromCard from logic/unread.js',
  )
  // The card click goes through onCardClick (clears unread then emits open).
  assert.match(source, /@click="onCardClick\(c\)"/, 'card click wired to onCardClick')
  assert.match(
    source,
    /unreadOpenFromCard\(\s*chatState\.conversations,\s*c\.conversationId\s*\)/,
    'onCardClick clears unread from chatState.conversations',
  )
  assert.match(source, /emit\('open',\s*c\.conversationId\)/, 'onCardClick emits open')
  // The red dot is gated by showDot(c).
  assert.match(
    source,
    /v-if="showDot\(c\)"\s+class="chat-card__dot"/,
    'red dot gated by showDot(c)',
  )
  assert.match(
    source,
    /function showDot\(c\)\s*\{\s*return c\.status !== 'closed'\s*&&\s*c\.unread\s*>\s*0\s*\}/,
    'showDot suppresses the dot for ended (closed) conversations',
  )
  // The ended card keeps its grayed-but-clickable class binding.
  assert.match(
    source,
    /'is-closed':\s*c\.status\s*===\s*'closed'/,
    'is-closed class bound to status (grayed, still clickable)',
  )
}

console.log('CHAT LIST CARD PASS')
