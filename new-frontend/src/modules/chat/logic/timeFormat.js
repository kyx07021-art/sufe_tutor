/**
 * timeFormat.js - M4-04/09 time-formatting mapping for the C2 chat module.
 * ---------------------------------------------------------------------------
 * Pure functions rendering the two time surfaces of the conversation UI:
 *   - formatListTime(ts, now)   -> conversation-list card right-hand time slot
 *                                   (plan L404; M4-04).
 *   - formatBubbleTime(ts, now) -> message-bubble send-time label (plan L428;
 *                                   M4-09).
 *
 * Both classify the input timestamp against `now` using the LOCAL calendar:
 *   today / yesterday / earlier-same-year / previous-year.
 * Calendar boundaries are local midnights computed with Date(y,m,d-1)
 * normalization (DST-safe), so a moment just before 00:00 belongs to yesterday
 * and 00:00 starts today.
 *
 * Copy comes from the module single source CHAT_COPY (src/constants/m-chat.js);
 * this file holds zero Chinese literals. `now` is injectable (default
 * Date.now()) for unit tests, and there is no DOM / Vue / `@` alias dependency,
 * so both functions import cleanly from plain Node.
 */

import { CHAT_COPY } from '../../../constants/m-chat.js'

/** Local-midnight start (ms) of the calendar day containing `d`. */
function startOfDayMs(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** True when `a` and `b` fall on the same local calendar day. */
function isToday(a, b) {
  return startOfDayMs(a) === startOfDayMs(b)
}

/**
 * True when `a` falls on the local calendar day immediately before `b`'s day.
 * Bound: [yesterdayStart, todayStart) - the last ms before midnight counts as
 * yesterday, midnight itself starts today.
 */
function isYesterday(a, b) {
  const bStart = startOfDayMs(b)
  const yStart = new Date(b.getFullYear(), b.getMonth(), b.getDate() - 1).getTime()
  const t = a.getTime()
  return t >= yStart && t < bStart
}

/** Normalize a timestamp to a Date (ms number, Date-parseable value, or Date). */
function toDate(value) {
  return new Date(value)
}

/** Two-digit zero-padded integer (9 -> "09"). */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * Earlier-than-yesterday renderer shared by both surfaces:
 * same year -> month/day copy; previous year -> year/month/day copy.
 */
function formatPastDate(d, n) {
  if (d.getFullYear() === n.getFullYear()) {
    return CHAT_COPY.TIME_MONTH_DAY(d.getMonth() + 1, d.getDate())
  }
  return CHAT_COPY.TIME_YEAR_MONTH_DAY(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/**
 * Conversation-list card right-hand time slot.
 * Within today: < 1h -> "n min ago" (ceil minutes, min 1); otherwise "h hr m min ago".
 * Yesterday -> "yesterday"; earlier same year -> month/day copy;
 * previous year -> year/month/day copy.
 *
 * @param {number|string|Date} ts - message timestamp (ms or Date-parseable).
 * @param {number|string|Date} now - reference "now" (default Date.now()).
 * @returns {string} localized label for the list card.
 */
export function formatListTime(ts, now = Date.now()) {
  const d = toDate(ts)
  const n = toDate(now)
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return ''

  if (isToday(d, n)) {
    const elapsedMin = Math.floor((n.getTime() - d.getTime()) / 60000)
    if (elapsedMin < 60) {
      // ceil minutes, clamp to >= 1 (covers sub-minute and slight clock skew).
      const m = Math.max(1, Math.ceil((n.getTime() - d.getTime()) / 60000))
      return CHAT_COPY.TIME_MINUTES_AGO(m)
    }
    return CHAT_COPY.TIME_HOURS_MIN_AGO(
      Math.floor(elapsedMin / 60),
      elapsedMin % 60,
    )
  }
  if (isYesterday(d, n)) return CHAT_COPY.TIME_YESTERDAY
  return formatPastDate(d, n)
}

/**
 * Message-bubble send-time label.
 * Same day -> "HH:MM" (local, zero-padded); yesterday -> "yesterday";
 * earlier same year -> month/day copy; previous year -> year/month/day copy.
 *
 * @param {number|string|Date} ts - message timestamp (ms or Date-parseable).
 * @param {number|string|Date} now - reference "now" (default Date.now()).
 * @returns {string} localized label for the bubble.
 */
export function formatBubbleTime(ts, now = Date.now()) {
  const d = toDate(ts)
  const n = toDate(now)
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return ''

  if (isToday(d, n)) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  if (isYesterday(d, n)) return CHAT_COPY.TIME_YESTERDAY
  return formatPastDate(d, n)
}
