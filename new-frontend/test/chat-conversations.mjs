/**
 * test/chat-conversations.mjs — I-17 conversation-list loader + row normalizer tests
 * -------------------------------------------------------------------------------------
 * Node-runnable (no Playwright, no browser). Covers the F1 assembly:
 *   1. normalizeConversationRow: maps BOTH the real backend raw shape (id /
 *      student_name / teacher_name / student_avatar / teacher_avatar / last_body /
 *      last_kind / last_at / last_sender / unread_count + tempStatus /
 *      tempInitiatorId / iAmInitiator / quota) AND the I-17 contract shape
 *      (conversationId / otherName / avatar / lastMessage / lastAt / status /
 *      unread / tempStatus / tempInitiatorId / quotaRemaining / iAmInitiator)
 *      into the single store row shape.
 *   2. Other-party naming: role-aware (teacher -> student_name, student/unknown ->
 *      teacher_name) with contract-shape otherName winning.
 *   3. applyConversations: replaces the store rows and auto-opens the first row as
 *      the active conversation without touching mobilePane (P22 negative path).
 *   4. loadConversations: fetch failure degrades silently to an empty list
 *      (non-fatal); success replaces the rows.
 *
 * Run: node test/chat-conversations.mjs   (also picked up by `npm test`)
 */
import {
  normalizeConversationRow,
  applyConversations,
  loadConversations,
  setCurrentUser,
  chatState,
  startListPolling,
  stopListPolling,
} from '../src/modules/chat/state.js'
import { authStore, setAuth, clearAuth } from '../src/modules/shell/auth-store.js'

const errors = []
const ok = (cond, msg) => { if (!cond) errors.push(msg) }

function resetStore() {
  chatState.conversations = []
  chatState.activeConversationId = null
  chatState.messages = {}
  chatState.messagesLoading = {}
}

/* ============ 1. normalizeConversationRow: real backend raw shape ============ */
const rawRow = {
  id: 7,
  student_user_id: 1,
  teacher_user_id: 2,
  status: 'active',
  student_name: '张三',
  teacher_name: '李老师',
  student_avatar: 'stu-avatar',
  teacher_avatar: 'tea-avatar',
  last_body: '好的，明天下午三点见。',
  last_kind: 'text',
  last_at: '2026-08-22T10:31:00',
  last_sender: 2,
  unread_count: 1,
  tempStatus: null,
  tempInitiatorId: null,
  iAmInitiator: false,
  quota: 1,
}
const studentRow = normalizeConversationRow(rawRow, { id: 1, role: 'student' })
ok(studentRow.conversationId === 7, 'raw: conversationId from id')
ok(studentRow.otherName === '李老师', 'raw: student sees teacher_name as otherName')
ok(studentRow.avatar === 'tea-avatar', 'raw: student sees teacher_avatar')
ok(studentRow.lastMessage === '好的，明天下午三点见。', 'raw: lastMessage from last_body')
ok(studentRow.lastMessageKind === 'text', 'raw: lastMessageKind from last_kind')
ok(studentRow.lastAt === '2026-08-22T10:31:00', 'raw: lastAt from last_at')
ok(studentRow.status === 'active', 'raw: status passthrough')
ok(studentRow.unread === 1, 'raw: unread from unread_count')
ok(studentRow.quotaRemaining === 1, 'raw: quotaRemaining from quota')
ok(studentRow.iAmInitiator === false, 'raw: iAmInitiator passthrough')

const teacherRow = normalizeConversationRow(rawRow, { id: 2, role: 'teacher' })
ok(teacherRow.otherName === '张三', 'raw: teacher sees student_name as otherName')
ok(teacherRow.avatar === 'stu-avatar', 'raw: teacher sees student_avatar')

const noRoleRow = normalizeConversationRow(rawRow, null)
ok(noRoleRow.otherName === '李老师', 'raw: unknown role falls back to teacher_name (I-17 preference)')

/* ============ 2. normalizeConversationRow: contract shape ============ */
const contractRow = normalizeConversationRow({
  conversationId: 9,
  otherName: '王老师',
  avatar: 'av',
  lastMessage: '课件我发你邮箱了。',
  lastAt: '2026-08-21T09:00:00',
  status: 'active',
  unread: 2,
  tempStatus: 'sent',
  tempInitiatorId: 3,
  quotaRemaining: 0,
  iAmInitiator: false,
}, { id: 1, role: 'student' })
ok(contractRow.conversationId === 9, 'contract: conversationId passthrough')
ok(contractRow.otherName === '王老师', 'contract: otherName wins over role-derived name')
ok(contractRow.unread === 2, 'contract: unread passthrough')
ok(contractRow.quotaRemaining === 0, 'contract: quotaRemaining passthrough')
ok(contractRow.tempStatus === 'sent' && contractRow.tempInitiatorId === 3, 'contract: temp fields passthrough')

/* ============ 2b. malformed rows -> null (never pollute the store) ============ */
ok(normalizeConversationRow(null, null) === null, 'malformed: null row -> null')
ok(normalizeConversationRow({}, null) === null, 'malformed: row without id -> null')

/* ============ 3. applyConversations: replace + auto-open first (P22) ============ */
resetStore()
const applied = applyConversations([rawRow, contractRow], { id: 1, role: 'student' })
ok(applied.length === 2, 'apply: returns normalized rows')
ok(chatState.conversations.length === 2, 'apply: store rows replaced')
ok(chatState.activeConversationId === 7, 'apply: first row auto-opens as active (desktop)')
ok(chatState.mobilePane === 'list', 'apply: mobilePane untouched (mobile still starts on list, P22)')

// Auto-open only happens when no conversation is active yet.
resetStore()
chatState.activeConversationId = 3
applyConversations([rawRow], { id: 1, role: 'student' })
ok(chatState.activeConversationId === 3, 'apply: existing active id preserved (no clobber)')

/* ============ 4. loadConversations: failure degrades silently, success replaces ============ */
resetStore()
await loadConversations(null, async () => { throw new Error('backend down') })
ok(chatState.conversations.length === 0, 'load: failure degrades to empty list (non-fatal)')

resetStore()
const captured = []
await loadConversations({ id: 1, role: 'student' }, async (path, init) => {
  captured.push([path, init])
  return { conversations: [rawRow] }
})
ok(captured.length === 1 && captured[0][0] === '/conversations', 'load: calls I-17 GET /conversations')
ok(chatState.conversations.length === 1 && chatState.conversations[0].conversationId === 7, 'load: success replaces rows')
ok(chatState.activeConversationId === 7, 'load: first row becomes active on success')

// payload that is already an array (contract flexibility).
resetStore()
await loadConversations({ id: 1, role: 'student' }, async () => [rawRow])
ok(chatState.conversations.length === 1, 'load: array payload accepted')

/* ============ 5. setCurrentUser (F2): bubble-ownership source is writable ============ */
resetStore()
ok(chatState.currentUserId === null, 'set: currentUserId starts null (no fake default)')
setCurrentUser(7)
ok(chatState.currentUserId === 7, 'set: writes the signed-in id')
setCurrentUser(null)
ok(chatState.currentUserId === null, 'set: null clears on sign-out')

/* ============ 6. startListPolling (PA-2-F12): a conversation newly opened by the
   other party surfaces in the list via poll, without a page re-entry ============ */
stopListPolling() // ensure no leftover poller from any prior run
resetStore()
chatState.activeConversationId = 99 // sentinel: keep the poll from auto-loading messages
setAuth({ token: 't', user: { id: 1, role: 'student' } })
const listCalls = []
let listResp = { conversations: [] }
const listApi = async (path, init) => {
  listCalls.push([path, init])
  return listResp
}
// First fetch: empty list -> store stays empty.
await loadConversations(authStore.user, listApi)
ok(chatState.conversations.length === 0, 'list-poll: empty list leaves store empty')
// The other party opens a new conversation server-side; the next tick must surface it.
listResp = { conversations: [rawRow] }
const beforeCalls = listCalls.length
const p1 = startListPolling({ apiFn: listApi, intervalMs: 20 })
const p2 = startListPolling({ apiFn: listApi, intervalMs: 20 })
ok(p1 === p2, 'list-poll: start is F3-idempotent (same singleton, no second timer)')
await new Promise((r) => setTimeout(r, 150))
ok(
  chatState.conversations.length === 1 && chatState.conversations[0].conversationId === 7,
  'list-poll: newly-opened conversation surfaces without page re-entry',
)
ok(listCalls.length > beforeCalls, 'list-poll: I-17 endpoint re-polled on the timer')
ok(chatState.activeConversationId === 99, 'list-poll: existing active conversation preserved')
stopListPolling()
const afterStop = listCalls.length
await new Promise((r) => setTimeout(r, 70))
ok(listCalls.length === afterStop, 'list-poll: stop clears the timer (no further polls)')
clearAuth()
ok(authStore.user === null, 'list-poll: auth cleared after test')

if (errors.length) {
  console.log('CHAT CONVERSATIONS TEST FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
}
console.log('CHAT CONVERSATIONS TEST PASS')
