/**
 * useScrollDetach.js - M7-16 card scroll-detach animation.
 *
 * A card near the visible list center stays put; as it scrolls past the center
 * its vertical displacement grows linearly (RELU shape), accelerating its
 * departure from the visible area. Cards above the center translate up, cards
 * below translate down. Displacement is written to the card's --detach-y CSS
 * variable through the CSSOM (CSP-safe), consumed by TeacherCard's transform.
 */

import { onMounted, onUnmounted } from 'vue';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Pure displacement value in pixels.
 *
 * formula: sign * factor * max(0, |cardCenterY - areaCenterY| - const)
 * sign is -1 when the card center sits above the area center, +1 when below.
 */
export function reluDisplacement(cardCenterY, areaCenterY, { const: C = 120, factor = 0.3 } = {}) {
  const gap = Math.abs(cardCenterY - areaCenterY) - C;
  if (gap <= 0) return 0;
  const sign = cardCenterY < areaCenterY ? -1 : 1;
  return sign * factor * gap;
}

function isVueRef(target) {
  return (
    target !== null &&
    typeof target === 'object' &&
    !('nodeType' in target) &&
    'value' in target
  );
}

function unwrap(target) {
  return isVueRef(target) ? target.value : target;
}

function rectCenterY(rect) {
  return rect.top + rect.height / 2;
}

function readCardCenterY(card) {
  return rectCenterY(card.getBoundingClientRect());
}

function readAreaCenterY(target) {
  if (target === window) {
    return window.innerHeight / 2;
  }
  return rectCenterY(target.getBoundingClientRect());
}

function normalizeContainer(container) {
  if (container === window) return window;
  if (
    container &&
    typeof container.getBoundingClientRect === 'function' &&
    typeof container.addEventListener === 'function'
  ) {
    return container;
  }
  return window;
}

/**
 * Vue composable: attach a passive scroll listener that drives the card's
 * --detach-y variable. rAF-throttled (one rAF per scroll frame); listener and
 * pending rAF are removed on unmount (no leaks). Honors prefers-reduced-motion
 * by pinning --detach-y to 0px and skipping the listener.
 */
export function useScrollDetach({ el, container, const: C = 120, factor = 0.3 }) {
  const hasWindow = typeof window !== 'undefined';
  const scrollTarget = hasWindow ? normalizeContainer(container === undefined ? window : container) : null;

  let rafPending = false;
  let rafId = 0;
  let scrollHandler = null;

  onMounted(() => {
    if (!hasWindow || !scrollTarget) return;

    const card = unwrap(el);
    const media = window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY) : null;

    if (media && media.matches) {
      if (card && card.style) {
        card.style.setProperty('--detach-y', '0px');
      }
      return;
    }

    const runUpdate = () => {
      rafPending = false;
      rafId = 0;
      const target = unwrap(el);
      if (!target || typeof target.getBoundingClientRect !== 'function') return;
      const cardCenterY = readCardCenterY(target);
      const areaCenterY = readAreaCenterY(scrollTarget);
      const px = reluDisplacement(cardCenterY, areaCenterY, { const: C, factor });
      target.style.setProperty('--detach-y', px + 'px');
    };

    const onScroll = () => {
      if (rafPending) return;
      rafPending = true;
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(runUpdate);
      } else {
        runUpdate();
      }
    };

    scrollHandler = onScroll;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });

    // Resolve the initial state so --detach-y matches the current position.
    runUpdate();
  });

  onUnmounted(() => {
    if (!hasWindow || !scrollTarget) return;
    if (rafPending && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    }
    if (scrollHandler) {
      scrollTarget.removeEventListener('scroll', scrollHandler);
    }
    const card = unwrap(el);
    if (card && card.style) {
      card.style.setProperty('--detach-y', '0px');
    }
  });
}
