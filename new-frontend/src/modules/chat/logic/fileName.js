/**
 * fileName.js — M4-13 filename truncation preserving the extension
 * -----------------------------------------------------------------
 * Plan-book C2.1 (L418): when a file name is too long for its rounded-rect
 * bubble, truncate the base name with an ellipsis and keep the extension at
 * the end.
 *
 * Rules:
 * - The extension is the substring after the LAST dot ("report.final.pdf" ->
 *   ext "pdf", base "report.final"). A name with no dot has no extension.
 * - If the full name fits within maxChars it is returned unchanged.
 * - Otherwise the base name is truncated so the result
 *   `basePrefix + '…' + '.' + ext` stays within maxChars, leaving one
 *   character of breathing room so the ellipsis is never flush against the
 *   bubble edge. The extension always has priority.
 * - Degenerate fallback: if even the suffix ('…' + '.' + ext) cannot fit
 *   within maxChars, the name is returned unchanged — destroying the
 *   extension is worse than a slight overflow.
 *
 * Pure function: zero DOM, zero imports, node-testable.
 *
 * Examples:
 *   truncateFileName('abc.pdf', 20)                    === 'abc.pdf'
 *   truncateFileName('verylongdocumentname.pdf', 12)   === 'verylo….pdf'
 *   truncateFileName('noext', 3)                       === 'no…'
 *   truncateFileName('a.pdf', 3)                       === 'a.pdf'
 */

const ELLIPSIS = '…'

/**
 * Truncate a file name so it fits maxChars while preserving its extension.
 * @param {string} name - Original file name (e.g. "report.final.pdf").
 * @param {number} [maxChars=20] - Hard limit on the returned length.
 * @returns {string} Truncated name (extension preserved when possible).
 */
export function truncateFileName(name, maxChars = 20) {
  if (name.length <= maxChars) return name

  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) {
    // No extension: truncate the whole name with a trailing ellipsis.
    const prefixLen = Math.max(0, maxChars - ELLIPSIS.length)
    return name.slice(0, prefixLen) + ELLIPSIS
  }

  const base = name.slice(0, dotIndex)
  const extWithDot = name.slice(dotIndex) // e.g. '.pdf'

  // Extension has priority. If even the suffix ('…' + '.ext') cannot fit the
  // budget, keep the name unchanged: truncating would destroy the extension.
  const suffixLen = ELLIPSIS.length + extWithDot.length
  if (suffixLen > maxChars) return name

  // Give the base every remaining character minus one char of breathing room,
  // so the ellipsis is not flush against the bubble edge.
  const maxBase = Math.max(0, maxChars - suffixLen - 1)
  return base.slice(0, maxBase) + ELLIPSIS + extWithDot
}
