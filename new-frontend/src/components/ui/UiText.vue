<script setup>
import { computed } from 'vue'

/**
 * UiText - Text block component (plan "misc - text block component")
 * -------------------------------------------------------
 * - Site-wide body typography goes through this component. Interface: line height (default unified config) / font size / text color / bold amount /
 *   auto-wrap or ellipsis (truncated char count) / paragraph line spacing (> normal line height, default unified config).
 * - No first-line indent; paragraphs are separated by larger spacing between paragraphs (\n separation).
 * - Outer edge ~ the text's bounding rectangle.
 */
const props = defineProps({
  text: { type: String, default: '' },
  size: { type: String, default: '' },   // CSS font-size
  color: { type: String, default: '' },  // CSS color (accepts token variable names)
  weight: { type: [Number, String], default: '' }, // CSS font-weight
  lineHeight: { type: String, default: '' }, // CSS line-height
  /** paragraph spacing (default greater than line height, references unified config) */
  paragraphSpacing: { type: String, default: '' },
  /** auto-wrap (true) or ellipsis (false) */
  wrap: { type: Boolean, default: true },
  /** char count to truncate at when using ellipsis */
  maxChars: { type: Number, default: 40 },
  align: { type: String, default: 'left', validator: (v) => ['left', 'center', 'right'].includes(v) },
  /** max single-line width (when auto-wrapping) */
  maxWidth: { type: String, default: '' },
})

const displayText = computed(() => {
  const raw = props.text
  if (!props.wrap && raw.length > props.maxChars) {
    return raw.slice(0, props.maxChars) + '…'
  }
  return raw
})

const paragraphs = computed(() => displayText.value.split('\n'))

const vars = computed(() => {
  const s = {}
  if (props.size) s['--ui-text-fs'] = props.size
  if (props.color) s['--ui-text-color'] = props.color
  if (props.weight !== '') s['--ui-text-weight'] = String(props.weight)
  if (props.lineHeight) s['--ui-text-lh'] = props.lineHeight
  if (props.paragraphSpacing) s['--ui-text-para'] = props.paragraphSpacing
  if (props.maxWidth) s['--ui-text-maxw'] = props.maxWidth
  return s
})

const classes = computed(() => ({
  'is-ellipsis': !props.wrap,
  [`is-align-${props.align}`]: true,
}))
</script>

<template>
  <div class="ui-text" :class="classes" :style="vars">
    <template v-if="wrap">
      <p v-for="(para, i) in paragraphs" :key="i" class="ui-text__para">{{ para }}</p>
    </template>
    <span v-else class="ui-text__ellipsis">{{ displayText }}</span>
  </div>
</template>

<style scoped>
.ui-text {
  /* unified config constants (defaults); overridden by props */
  --ui-text-fs: var(--fs-base);
  --ui-text-color: var(--ink);
  --ui-text-weight: 400;
  --ui-text-lh: var(--lh-body);
  --ui-text-para: calc(var(--lh-body) * 1.2em); /* paragraph spacing > normal line height */
  --ui-text-maxw: 100%;

  font-size: var(--ui-text-fs);
  color: var(--ui-text-color);
  font-weight: var(--ui-text-weight);
  line-height: var(--ui-text-lh);
  max-width: var(--ui-text-maxw);
  word-break: break-word;
  overflow-wrap: break-word;
}
.ui-text__para + .ui-text__para {
  margin-top: var(--ui-text-para);
}
.is-align-center { text-align: center; }
.is-align-right { text-align: right; }

/* ellipsis mode: single-line ellipsis */
.ui-text.is-ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
