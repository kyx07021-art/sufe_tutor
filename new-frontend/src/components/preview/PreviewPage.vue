<script setup>
// NOTE: This page is dev-only (M0 showcase). All labels below are demo values,
// not user-facing copy; real copy lives in constants/ui.js or module text sources.
import { ref } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiCard from '@/components/ui/UiCard.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiDropdown from '@/components/ui/UiDropdown.vue'
import UiCheckButton from '@/components/ui/UiCheckButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiCaptchaInput from '@/components/ui/UiCaptchaInput.vue'
import UiComboInput from '@/components/ui/UiComboInput.vue'
import UiVariableInputSet from '@/components/ui/UiVariableInputSet.vue'
import UiFieldInput from '@/components/ui/UiFieldInput.vue'
import UiFieldDisplay from '@/components/ui/UiFieldDisplay.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiModalA1 from '@/components/ui/UiModalA1.vue'
import UiConfirmModalA1 from '@/components/ui/UiConfirmModalA1.vue'
import UiStepModal from '@/components/ui/UiStepModal.vue'
import UiAlertModal from '@/components/ui/UiAlertModal.vue'
import UiText from '@/components/ui/UiText.vue'
import UiToast from '@/components/ui/UiToast.vue'
import { showToast } from '@/composables/useToast'
import { iconRegistry } from '@/components/ui/icons.js'

/* -- modal state -- */
const modalA = ref(false)
const modalA1 = ref(false)
const confirmModal = ref(false)
const alertModal = ref(false)
const alertDanger = ref(false)
const stepModal = ref(false)
const stepCurrent = ref(0)
const stepHidden = ref('')
const stepTitle = ref('')
const stepRef = ref(null)

/* -- form state -- */
const dropVal = ref('')
const dropBVal = ref('')
const checkVal = ref(false)
const checkBVal = ref(false)
const inputVal = ref('')
const numVal = ref('')
const captchaVal = ref('')
const comboVal = ref('')
const varSet = ref([''])
const step0Val = ref('')
const step1Val = ref('')

const provinces = [
  { label: 'Shanghai', value: 'shanghai' },
  { label: 'Beijing', value: 'beijing' },
  { label: 'Zhejiang', value: 'zhejiang' },
  { label: 'Jiangsu', value: 'jiangsu' },
  { label: 'Guangdong', value: 'guangdong' },
  { label: 'Hubei', value: 'hubei' },
]
const subjects = [
  'Chinese', 'Math', 'English', 'Physics', 'Chemistry', 'Biology',
  'History', 'Geography', 'Politics', 'Piano', 'Painting', 'Programming',
  'Go', 'Calligraphy', 'Dance', 'Vocal',
]

const canNext = ref(false)
function refreshCanNext() {
  canNext.value = step0Val.value.trim().length > 0 && step1Val.value.trim().length > 0
}

const iconsList = Object.keys(iconRegistry)

function openStep() {
  stepCurrent.value = 0
  stepHidden.value = ''
  stepTitle.value = '1. Cooperation'
  stepModal.value = true
}
function onStepNext(n) {
  const titles = ['1. Cooperation', '2. Teaching info', '3. Fee plan']
  stepTitle.value = titles[n] || ''
}
function enterStepHidden() {
  stepRef.value && stepRef.value.enterHidden('remark')
}
function leaveStepHidden() {
  stepRef.value && stepRef.value.goPrev()
}
</script>

<template>
  <div class="pv">
    <h1 class="pv__title">M0 Component Base Layer · Review</h1>
    <p class="pv__sub">tokens single source / buttons A·A1·B·B1·B2·C·C1·S·S1 / card / dropdown / check / input / modal / text</p>

    <!-- === buttons === -->
    <section class="pv__sec">
      <h2 class="pv__h">Buttons</h2>
      <div class="pv__row">
        <UiButton>A</UiButton>
        <UiButton variant="A1">A1 Next</UiButton>
        <UiButton variant="B">B</UiButton>
        <UiButton variant="B1">B1</UiButton>
        <UiButton variant="B2">B2 Details</UiButton>
        <UiButton variant="C">C</UiButton>
        <UiButton variant="C1">C1</UiButton>
      </div>
      <div class="pv__row">
        <UiButton disabled>disabled</UiButton>
        <UiButton variant="A1" disabled>disabled A1</UiButton>
        <UiButton fill="brand">Brand A</UiButton>
        <UiButton variant="A1" fill="brand">Brand A1</UiButton>
        <UiButton fill="danger">Danger A</UiButton>
        <UiButton variant="A1" fill="brand" disabled>disabled brand</UiButton>
      </div>
      <div class="pv__row">
        <UiButton variant="S">Button S</UiButton>
        <UiButton variant="S1">Button S1 underline</UiButton>
        <UiButton variant="B" circle><UiIcon name="close" :size="16" /></UiButton>
        <UiButton variant="B" circle size="sm"><UiIcon name="plus" :size="14" /></UiButton>
        <UiButton size="sm" fill="brand">Small button</UiButton>
        <UiButton size="lg" variant="A1" fill="brand">Big button</UiButton>
      </div>
    </section>

    <!-- === cards === -->
    <section class="pv__sec">
      <h2 class="pv__h">Cards</h2>
      <div class="pv__row pv__row--cards">
        <UiCard variant="A" class="pv__card"><div class="pv__card-body">Card A<br />white · thin border</div></UiCard>
        <UiCard variant="A1" class="pv__card" @click="showToast('Card A1 clicked')"><div class="pv__card-body">Card A1<br />interactive (ripple)</div></UiCard>
        <UiCard variant="B" class="pv__card"><div class="pv__card-body">Card B<br />no border</div></UiCard>
        <UiCard variant="B1" class="pv__card" @click="showToast('Card B1 clicked')"><div class="pv__card-body">Card B1<br />borderless interactive</div></UiCard>
      </div>
    </section>

    <!-- === dropdown button + panel === -->
    <section class="pv__sec">
      <h2 class="pv__h">Dropdown Button / Panel</h2>
      <div class="pv__row">
        <UiDropdown v-model="dropVal" variant="A" :options="provinces" placeholder="Select a province" class="pv__ctrl" />
        <UiDropdown v-model="dropBVal" variant="B" :options="subjects" placeholder="Select a subject (multi-col)" class="pv__ctrl" />
      </div>
    </section>

    <!-- === check button === -->
    <section class="pv__sec">
      <h2 class="pv__h">Check Button</h2>
      <div class="pv__row">
        <UiCheckButton v-model="checkVal" variant="A" label="Check button A" checked-label="Selected A" />
        <UiCheckButton v-model="checkBVal" variant="B" label="Check button B" />
      </div>
    </section>

    <!-- === input === -->
    <section class="pv__sec">
      <h2 class="pv__h">Input</h2>
      <div class="pv__col">
        <UiInput v-model="inputVal" placeholder="Input A (Enter sends)" max-length="70" class="pv__ctrl" @send="showToast('Sent: ' + inputVal)" />
        <UiInput v-model="numVal" placeholder="Digits only" filter="digits" max-length="6" class="pv__ctrl" />
      </div>
      <div class="pv__row pv__mt">
        <UiCaptchaInput v-model="captchaVal" placeholder="Enter the code" class="pv__ctrl--w300" auto-countdown @send="showToast('send event')" />
      </div>
      <div class="pv__row pv__mt">
        <UiComboInput v-model="comboVal" :options="provinces" placeholder="Combo input A (optional)" class="pv__ctrl--w300" />
      </div>
    </section>

    <!-- === variable input set === -->
    <section class="pv__sec">
      <h2 class="pv__h">Variable Input Set A</h2>
      <div class="pv__col pv__col--w380">
        <UiVariableInputSet v-model="varSet" :input-component="UiInput" :input-props="{ placeholder: 'Type a line', width: '100%' }" />
      </div>
    </section>

    <!-- === info input area / info display area === -->
    <section class="pv__sec">
      <h2 class="pv__h">Info Input Area A / Info Display Area A</h2>
      <div class="pv__col pv__col--w520">
        <UiFieldInput title="Teaching content" required :filled="inputVal.trim().length > 0">
          <UiInput v-model="inputVal" placeholder="Subject, content and teaching plan" max-length="80" />
        </UiFieldInput>
        <UiFieldInput title="Teaching method" required :filled="dropVal !== ''">
          <UiDropdown v-model="dropVal" variant="B" :options="['Online', 'Offline']" placeholder="Select" />
        </UiFieldInput>
        <UiFieldInput title="Lesson schedule" :filled="varSet[0] !== ''">
          <UiVariableInputSet v-model="varSet" :input-component="UiInput" :input-props="{ placeholder: 'e.g. Monday 2-4 PM', width: '100%' }" />
        </UiFieldInput>
        <UiFieldDisplay
          :items="[
            { label: 'Price', value: '200~300 CNY/hour' },
            { label: 'Address', value: 'Wujiaochang Street, Yangpu District, Shanghai' },
            { label: 'Availability', value: 'Every Sunday 2 PM - 4 PM' },
          ]"
        />
      </div>
    </section>

    <!-- === modals === -->
    <section class="pv__sec">
      <h2 class="pv__h">Modals</h2>
      <div class="pv__row">
        <UiButton @click="modalA = true">Modal A</UiButton>
        <UiButton variant="A1" @click="modalA1 = true">Modal A1</UiButton>
        <UiButton variant="A1" fill="brand" @click="confirmModal = true">Confirm Modal A1</UiButton>
        <UiButton fill="brand" @click="alertModal = true">Confirm Modal A</UiButton>
        <UiButton fill="danger" @click="alertDanger = true">Confirm Modal A danger</UiButton>
        <UiButton variant="A1" fill="brand" @click="openStep">Step Modal A</UiButton>
      </div>
    </section>

    <!-- === text block === -->
    <section class="pv__sec">
      <h2 class="pv__h">Text Block Component</h2>
      <div class="pv__col pv__col--w520">
        <UiText text="This platform provides valid, convenient and secure e-contract signing; using it is entirely your choice.\nSecond paragraph: before drafting an e-contract, make sure you have agreed with the other party on the service details." />
        <UiText text="Ellipsis mode: this paragraph gets truncated and the overflow is shown with an ellipsis, no wrapping." :wrap="false" :max-chars="30" color="var(--gray-60)" />
        <UiText text="Gray-75 info text: text used for displaying information, color controlled by tokens." color="var(--gray-75)" size="var(--fs-sm)" />
      </div>
    </section>

    <!-- === icons === -->
    <section class="pv__sec">
      <h2 class="pv__h">SVG Icon Library (UiIcon name)</h2>
      <div class="pv__icons">
        <div v-for="name in iconsList" :key="name" class="pv__icon-cell">
          <UiIcon :name="name" :size="22" />
          <span class="pv__icon-name">{{ name }}</span>
        </div>
      </div>
    </section>

    <!-- ============ modal instances ============ -->

    <UiModal v-model:open="modalA" label="Modal A demo">
      <div class="pv__demo-modal">
        <UiText text="Modal A - wide outer shadow, PC 30% / mobile 80%, click outside to close (enabled in this demo)." />
        <div class="pv__row pv__mt">
          <UiButton @click="modalA = false">Close</UiButton>
        </div>
      </div>
    </UiModal>

    <UiModalA1 v-model:open="modalA1" title="Modal A1">
      <div class="pv__demo-modal">
        <UiText :text="'Top bar + X + scroll mask. ' + 'Scroll down to see the mask effect. '.repeat(80)" />
      </div>
    </UiModalA1>

    <UiConfirmModalA1 v-model:open="confirmModal" title="Confirm important info" :countdown="5">
      <UiText :text="'Please read the following carefully. ' + 'Scroll to the bottom to confirm. '.repeat(60)" />
    </UiConfirmModalA1>

    <UiAlertModal v-model:open="alertModal" message="Start a trial lesson?" @confirm="showToast('Confirmed')" />
    <UiAlertModal v-model:open="alertDanger" danger message="Delete this review? It cannot be undone." @confirm="showToast('Deleted')" />

    <UiStepModal
      ref="stepRef"
      v-model:open="stepModal"
      v-model:current="stepCurrent"
      v-model:hidden="stepHidden"
      :page-count="3"
      :can-next="canNext"
      :page-titles="['1. Cooperation', '2. Teaching info', '3. Fee plan']"
      :hidden-titles="{ remark: 'Remark' }"
      label="Step Modal"
      @next="onStepNext"
      @submit="showToast('Submitted')"
    >
      <template #page-0>
        <div class="pv__step">
          <UiFieldInput title="Teaching content" required :filled="step0Val.trim() !== ''">
            <UiInput v-model="step0Val" placeholder="Subject, content and teaching plan" @input="refreshCanNext" />
          </UiFieldInput>
          <UiFieldInput title="Teaching method" required :filled="step1Val.trim() !== ''">
            <UiInput v-model="step1Val" placeholder="Select" @input="refreshCanNext" />
          </UiFieldInput>
        </div>
      </template>
      <template #page-1>
        <div class="pv__step">
          <UiFieldInput title="Lesson schedule">
            <UiVariableInputSet v-model="varSet" :input-component="UiInput" :input-props="{ placeholder: 'Day · start-end time', width: '100%' }" />
          </UiFieldInput>
          <UiText text="This platform only provides communication and contract-template services. Contract terms are agreed between the parties; the platform is not a party to performance and provides no guarantee." color="var(--gray-60)" size="var(--fs-sm)" class="pv__mt" />
        </div>
      </template>
      <template #page-2>
        <div class="pv__step">
          <UiFieldDisplay
            :items="[
              { label: 'Billing', value: 'Hourly' },
              { label: 'Fee', value: '200 CNY/hr' },
              { label: 'Trial lesson', value: 'First hour free' },
            ]"
          />
          <div class="pv__row">
            <UiButton variant="B1" @click="enterStepHidden">Enter hidden page (Remark)</UiButton>
          </div>
        </div>
      </template>
      <template #hidden-remark>
        <div class="pv__step">
          <UiText text="This is a hidden page: it occupies no dot, enters from the right, exits to the right; the bottom buttons are hidden. Click below to return." />
          <div class="pv__row pv__mt">
            <UiButton variant="A1" fill="brand" @click="leaveStepHidden">Back to page</UiButton>
          </div>
        </div>
      </template>
    </UiStepModal>
  </div>
</template>

<style scoped>
.pv {
  max-width: 1080px;
  margin: 0 auto;
  padding: 48px 24px 120px;
}
.pv__title { font-size: 28px; font-weight: 700; }
.pv__sub { margin-top: 8px; color: var(--gray-60); font-size: var(--fs-sm); }
.pv__sec { margin-top: 40px; }
.pv__h {
  font-size: 18px;
  font-weight: 600;
  padding-bottom: 8px;
  margin-bottom: 16px;
  border-bottom: var(--border-w) solid var(--line);
}
.pv__row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.pv__row--cards { align-items: stretch; }
.pv__col { display: flex; flex-direction: column; gap: 16px; }
.pv__mt { margin-top: 16px; }
.pv__ctrl { --btn-w: 180px; }
.pv__ctrl--w300 { width: 300px; max-width: 100%; }
.pv__col--w380 { width: 380px; max-width: 100%; }
.pv__col--w520 { width: 520px; max-width: 100%; }
.pv__card { width: 200px; }
.pv__card-body { padding: 16px; line-height: 1.6; }
.pv__icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.pv__icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  color: var(--ink);
}
.pv__icon-name { font-size: 11px; color: var(--gray-60); }
.pv__demo-modal { padding: 24px; }
.pv__step { display: flex; flex-direction: column; gap: 24px; }
</style>
