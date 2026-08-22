<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { UiModalA1 } from '@/components/ui/index.js'
import { showToast } from '@/composables/useToast'
import { NOTIF_COPY } from '@/constants/m-notifications'
import { notifyState } from './data.js'
import { useReadSemantics } from './read.js'
import NotificationCard from './NotificationCard.vue'
import NotificationDetail from './NotificationDetail.vue'
import BlockSystemToggle from './BlockSystemToggle.vue'

/**
 * NotificationsModal - C3 notification modal A1 (assembly)
 * -------------------------------------------------------
 * - Modal A1 titled "notifications". Top: BlockSystemToggle (M5-03). Body: card B1 list
 *   (M5-02) with inset dividers, or the detail view (M5-05).
 * - Read semantics (M5-04): cards revealed in the scroll viewport are tracked;
 *   opening the detail marks the item read (single); closing the modal silently
 *   marks the revealed ones read (batch, rollback on failure).
 * - List/detail switch uses the mirrored nt-list / nt-detail slide transitions,
 *   clipped by the modal panel (overflow hidden).
 */
const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const items = computed(() => notifyState.items)
const loading = computed(() => notifyState.loading)
const error = computed(() => notifyState.error)

const view = ref('list')
const activeItem = ref(null)
const listRef = ref(null)
let io = null

const read = useReadSemantics({
  onError(e) {
    if (e && e.message) showToast(e.message)
  },
})

function setupReveal() {
  if (io) {
    io.disconnect()
    io = null
  }
  const list = listRef.value
  if (!list || typeof IntersectionObserver === 'undefined') return
  const root = list.closest('.ui-modala1__body')
  io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          const id = en.target.getAttribute('data-id')
          if (id) read.reveal(id)
        }
      }
    },
    root ? { root } : undefined,
  )
  list.querySelectorAll('[data-id]').forEach((el) => io.observe(el))
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      view.value = 'list'
      activeItem.value = null
      read.reset()
      await nextTick()
      setupReveal()
    } else {
      // silent batch read of the revealed notifications on exit (M5-04)
      read.markSeenRead()
    }
  },
)

watch(
  () => items.value.length,
  async () => {
    if (props.open && view.value === 'list') {
      await nextTick()
      setupReveal()
    }
  },
)

onBeforeUnmount(() => {
  if (io) io.disconnect()
})

function onCardOpen(item) {
  activeItem.value = item
  view.value = 'detail'
  read.markRead(item.id)
}

async function onBack() {
  view.value = 'list'
  await nextTick()
  setupReveal()
}
</script>

<template>
  <UiModalA1
    :open="open"
    :title="NOTIF_COPY.NOTIF_TITLE"
    width="420px"
    :close-on-outside="true"
    :close-on-esc="true"
    @close="emit('close')"
  >
    <div class="nt-modal">
      <div v-if="view === 'list'" class="nt-toggle">
        <BlockSystemToggle />
      </div>

      <p v-if="view === 'list' && loading" class="nt-state">{{ NOTIF_COPY.NOTIF_LOADING }}</p>
      <p v-else-if="view === 'list' && error" class="nt-state">{{ error }}</p>
      <p v-else-if="view === 'list' && items.length === 0" class="nt-state">{{ NOTIF_COPY.NOTIF_EMPTY }}</p>

      <Transition name="nt-list">
        <div
          v-if="view === 'list' && !loading && !error && items.length > 0"
          ref="listRef"
          class="nt-list"
        >
          <template v-for="(item, i) in items" :key="item.id">
            <div class="nt-card-wrap" :data-id="item.id">
              <NotificationCard :item="item" @open="onCardOpen(item)" />
            </div>
            <div v-if="i < items.length - 1" class="nt-divider" aria-hidden="true"></div>
          </template>
        </div>
      </Transition>

      <Transition name="nt-detail">
        <NotificationDetail
          v-if="view === 'detail'"
          :item="activeItem"
          @back="onBack"
        />
      </Transition>
    </div>
  </UiModalA1>
</template>

<style scoped>
.nt-modal {
  min-height: 160px;
}
.nt-toggle {
  padding: var(--space-2) var(--space-4) 0;
  display: flex;
  justify-content: flex-end;
}
.nt-state {
  padding: var(--space-6) var(--space-5);
  text-align: center;
  color: var(--gray-50);
  font-size: var(--fs-sm);
}
.nt-list {
  display: flex;
  flex-direction: column;
}
.nt-card-wrap {
  position: relative;
}
/* inset divider: does NOT touch the modal edges (plan C3) */
.nt-divider {
  height: 1px;
  background: var(--line);
  margin: 0 var(--space-4);
  flex: none;
}
/* list slide (mirror of detail): enter/leave to the left */
.nt-list-enter-active,
.nt-list-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}
.nt-list-enter-from {
  opacity: 0;
  transform: translateX(-40px);
}
.nt-list-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
@media (prefers-reduced-motion: reduce) {
  .nt-list-enter-active,
  .nt-list-leave-active {
    transition: none;
  }
  .nt-list-enter-from,
  .nt-list-leave-to {
    transform: none;
  }
}
</style>
