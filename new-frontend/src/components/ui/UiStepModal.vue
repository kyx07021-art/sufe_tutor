<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import UiModal from './UiModal.vue'
import UiButton from './UiButton.vue'
import UiCard from './UiCard.vue'
import { useScrollFade } from '@/composables/useScrollFade'
import { UI_COPY } from '@/constants/ui.js'

/**
 * UiStepModal - Step modal A (plan "modal styles - step modal A")
 * -------------------------------------------------------
 * - Multi-page step-by-step form; each page is packaged as card B; page-change animation (slide left/right in/out + fade, clipped at the modal edge).
 * - Top bar left 30%: step stage title (5% left inset, independent in/out animation + side masks);
 *   right 70%: step dot indicator (fixed-px dots, <= 4% width; current dot brand-bright, visited stays purple, unvisited gray-15, smooth color transition).
 * - Bottom two wide buttons: left button B1 with left arrow "prev" (grayed on first page), right brand-purple A1 "next" (last page becomes A without arrow "submit").
 *   Right button grays out = current page required fields incomplete (canNext, computed by module).
 * - Hidden page: does not count as a page, no dot; only reachable via buttons, enters from the right, exits to the right; enters/exits use the page-change animation;
 *   the dot stays on the original page; the bottom buttons fade out/in from the left when entering/leaving the hidden page (no bottom buttons inside the hidden page).
 * - All pages stay mounted via v-show (component instances preserved -> info input touched persists across pages).
 */
const props = defineProps({
  open: { type: Boolean, default: false },
  current: { type: Number, default: 0 },
  /** current hidden page name ('' = none); controlled by the module for enter/exit */
  hidden: { type: String, default: '' },
  pageCount: { type: Number, required: true },
  /** whether the current page's required fields are complete (the only condition for the right button gray-out) */
  canNext: { type: Boolean, default: true },
  pageTitles: { type: Array, default: () => [] },
  hiddenTitles: { type: Object, default: () => ({}) },
  nextText: { type: String, default: '' },
  closeOnOutside: { type: Boolean, default: false },
  width: { type: String, default: '' },
})

const emit = defineEmits([
  'update:open', 'update:current', 'update:hidden',
  'next', 'prev', 'submit', 'close',
])

const STEP_MS = 320

const stageRef = ref(null)
const leaving = ref(null)   // page id 'p-0' / 'h-name'
const entering = ref(null)
const animDir = ref('next')
const transitioning = ref(false)
const footerAnim = ref('')  // 'leave' | 'enter' | ''
const maxReached = ref(0)
let pageObserver = null

const fade = useScrollFade(stageRef)

const activeId = computed(() => (props.hidden ? 'h-' + props.hidden : 'p-' + props.current))

/** hidden page containers to render (current hidden page + the one leaving) */
const hiddenContainers = computed(() => {
  const set = new Set()
  if (props.hidden) set.add(props.hidden)
  if (leaving.value && leaving.value.startsWith('h-')) set.add(leaving.value.slice(2))
  if (entering.value && entering.value.startsWith('h-')) set.add(entering.value.slice(2))
  return [...set]
})

function pageShown(id) {
  return id === activeId.value || id === leaving.value || id === entering.value
}
function pageAnimClass(id) {
  if (id === entering.value) return `ui-step__page--enter-${animDir.value}`
  if (id === leaving.value) return `ui-step__page--leave-${animDir.value}`
  return ''
}

const isLast = computed(() => props.current >= props.pageCount - 1)
const canGoPrev = computed(() => props.current > 0)
const currentTitle = computed(() =>
  props.hidden ? props.hiddenTitles[props.hidden] || '' : props.pageTitles[props.current] || '',
)
const titleKey = computed(() => (props.hidden ? 'h-' + props.hidden : 'p-' + props.current))

const footerVisible = computed(() => !props.hidden || footerAnim.value === 'leave')
const footerClass = computed(() => {
  if (footerAnim.value === 'enter') return 'ui-step__footer--enter'
  if (footerAnim.value === 'leave') return 'ui-step__footer--leave'
  return ''
})

function dotClass(i) {
  const isCurrent = !props.hidden && props.current === i
  const visited = i <= maxReached.value
  return {
    'is-current': isCurrent,
    'is-visited': visited && !isCurrent,
    'is-dim': !visited,
  }
}

/** stage height = max content height among currently visible (active/leaving/entering) pages */
function syncHeight() {
  const stage = stageRef.value
  if (!stage) return
  let h = 0
  stage.querySelectorAll('.ui-step__page').forEach((p) => {
    if (p.style.display !== 'none') h = Math.max(h, p.offsetHeight)
  })
  stage.style.height = (h > 0 ? h : 0) + 'px'
}

function observePages() {
  const stage = stageRef.value
  if (!stage) return
  if (pageObserver) pageObserver.disconnect()
  if (typeof ResizeObserver === 'undefined') return
  pageObserver = new ResizeObserver(() => syncHeight())
  stage.querySelectorAll('.ui-step__page').forEach((p) => pageObserver.observe(p))
}

function endTransition() {
  leaving.value = null
  entering.value = null
  transitioning.value = false
  footerAnim.value = ''
  if (stageRef.value) stageRef.value.scrollTop = 0
  syncHeight()
  observePages()
}

function animatePage(dir, target) {
  if (transitioning.value) return
  const oldId = activeId.value
  leaving.value = oldId
  entering.value = target.id
  animDir.value = dir
  transitioning.value = true
  if (target.current !== undefined) emit('update:current', target.current)
  if (target.hidden !== undefined) emit('update:hidden', target.hidden)
  if (target.hidden) footerAnim.value = 'leave'
  else if (oldId.startsWith('h-')) footerAnim.value = 'enter'
  window.setTimeout(endTransition, STEP_MS)
}

function goNext() {
  if (!props.canNext || transitioning.value) return
  if (isLast.value) {
    emit('submit')
    return
  }
  const next = props.current + 1
  animatePage('next', { id: 'p-' + next, current: next })
  emit('next', next)
}

function goPrev() {
  if (transitioning.value) return
  if (props.hidden) {
    animatePage('prev', { id: 'p-' + props.current, hidden: '' })
    emit('prev')
    return
  }
  if (props.current <= 0) return
  const prev = props.current - 1
  animatePage('prev', { id: 'p-' + prev, current: prev })
  emit('prev', prev)
}

function enterHidden(name) {
  if (transitioning.value || !name) return
  animatePage('next', { id: 'h-' + name, hidden: name })
}

function close() {
  emit('close')
  emit('update:open', false)
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      maxReached.value = props.current
      leaving.value = null
      entering.value = null
      transitioning.value = false
      footerAnim.value = ''
      await nextTick()
      syncHeight()
      observePages()
    } else if (pageObserver) {
      pageObserver.disconnect()
      pageObserver = null
    }
  },
)

watch(
  () => props.current,
  (v) => {
    if (v > maxReached.value) maxReached.value = v
  },
)

onBeforeUnmount(() => {
  if (pageObserver) pageObserver.disconnect()
})

defineExpose({ goNext, goPrev, enterHidden })
</script>

<template>
  <UiModal
    :open="open"
    :label="currentTitle"
    :width="width"
    :close-on-outside="closeOnOutside"
    :close-on-esc="false"
    @close="close"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="ui-step">
      <header class="ui-step__bar">
        <div class="ui-step__title-zone">
          <Transition :name="`ui-step-title-${animDir}`" mode="out-in">
            <h2 :key="titleKey" class="ui-step__title">{{ currentTitle }}</h2>
          </Transition>
          <div v-if="transitioning" class="ui-step__title-mask ui-step__title-mask--left" aria-hidden="true"></div>
          <div v-if="transitioning" class="ui-step__title-mask ui-step__title-mask--right" aria-hidden="true"></div>
        </div>
        <div class="ui-step__dots">
          <span
            v-for="i in pageCount"
            :key="i"
            class="ui-step__dot"
            :class="dotClass(i - 1)"
          ></span>
        </div>
      </header>

      <div ref="stageRef" class="ui-step__stage" :class="{ 'is-transitioning': transitioning }">
        <div
          v-for="n in pageCount"
          :key="'p-' + (n - 1)"
          class="ui-step__page"
          :class="pageAnimClass('p-' + (n - 1))"
          :style="{ display: pageShown('p-' + (n - 1)) ? null : 'none' }"
        >
          <UiCard variant="B" class="ui-step__page-card">
            <slot :name="'page-' + (n - 1)" />
          </UiCard>
        </div>

        <div
          v-for="hn in hiddenContainers"
          :key="'h-' + hn"
          class="ui-step__page"
          :class="pageAnimClass('h-' + hn)"
          :style="{ display: pageShown('h-' + hn) ? null : 'none' }"
        >
          <UiCard variant="B" class="ui-step__page-card">
            <slot :name="'hidden-' + hn" />
          </UiCard>
        </div>

        <div v-if="transitioning" class="ui-step__stage-mask ui-step__stage-mask--left" aria-hidden="true"></div>
        <div v-if="transitioning" class="ui-step__stage-mask ui-step__stage-mask--right" aria-hidden="true"></div>

        <div v-if="fade.scrollable.value && !fade.atTop.value" class="ui-step__scroll-mask ui-step__scroll-mask--top" aria-hidden="true"></div>
        <div v-if="fade.scrollable.value && !fade.atBottom.value" class="ui-step__scroll-mask ui-step__scroll-mask--bottom" aria-hidden="true"></div>
      </div>

      <footer
        class="ui-step__footer"
        :class="footerClass"
        :style="{ display: footerVisible ? null : 'none' }"
      >
        <UiButton variant="B1" arrow="left" :disabled="!canGoPrev" @click="goPrev">
          {{ UI_COPY.STEP_PREV }}
        </UiButton>
        <UiButton
          :variant="isLast ? 'A' : 'A1'"
          :arrow="isLast ? 'none' : 'right'"
          fill="brand"
          :disabled="!canNext"
          @click="goNext"
        >
          {{ isLast ? nextText || UI_COPY.STEP_SUBMIT : UI_COPY.STEP_NEXT }}
        </UiButton>
      </footer>
    </div>
  </UiModal>
</template>

<style scoped>
.ui-step {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: 82vh;
}

/* -- top bar -- */
.ui-step__bar {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: 30% 70%;
  align-items: center;
  height: var(--modala1-bar-h, 52px);
  box-sizing: border-box;
  background: var(--paper-raised);
}

/* left 30%: title (5% left inset) + page-change side masks */
.ui-step__title-zone {
  position: relative;
  grid-column: 1;
  padding-left: 5%;
  overflow: hidden;
  align-self: stretch;
  display: flex;
  align-items: center;
}
.ui-step__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ui-step__title-mask {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--modal-mask-h);
  pointer-events: none;
}
.ui-step__title-mask--left {
  left: 0;
  background: linear-gradient(to right, var(--paper-raised), transparent);
}
.ui-step__title-mask--right {
  right: 0;
  background: linear-gradient(to left, var(--paper-raised), transparent);
}
.ui-step-title-next-enter-active,
.ui-step-title-next-leave-active,
.ui-step-title-prev-enter-active,
.ui-step-title-prev-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-step-title-next-enter-from { opacity: 0; transform: translateX(28px); }
.ui-step-title-next-leave-to { opacity: 0; transform: translateX(-28px); }
.ui-step-title-prev-enter-from { opacity: 0; transform: translateX(-28px); }
.ui-step-title-prev-leave-to { opacity: 0; transform: translateX(28px); }

/* right 70%: dots */
.ui-step__dots {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10%;
}
.ui-step__dot {
  flex: none;
  width: var(--step-dot, 10px);
  height: var(--step-dot, 10px);
  border-radius: 50%;
  background: var(--gray-15);
  transition: background-color var(--dur-sm) var(--ease-out), transform var(--dur-sm) var(--ease-out);
}
.ui-step__dot.is-visited { background: var(--brand); }
.ui-step__dot.is-current {
  background: var(--brand-bright);
  transform: scale(1.18);
}
.ui-step__dot.is-dim { background: var(--gray-15); }

/* -- body (height set by syncHeight measuring page content; pages absolutely positioned, animation clipped at the edge) -- */
.ui-step__stage {
  position: relative;
  flex: 0 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--paper-raised);
}
.ui-step__page {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.ui-step__page-card {
  padding: var(--space-5);
  background: transparent;
}

/* page-change animation */
.ui-step__page--enter-next { animation: ui-step-enter-next var(--dur-base) var(--ease-out); }
.ui-step__page--leave-next { animation: ui-step-leave-next var(--dur-base) var(--ease-in); }
.ui-step__page--enter-prev { animation: ui-step-enter-prev var(--dur-base) var(--ease-out); }
.ui-step__page--leave-prev { animation: ui-step-leave-prev var(--dur-base) var(--ease-in); }
@keyframes ui-step-enter-next {
  from { transform: translateX(28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes ui-step-leave-next {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-28px); opacity: 0; }
}
@keyframes ui-step-enter-prev {
  from { transform: translateX(-28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes ui-step-leave-prev {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(28px); opacity: 0; }
}

/* left/right edge fade masks during page change */
.ui-step__stage-mask {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--modal-mask-h);
  pointer-events: none;
  z-index: 5;
}
.ui-step__stage-mask--left {
  left: 0;
  background: linear-gradient(to right, var(--paper-raised), transparent);
}
.ui-step__stage-mask--right {
  right: 0;
  background: linear-gradient(to left, var(--paper-raised), transparent);
}

/* top/bottom fade masks when the body is scrollable */
.ui-step__scroll-mask {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--modal-mask-h);
  pointer-events: none;
}
.ui-step__scroll-mask--top {
  top: 0;
  background: linear-gradient(to bottom, var(--paper-raised), transparent);
}
.ui-step__scroll-mask--bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--paper-raised), transparent);
}

/* -- bottom buttons -- */
.ui-step__footer {
  position: relative;
  z-index: 2;
  display: flex;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4) var(--space-4);
  background: var(--paper-raised);
}
.ui-step__footer :deep(.ui-btn) { flex: 1 1 0; min-width: 0; }

.ui-step__footer--enter { animation: ui-step-footer-in var(--dur-base) var(--ease-out); }
.ui-step__footer--leave { animation: ui-step-footer-out var(--dur-base) var(--ease-in); }
@keyframes ui-step-footer-in {
  from { transform: translateX(-28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes ui-step-footer-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-28px); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-step__page,
  .ui-step__title,
  .ui-step__footer { animation: none; transition: none; }
}
</style>
