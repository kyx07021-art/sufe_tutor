<script>
import { h, Comment } from 'vue'

/**
 * PageEnter - M7-14 page-enter animation wrapper
 * -------------------------------------------------------
 * - Renders the default slot with every DIRECT child wrapped in a
 *   `.pe__child` block. On mount (or when `enabled` becomes true) a double rAF
 *   schedules the `.is-enter` class onto the wrapper; children then transition
 *   from opacity 0 + translateY(var(--reveal-y, 24px)) to opacity 1 / translateY(0),
 *   staggered top-to-bottom with `stagger` ms per child (second top bar first,
 *   then the card area).
 * - Double rAF (Vue's own Transition uses the same nextFrame): the first frame
 *   paints the hidden state, the second adds `.is-enter`, so the browser sees a
 *   real before/after style change and the fade-in always plays (a single rAF
 *   can land in the same frame as the initial paint and jump straight to final).
 * - Per-child delay is delivered through the `--enter-delay` custom property,
 *   set via Vue's `:style` binding (the CSP-safe CSSOM data channel; zero
 *   inline style literals). CSS transitions are scoped; the final state
 *   persists because `.is-enter` stays applied (fill-forward is inherent to
 *   transitions, no keyframes involved).
 * - `enabled=false` renders children fully visible with no transition; the
 *   prefers-reduced-motion block does the same, so the page never flashes.
 * - Zero inline event/style attrs, zero v-html, zero runtime style-element injection,
 *   zero raw CJK (contract 6); tokens only; the wrapper adds no horizontal
 *   layout, so 375px overflow is owned by the page's children.
 *
 * Render-function note: `<script setup>` cannot override render and a template
 * cannot wrap each slot vnode individually, so this component uses an options
 * render. Scoped CSS needs the vnode scopeId; the compiler injects
 * `__scopeId` on the options, applied to the vnodes this render creates.
 */
export default {
  name: 'PageEnter',
  props: {
    /** ms of extra delay per child (stagger interval), default 90 */
    stagger: { type: Number, default: 90 },
    /** when false, children show immediately with no enter animation */
    enabled: { type: Boolean, default: true },
  },
  data() {
    return { isEnter: false }
  },
  mounted() {
    if (this.enabled) this.play()
  },
  beforeUnmount() {
    this.stop()
  },
  watch: {
    enabled(v) {
      if (v) this.play()
      else this.stop()
    },
  },
  methods: {
    play() {
      this.stop()
      this._raf = requestAnimationFrame(() => {
        this._raf = requestAnimationFrame(() => {
          this._raf = 0
          this.isEnter = true
        })
      })
    },
    stop() {
      if (this._raf) {
        cancelAnimationFrame(this._raf)
        this._raf = 0
      }
      this.isEnter = false
    },
  },
  render() {
    const id = this.$options.__scopeId || null
    const stagger = this.stagger
    const raw = this.$slots.default ? this.$slots.default() : []
    const children = raw.filter((v) => v != null && v.type !== Comment)
    const wrap = (vn, i) => {
      const el = h(
        'div',
        {
          class: 'pe__child',
          style: { '--enter-delay': `${i * stagger}ms` },
        },
        [vn],
      )
      if (id) el.scopeId = id
      return el
    }
    const root = h(
      'div',
      {
        class: ['pe', { 'is-enter': this.isEnter, 'is-disabled': !this.enabled }],
      },
      children.map(wrap),
    )
    if (id) root.scopeId = id
    return root
  },
}
</script>

<style scoped>
.pe__child {
  opacity: 0;
  transform: translateY(var(--reveal-y, 24px));
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
  transition-delay: var(--enter-delay, 0ms);
}

.pe.is-enter .pe__child,
.pe.is-disabled .pe__child {
  opacity: 1;
  transform: translateY(0);
}

/* Animation disabled: jump straight to the final state. */
.pe.is-disabled .pe__child {
  transition: none;
}

/* Reduced motion: children visible immediately, no transition. */
@media (prefers-reduced-motion: reduce) {
  .pe__child {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
