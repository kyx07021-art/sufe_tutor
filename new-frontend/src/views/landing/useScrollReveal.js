import { onBeforeUnmount } from 'vue'

/**
 * useScrollReveal - landing scroll in/out reveal with re-register (M1-11)
 * --------------------------------------------------------------------
 * - Every `[data-reveal]` element animates when it scrolls into the viewport:
 *   scrolling DOWN -> `.reveal-in-up` (float up + fade in); scrolling UP ->
 *   `.reveal-in-down` (float down + fade in); direction unknown (first load /
 *   no scroll) -> final visible state, no animation.
 * - RE-REGISTER semantics (new, replaces the old one-shot reveal): when an
 *   element is fully scrolled OUT of the viewport it is re-registered as
 *   "not entered" (`.reveal-pending`), so entering again REPLAYS the animation.
 * - No flash on first paint: HTML never pre-hides; JS adds `.reveal-pending`
 *   only to elements currently out of view.
 * - Reduced-motion EXEMPT (user decision): the reveal must still play under
 *   prefers-reduced-motion; the CSS (landing-reveal.css) restores the real
 *   duration. This composable never blocks the animation.
 * - The footer is naturally excluded (it carries no data-reveal).
 */
export function useScrollReveal(root = document) {
  const state = new WeakMap() // element -> 'pending' | 'entered' | 'animating'
  let prevY = typeof window !== 'undefined' ? window.scrollY : 0
  let lastDir = 'none' // 'up' | 'down' | 'none'
  let raf = 0
  let io = null
  let scrollTimer = 0

  const ANIM_FALLBACK = 700 // ms, must exceed --dur-base (300ms); safety for background-tab animationend

  function onScroll() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const y = window.scrollY
      const d = y - prevY
      prevY = y
      if (d > 1) lastDir = 'up'
      else if (d < -1) lastDir = 'down'
    })
  }

  function clearAnimation(el) {
    el.classList.remove('reveal-in-up', 'reveal-in-down')
    clearTimeout(scrollTimer)
  }

  function finish(el) {
    clearAnimation(el)
    el.classList.remove('reveal-pending')
    state.set(el, 'entered')
  }

  function reRegister(el) {
    clearAnimation(el)
    el.classList.add('reveal-pending')
    state.set(el, 'pending')
  }

  function animateIn(el, dir) {
    const cls = dir === 'up' ? 'reveal-in-up' : 'reveal-in-down'
    el.classList.remove('reveal-pending')
    el.classList.add(cls)
    state.set(el, 'animating')
    const done = (e) => {
      if (e && e.target !== el) return
      el.removeEventListener('animationend', done)
      clearTimeout(scrollTimer)
      finish(el)
    }
    el.addEventListener('animationend', done)
    scrollTimer = setTimeout(() => done(), ANIM_FALLBACK)
  }

  function onEntry(entry) {
    const el = entry.target
    const st = state.get(el)
    if (entry.isIntersecting) {
      if (st === 'pending') {
        if (lastDir === 'none') finish(el)
        else animateIn(el, lastDir)
      }
      // 'entered'/'animating': ignore threshold wobble
    } else {
      // left the viewport (below threshold): re-register so entry replays
      if (st !== 'pending') reRegister(el)
    }
  }

  function setup() {
    const els = [...root.querySelectorAll('[data-reveal]')]
    if (!('IntersectionObserver' in window)) {
      // progressive enhancement: no IO -> everything stays visible
      for (const el of els) state.set(el, 'entered')
      return
    }
    io = new IntersectionObserver(
      (entries) => entries.forEach(onEntry),
      { threshold: 0.15 },
    )
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight && r.bottom > 0) {
        state.set(el, 'entered') // already in the initial viewport: no flash, no animation
      } else {
        el.classList.add('reveal-pending')
        state.set(el, 'pending')
      }
      io.observe(el)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  function destroy() {
    if (raf) cancelAnimationFrame(raf)
    if (scrollTimer) clearTimeout(scrollTimer)
    if (io) {
      io.disconnect()
      io = null
    }
    window.removeEventListener('scroll', onScroll)
  }

  setup()

  onBeforeUnmount(() => destroy())

  return { destroy }
}
