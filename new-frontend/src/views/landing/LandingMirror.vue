<script setup>
/**
 * LandingMirror - M1 mirror symmetric section (M1-10)
 * -------------------------------------------------------------
 * - Two instances, mirror layouts: variant 'a' = image right (~1/3 screen) +
 *   text left (gray text right edge reaches the screen center via the
 *   `minmax(0,50%)` grid column); variant 'b' = mirrored (image left, text
 *   right-aligned).
 * - All copy is demo "test text" from MIRROR_COPY (single source).
 * - data-reveal on the root: consumed by the M1-11 scroll reveal system.
 */
import { computed } from 'vue'
import { MIRROR_COPY } from '@/constants/m-landing.js'
import mirrorA from '@/assets/img/mirror-a.png'
import mirrorB from '@/assets/img/mirror-b.png'

const props = defineProps({
  /** 'a' = image right / text left ; 'b' = mirrored */
  variant: { type: String, default: 'a', validator: (v) => ['a', 'b'].includes(v) },
})

const imgSrc = computed(() => (props.variant === 'b' ? mirrorB : mirrorA))
</script>

<template>
  <section
    class="landing-mirror"
    data-reveal
    :class="'landing-mirror--' + variant"
    :aria-label="MIRROR_COPY.TITLE"
  >
    <div class="landing-mirror__text">
      <h3 class="landing-mirror__title">{{ MIRROR_COPY.TITLE }}</h3>
      <p class="landing-mirror__desc">{{ MIRROR_COPY.DESC }}</p>
    </div>
    <img :src="imgSrc" alt="" class="landing-mirror__img" />
  </section>
</template>

<style scoped>
.landing-mirror {
  margin-top: var(--space-8); /* 100px zone separation */
  display: grid;
  grid-template-columns: minmax(0, 50%) 1fr var(--mirror-img-w);
  grid-template-areas: 'text . img';
  gap: var(--space-6);
  align-items: center;
}

.landing-mirror--b {
  grid-template-columns: var(--mirror-img-w) 1fr minmax(0, 50%);
  grid-template-areas: 'img . text';
}
.landing-mirror--b .landing-mirror__text {
  text-align: right;
}

.landing-mirror__text {
  grid-area: text;
  min-width: 0; /* long text must not blow out the grid */
}

.landing-mirror__img {
  grid-area: img;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-img);
}

.landing-mirror__title {
  font-size: var(--fs-mirror);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink);
}

.landing-mirror__desc {
  margin-top: var(--space-5);
  font-size: var(--fs-base);
  line-height: 1.9;
  color: var(--gray-50);
}

/* Narrow screens: stack image above text */
@media (max-width: 768px) {
  .landing-mirror,
  .landing-mirror--b {
    grid-template-columns: 1fr;
    grid-template-areas: 'img' 'text';
  }
  .landing-mirror--b .landing-mirror__text {
    text-align: left;
  }
}
</style>
