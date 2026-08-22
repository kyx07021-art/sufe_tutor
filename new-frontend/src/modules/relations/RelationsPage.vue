<script setup>
/**
 * RelationsPage - M3-10 page assembly for the C1 relations module
 * -------------------------------------------------------
 * - Wires M3-01 (data) -> M3-03 (concentric layout) -> M3-02 (board) with
 *   M3-05 avatars, M3-06 dashed lines (+ M3-07 flow), M3-08 cards, M3-09 states.
 * - Resize recalcs radius (module decision 6); flow class toggled by
 *   prefers-reduced-motion (JS only toggles classes, animation in CSS).
 * - F4 refined card placement: a pure planner (planRelationCards) decides the
 *   fitted card width from the tightest of (max, center clearance, adjacent
 *   chord). When the fitted width stays at or above CARD_W_MIN the cards float
 *   at each dashed-edge midpoint ('midpoint' mode); otherwise they render as a
 *   vertical list below the board ('list' mode). The width is NEVER clamped up
 *   to a floor, and the mode is gated by geometry, not by a viewport
 *   breakpoint.
 * - leave cleanup: ResizeObserver + pending state are torn down (F3).
 * - `self` prop: the current user (M2 authStore supplies it once built);
 *   defaults to a neutral self node so the page renders standalone.
 */
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import RelationsBoard from './RelationsBoard.vue'
import RelationAvatar from './RelationAvatar.vue'
import RelationLines from './RelationLines.vue'
import RelationCard from './RelationCard.vue'
import RelationsStates from './RelationsStates.vue'
import { fetchMyRelations } from './data.js'
import { layoutCircle } from './layout.js'
import { planRelationCards } from './card-layout.js'
import { isFlowAllowed } from './flow.js'
import { RELATIONS_COPY, RELATIONS_GEOMETRY } from '@/constants/m-relations.js'
import './flow.css'

const props = defineProps({
  /** Current user for the center (self) avatar. M2 passes the real user later. */
  self: {
    type: Object,
    default: () => ({ name: RELATIONS_COPY.SELF_NAME, avatar: '' }),
  },
})

const emit = defineEmits(['open-conversation', 'open-profile'])

// --- responsive geometry: narrow viewports (< COMPACT_BREAKPOINT) use compact
//     avatar sizes so the concentric ring + avatars fit inside 375px without
//     horizontal overflow; the stage also shrinks so the card list peeks below.
const compact = ref(typeof window !== 'undefined' ? window.innerWidth < RELATIONS_GEOMETRY.COMPACT_BREAKPOINT : false)
const SELF_D = computed(() => (compact.value ? RELATIONS_GEOMETRY.SELF_D_COMPACT : RELATIONS_GEOMETRY.SELF_D))
const OTHER_D = computed(() => (compact.value ? RELATIONS_GEOMETRY.OTHER_D_COMPACT : RELATIONS_GEOMETRY.OTHER_D))
const RADIUS_MIN = computed(() => (compact.value ? RELATIONS_GEOMETRY.RADIUS_MIN_COMPACT : RELATIONS_GEOMETRY.RADIUS_MIN))

// --- page state ---
const phase = ref('loading') // 'loading' | 'error' | 'ready'
const errorMsg = ref('')
const model = ref(null) // { nodes, edges, total }

// Center (self) avatar node, derived reactively from the `self` prop so M2 can
// supply the real user (name/avatar) after auth without a page remount.
const selfNode = computed(() => ({
  userId: 0,
  role: 'student',
  name: (props.self && props.self.name) || RELATIONS_COPY.SELF_NAME,
  avatar: (props.self && props.self.avatar) || '',
  status: 'active',
  edgeCount: 0,
}))

const board = ref(null)
const boardSize = reactive({ w: 0, h: 0 })
const layout = ref(null)
const flowOn = ref(false)

let resizeObserver = null

// L5: guards ref writes after an awaited fetch against a page that already
// unmounted (teardown sets it BEFORE disconnecting the observer).
let disposed = false

const center = computed(() => ({ x: boardSize.w / 2, y: boardSize.h / 2 }))
const radius = computed(() => {
  const fit = Math.min(boardSize.w, boardSize.h) / 2 - OTHER_D.value / 2 - RELATIONS_GEOMETRY.EDGE_MARGIN
  return Math.max(RADIUS_MIN.value, fit)
})

// --- derived render data ---
const positions = computed(() => (layout.value ? layout.value.positions : []))

const segments = computed(() =>
  positions.value.map((p) => ({
    from: { x: p.x, y: p.y },
    to: center.value,
    edgeCount: p.node.edgeCount,
  })),
)

// F4 refined: planRelationCards computes the fitted card width (never clamped
// up) and the mode gate. 'midpoint' floats one card per node at the dashed-edge
// midpoint; 'list' renders the same sessions as a vertical list below the board.
const cardPlan = computed(() => {
  if (!positions.value.length) return { mode: 'list', cardWidth: RELATIONS_GEOMETRY.CARD_W, cards: [] }
  return planRelationCards(positions.value, {
    center: center.value,
    radius: radius.value,
    selfDiameter: SELF_D.value,
    cardWidthMax: RELATIONS_GEOMETRY.CARD_W,
    cardWidthMin: RELATIONS_GEOMETRY.CARD_W_MIN,
    gap: RELATIONS_GEOMETRY.CARD_GAP,
  })
})

const floatMode = computed(() => cardPlan.value.mode === 'midpoint')

const isEmpty = computed(() => phase.value === 'ready' && model.value && model.value.total === 0)

// --- data lifecycle ---
async function load() {
  phase.value = 'loading'
  errorMsg.value = ''
  try {
    const result = await fetchMyRelations()
    if (disposed) return
    model.value = result
    if (disposed) return
    phase.value = 'ready'
    if (disposed) return
    // The stage wrapper is only rendered by the ready (non-empty) branch, so it
    // does not exist at mount. Measure + observe it after this render flush.
    await nextTick()
    measureBoard()
  } catch (err) {
    if (disposed) return
    errorMsg.value = err && err.message ? err.message : String(err)
    phase.value = 'error'
  }
}

function retry() {
  load()
}

// --- geometry ---
function computeLayout() {
  if (!model.value || boardSize.w === 0 || boardSize.h === 0) return
  layout.value = layoutCircle(model.value.nodes, {
    radius: radius.value,
    center: center.value,
    avatarDiameter: OTHER_D.value,
  })
}

// Measure the board (a NATIVE element ref) and keep it observed for resizes.
// `compact` is refreshed from the live viewport so the radius recomputes with the
// compact avatar sizes when the window crosses the breakpoint.
function measureBoard() {
  const el = board.value
  if (!el) return
  compact.value = window.innerWidth < RELATIONS_GEOMETRY.COMPACT_BREAKPOINT
  const rect = el.getBoundingClientRect()
  boardSize.w = rect.width
  boardSize.h = rect.height
  computeLayout()
  if (resizeObserver) resizeObserver.observe(el)
}

function onResize() {
  measureBoard()
}

function onOpenConversation(payload) {
  emit('open-conversation', payload && payload.conversationId)
}

/** Avatar click -> open the other user's profile (M7 wires the panel later). */
function onAvatarClick(userId) {
  emit('open-profile', userId)
}

// --- lifecycle ---
onMounted(() => {
  disposed = false
  flowOn.value = isFlowAllowed()
  if (typeof ResizeObserver !== 'undefined') resizeObserver = new ResizeObserver(onResize)
  load()
})

onBeforeUnmount(() => {
  // Set the disposed flag BEFORE disconnecting so an in-flight load() that
  // resolves during teardown cannot write to unmounted refs.
  disposed = true
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<template>
  <div class="relations-page" :class="{ 'relations-page--compact': compact }">
    <h1 class="relations-page__title">{{ RELATIONS_COPY.PAGE_TITLE }}</h1>

    <RelationsStates
      v-if="phase === 'loading' || phase === 'error' || isEmpty"
      :state="phase === 'loading' ? 'loading' : phase === 'error' ? 'error' : 'empty'"
      :message="phase === 'error' ? errorMsg : ''"
      @retry="retry"
    />

    <template v-else>
      <!-- The stage is a NATIVE element ref: the page measures it to derive
           center/radius, then RelationsBoard mirrors that measured size via its
           `size` prop. A ref on the <RelationsBoard> COMPONENT would return the
           component instance (not a DOM element), so getBoundingClientRect /
           ResizeObserver.observe could not run on it. -->
      <div ref="board" class="relations-page__stage">
        <RelationsBoard
          :center="center"
          :radius="radius"
          :size="boardSize"
          class="relations-board--root"
          :class="{ 'is-flowing': flowOn }"
        >
          <template #lines>
            <RelationLines :segments="segments" :size="boardSize" />
          </template>
          <template #avatars>
            <RelationAvatar
              :node="selfNode"
              :x="center.x"
              :y="center.y"
              :diameter="SELF_D"
              :is-self="true"
              @click="onAvatarClick(selfNode.userId)"
            />
            <RelationAvatar
              v-for="pos in positions"
              :key="pos.node.userId"
              :node="pos.node"
              :x="pos.x"
              :y="pos.y"
              :diameter="OTHER_D"
              @click="onAvatarClick(pos.node.userId)"
            />
          </template>
          <template v-if="floatMode" #cards>
            <RelationCard
              v-for="(slot, i) in cardPlan.cards"
              :key="positions[i].node.userId"
              :edge="positions[i].node.edges[0]"
              :x="slot.x"
              :y="slot.y"
              :width="slot.width"
              @open="onOpenConversation"
            />
          </template>
        </RelationsBoard>
      </div>

      <!-- Card list (below the board, vertical stack): when the board cannot
           fit readable midpoint cards (floatMode false), the same sessions
           render here. Every card shows the other user's name above the button
           (list cards lack the avatar's disambiguation). -->
      <div
        v-if="!floatMode"
        class="relations-page__cards"
        role="region"
        :aria-label="RELATIONS_COPY.SESSION_LIST_TITLE"
      >
        <h2 class="relations-page__cards-title">{{ RELATIONS_COPY.SESSION_LIST_TITLE }}</h2>
        <RelationCard
          v-for="pos in positions"
          :key="pos.node.userId"
          :edge="pos.node.edges[0]"
          layout="list"
          :width="RELATIONS_GEOMETRY.CARD_W"
          @open="onOpenConversation"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.relations-page {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  padding: var(--space-5) var(--space-3) var(--space-6);
  overflow: hidden;
}
.relations-page__title {
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--ink);
  margin-bottom: var(--space-4);
}
.relations-page__stage {
  position: relative;
  width: 100%;
  /* Module single source: --relations-stage-h (the bare 120px offset below the
     page top lives only here; consumers use the variable). */
  --relations-stage-h: calc(100vh - 120px);
  height: var(--relations-stage-h);
  min-height: 420px;
  border-radius: var(--radius-lg);
  overflow: hidden;
}
/* Compact (narrow viewport): shrink the stage so the card list below it peeks
   into view on mobile. */
.relations-page--compact .relations-page__stage {
  height: 360px;
  min-height: 0;
}
/* Card list (below the board): vertical stack so every card is visible without
   horizontal scrolling. */
.relations-page__cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4) 0 0;
}
.relations-page__cards-title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--ink);
}
</style>
