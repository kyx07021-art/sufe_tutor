# M1 Landing Page — Module Contract

> Every M1 primitive owns exactly one file below (file-level isolation). A subagent
> implementing a primitive writes **only its own file**; the module lead assembles
> (wires composables/CSS into components, extends smoke-landing, runs build).
> Discipline: consume M0 (UiButton / tokens), contract 6 (zero inline
> event/style, zero `v-html`, zero runtime `<style>`, English-only comments),
> JS only toggles classes + CSSOM data channel, reduced-motion respected.

## File map

| # | primitive | file | export / shape | depends on |
|---|---|---|---|---|
| M1-01 | skeleton + 5% inset + section gaps | `LandingPage.vue` | default SFC | M0 tokens |
| M1-02 | placeholder images | `tools/gen-images.py` → `src/assets/img/{gallery-1..8,mirror-a,mirror-b}.png` | run: `python tools/gen-images.py` | — |
| M1-03 | hero | `LandingHero.vue` | default SFC; buttons carry `data-cap="enter.student"` / `"enter.teacher"` | M1-01, M0 UiButton, `LANDING_COPY` |
| M1-04 | SLOGAN + gray text | `LandingSlogan.vue` | default SFC | M1-01, `LANDING_COPY` |
| M1-05 | footer | `LandingFooter.vue` | default SFC | M1-01 |
| M1-06 | corridor structure + loop | `LandingGallery.vue` | default SFC; exposes viewport `.landing-gallery__viewport`, track `.landing-gallery__track`, images `img`; scroll listener wraps `scrollLeft ∈ [seqW, 2*seqW)` | M1-02, M0 tokens |
| M1-07a | corridor drag | `useGalleryDrag.js` | `export function useGalleryDrag(viewportRef)` → `{ isDragging }`; pointer drag manipulates `scrollLeft` only | M1-06 |
| M1-07b | corridor idle drift + pause/resume | `useGalleryDrift.js` | `export function useGalleryDrift(viewportRef, { speed = 40 } = {})`; rAF, pauses on hover / drag / offscreen / reduced-motion | M1-06, M1-07a |
| M1-08 | corridor edge mask | `landing-gallery-mask.css` | plain CSS: `.landing-gallery__viewport` `mask-image` linear gradient transparent→#000 over `--gallery-mask-w` both edges | M1-06 |
| M1-09 | corridor edge linear shrink | `useGalleryShrink.js` | `export function useGalleryShrink(viewportRef)`; sets per-image `--g-scale` via CSSOM; CSS transform lives in gallery component (lead wires) | M1-06 |
| M1-10 | mirror sections | `LandingMirror.vue` | default SFC; `variant: 'a'\|'b'`; consumes `MIRROR_COPY` + `mirror-a/b.png` | M1-02, `MIRROR_COPY` |
| M1-11 | scroll reveal + re-register | `useScrollReveal.js` + `landing-reveal.css` | `export function useScrollReveal(root = document)`; toggles `.reveal-in-up/.reveal-in-down/.reveal-pending` on `[data-reveal]`; reduced-motion exempt | M1-01/03/04/06 (data-reveal present) |
| M1-12 | assembly + acceptance | (lead) `LandingPage.vue`, `main.js`/`LandingPage.vue` CSS imports, `test/smoke-landing.mjs`, `npm run build` | wires 07a/07b/08/09/10/11, extends smoke test, dual-viewport real-browser pass | all |

## Shared constants / tokens (consumed, not written by primitives)
- `src/constants/m-landing.js` — `LANDING_COPY` (M1-03/04/06), `MIRROR_COPY` (M1-10); re-exported by `ui.js`.
- `src/styles/tokens.css` — `--landing-*`, `--gallery-img-w`, `--gallery-gap`, `--gallery-mask-w`, `--gallery-shrink-min`, `--slogan-block-w`, `--fs-slogan`, `--mirror-img-w`, `--footer-h`.

## Coordinate contract (corridor interactions)
- All pointer math in one rect conversion at drag start (component-local coords).
- Drag sets `scrollLeft`; the M1-06 scroll listener owns the modulo wrap.
- No `opacity` in keyframes for interaction layers; transform + cascade opacity only.
