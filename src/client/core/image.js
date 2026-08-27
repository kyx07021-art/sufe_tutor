/**
 * core/image.js — client-side image compression single source (ZZ-6, 2026-08-27).
 * Unifies the duplicated chat/complaints shrink logic (chatShrinkImage + complaints
 * shrinkImage were byte-identical copies) and adds byte-budget fit for admission/avatar
 * uploads. All work is local canvas (zero network); input is a data URL / object URL.
 *
 * Capabilities (options, all optional):
 *   maxSide      — cap the longest edge in px (0 = keep original size).
 *   quality      — JPEG quality for the side pass (default 0.82).
 *   thumbSide    — optional thumbnail longest edge (0 = no thumb). Used by chat so the
 *                  message list preloads a tiny image and the full one loads on click.
 *   thumbQuality — thumbnail JPEG quality (default 0.72).
 *   maxBytes     — byte budget: after the side pass, drop quality (0.82→0.3) then side
 *                  until the data URL length fits. Mirrors server-side `.length` limits
 *                  (CREDENTIAL_MAX_BYTES / AVATAR_MAX_BYTES); also guards D1 cell size.
 *   minSide      — floor for the byte-budget side reduction (avoids infinite shrink).
 *
 * Returns Promise<{ dataUrl, thumb }> (thumb '' when not requested). Rejects on decode
 * failure — callers map that to their existing toast path.
 */
export function compressImage(src, opts = {}) {
  const {
    maxSide = 0, quality = 0.82, thumbSide = 0, thumbQuality = 0.72,
    maxBytes = 0, minSide = 48,
  } = opts;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.width, h = img.height;
        if (maxSide > 0 && maxSide < Math.max(w, h)) {
          const k = maxSide / Math.max(w, h);
          w = Math.max(1, Math.round(w * k));
          h = Math.max(1, Math.round(h * k));
        }
        const draw = (qw, qh, q) => {
          const cv = document.createElement('canvas');
          cv.width = qw; cv.height = qh;
          cv.getContext('2d').drawImage(img, 0, 0, qw, qh);
          return cv.toDataURL('image/jpeg', q);
        };
        let sideK = 1;
        let url;
        if (maxBytes > 0) {
          // Byte budget: quality steps first (0.82 → 0.3), then side steps toward minSide.
          let q = quality;
          do {
            url = draw(Math.max(1, Math.round(w * sideK)), Math.max(1, Math.round(h * sideK)), q);
            q -= 0.1;
          } while (url.length > maxBytes && q >= 0.3);
          const floorK = minSide / Math.max(w, h);
          while (url.length > maxBytes && sideK > floorK) {
            sideK = Math.max(floorK, sideK * 0.8);
            url = draw(Math.max(1, Math.round(w * sideK)), Math.max(1, Math.round(h * sideK)), 0.3);
          }
        } else {
          url = draw(w, h, quality);
        }
        const fw = Math.max(1, Math.round(w * sideK));
        const fh = Math.max(1, Math.round(h * sideK));
        let thumb = '';
        if (thumbSide > 0) {
          const tk = Math.min(1, thumbSide / Math.max(fw, fh));
          thumb = draw(Math.max(1, Math.round(fw * tk)), Math.max(1, Math.round(fh * tk)), thumbQuality);
        }
        resolve({ dataUrl: url, thumb });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
    img.src = src;
  });
}
