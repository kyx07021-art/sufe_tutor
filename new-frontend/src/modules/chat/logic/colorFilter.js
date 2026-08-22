/**
 * colorFilter.js - M4-08 brand-purple color filter for the C2 chat module.
 * ---------------------------------------------------------------------------
 * Plan C2.1 L411: our own bubble is a high-lightness / low-saturation version of
 * the brand purple fill. That pale shade is expressed here as a color filter
 * algorithm over the brand purple, so changing the brand later re-derives the
 * bubble fill automatically (single source: src/styles/tokens.css `--brand`).
 *
 * Reference targets (tokens.css): --brand #6c5ce7 (input) and
 * --brand-soft #eceafc (the intended pale family: high lightness, low
 * saturation). brandSoftFilter() does not guarantee a byte-identical match to
 * --brand-soft; it only guarantees the same *family* (same hue, raised
 * lightness, reduced saturation).
 *
 * Exports (all pure, zero DOM, zero import dependencies - importable from plain
 * Node for unit tests):
 *   - brandSoftFilter(brandHex, opts) -> pale brand hex string.
 *   - hexToHsl(hex)                    -> [h, s, l] (h in degrees, s/l in 0..1).
 *   - hslToHex(h, s, l)                -> '#rrggbb' lowercase.
 *
 * Input hex supports both '#rgb' (shorthand) and '#rrggbb'; an optional leading
 * '#' is tolerated. Invalid input is handled per contract: brandSoftFilter
 * returns the original value unchanged, hexToHsl returns null.
 *
 * This file holds zero Chinese literals.
 */

/**
 * Clamp a channel value to the closed unit interval [0, 1].
 * Non-finite inputs collapse to 0 so no caller can produce a NaN channel.
 * @param {*} v - value to clamp.
 * @returns {number} clamped channel in [0, 1].
 */
function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Normalize a hex color string to lowercase '#rrggbb', or null when invalid.
 * Accepts '#rgb' / '#rrggbb' (leading '#' optional). Digits are 0-9a-fA-F.
 * @param {*} hex - candidate hex color.
 * @returns {string|null} normalized '#rrggbb', or null for invalid input.
 */
function normalizeHex(hex) {
  if (typeof hex !== 'string') return null
  let s = hex.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (/^[0-9a-f]{3}$/i.test(s)) {
    // '#rgb' shorthand -> '#rrggbb' by doubling each digit.
    return s
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toLowerCase()
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  return null
}

/**
 * Convert a hex color to HSL.
 * @param {*} hex - '#rgb' or '#rrggbb' (leading '#' optional).
 * @returns {number[]|null} [h, s, l] - h in degrees [0, 360), s and l in [0, 1].
 *   Returns null when the input is not a valid hex color.
 */
export function hexToHsl(hex) {
  const norm = normalizeHex(hex)
  if (!norm) return null

  const r = parseInt(norm.slice(0, 2), 16) / 255
  const g = parseInt(norm.slice(2, 4), 16) / 255
  const b = parseInt(norm.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return [0, 0, l] // achromatic: hue undefined, saturation 0.

  let h
  if (max === r) {
    h = 60 * (((g - b) / delta) % 6)
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2)
  } else {
    h = 60 * ((r - g) / delta + 4)
  }
  if (h < 0) h += 360

  // delta is 0 only when l is 0 or 1, so the denominator is never 0.
  const s = delta / (1 - Math.abs(2 * l - 1))

  return [h, s, l]
}

/**
 * Convert an HSL color back to lowercase '#rrggbb'.
 * @param {number} h - hue in degrees (wrapped to [0, 360)).
 * @param {number} s - saturation in [0, 1] (clamped).
 * @param {number} l - lightness in [0, 1] (clamped).
 * @returns {string} lowercase '#rrggbb'.
 */
export function hslToHex(h, s, l) {
  const hh = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0
  const ss = clamp01(s)
  const ll = clamp01(l)

  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const hp = hh / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = ll - c / 2

  let r
  let g
  let b
  if (hp < 1) {
    r = c; g = x; b = 0
  } else if (hp < 2) {
    r = x; g = c; b = 0
  } else if (hp < 3) {
    r = 0; g = c; b = x
  } else if (hp < 4) {
    r = 0; g = x; b = c
  } else if (hp < 5) {
    r = x; g = 0; b = c
  } else {
    r = c; g = 0; b = x
  }

  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Derive the pale own-bubble shade from a brand-purple hex.
 * Keeps hue unchanged, lowers saturation and raises lightness.
 * @param {*} brandHex - brand purple '#rgb' or '#rrggbb'; returned unchanged
 *   when invalid.
 * @param {{ saturation?: number, lightness?: number }} [opts] - optional
 *   channel overrides. Defaults: saturation 0.35, lightness 0.94 (both 0..1).
 * @returns {string} pale brand shade as lowercase '#rrggbb', or the original
 *   input when it is not a valid hex color.
 */
export function brandSoftFilter(brandHex, opts = {}) {
  const hsl = hexToHsl(brandHex)
  if (hsl == null) return brandHex // invalid input: return original value.

  const h = hsl[0]
  const s = clamp01(opts.saturation ?? 0.35)
  const l = clamp01(opts.lightness ?? 0.94)
  return hslToHex(h, s, l)
}
