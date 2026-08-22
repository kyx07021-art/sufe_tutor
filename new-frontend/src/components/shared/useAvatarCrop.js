/**
 * useAvatarCrop - avatar center-crop max circle (M5-09b / M9-B2-6 shared, M0 thaw)
 * ------------------------------------------------------------------------------
 * - Pure geometry helpers (node-testable) + browser canvas crop to a square dataURL.
 * - The "max circle" of a rectangle is the inscribed circle centered at the rect
 *   center with radius min(w,h)/2; center-cropping to that square and displaying
 *   with border-radius:50% yields the max circle avatar (I-11 expects a square dataURL).
 * - Browser functions require DOM/canvas; module imports must stay side-effect-free
 *   so node tests can import the pure helpers directly.
 */

/** Pure: largest inscribed circle of a w*h rectangle. */
export function maxInscribedCircle(w, h) {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) / 2
  return { cx, cy, r }
}

/** Pure: center square crop rect in source coordinates. */
export function centerCropRect(w, h) {
  const side = Math.min(w, h)
  return { x: (w - side) / 2, y: (h - side) / 2, side }
}

/** Pure: scale factor to fit srcSide into targetSize. */
export function scaleToFit(srcSide, targetSize) {
  return targetSize / srcSide
}

/** Browser: draw the center square of `image` onto a `size`x`size` canvas, return dataURL. */
export function cropToDataURL(image, { size = 512, mime = 'image/png', quality } = {}) {
  const { x, y, side } = centerCropRect(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, x, y, side, side, 0, 0, size, size)
  return canvas.toDataURL(mime, quality)
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(fr.error || new Error('file read failed'))
    fr.readAsDataURL(file)
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

/** Browser: crop a File/Blob to the max-circle square dataURL. */
export async function cropAvatar(file, { size = 512, mime = 'image/png', quality } = {}) {
  const dataUrl = await readFileAsDataURL(file)
  const img = await loadImage(dataUrl)
  const out = cropToDataURL(img, { size, mime, quality })
  const { cx, cy, r } = maxInscribedCircle(size, size)
  return { dataUrl: out, width: size, height: size, diameter: size, crop: { cx, cy, r } }
}

/** Composable surface (returns the same functions for component setup). */
export function useAvatarCrop() {
  return { maxInscribedCircle, centerCropRect, scaleToFit, cropToDataURL, cropAvatar }
}
