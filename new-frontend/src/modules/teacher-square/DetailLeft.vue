<script setup>
/**
 * DetailLeft - M7-19 detail modal left column
 * -----------------------------------------------------
 * - Large rounded avatar centered horizontally with equal space to the column
 *   top/left/right (uniform 5% column padding); a neutral circle placeholder
 *   replaces the image when the teacher has no avatar.
 * - Teacher id below the avatar: centered, bold, larger font ("ID <teacherId>").
 * - A horizontal divider (site line token) sits above the profile section in
 *   normal flow; its vertical position is pushed up by the lower content via an
 *   auto top margin (never pinned under the upper half).
 * - Profile title bold + larger, then the bio body gray-75, both left-aligned at
 *   ~5% of the column width and wrapped; a ~2x line-height gap separates the bio
 *   from the column bottom.
 * - Contract 6: all copy from TEACHER_SQUARE_TEXT (zero raw CJK in the template
 *   or comments), text via {{ }} interpolation only (auto-escaped, zero v-html),
 *   zero inline event/style attributes, zero runtime style-element injection, tokens only.
 * - Fits a 375px stacked column (the modal columns stack vertically on mobile).
 */
import { computed } from 'vue'
import { UiIcon, UiText } from '@/components/ui/index.js'
import { TEACHER_SQUARE_TEXT as T } from '@/constants/m-teacher-square.js'

const props = defineProps({
  /** M7-01 mapped teacher model: { teacherId, avatar, bio, ... } */
  teacher: { type: Object, required: true },
})

/** Id label: copy prefix + number with exactly one space between. */
const idText = computed(() => `${T.ID_PREFIX} ${props.teacher.teacherId ?? ''}`.trim())
</script>

<template>
  <div class="detail-left">
    <div class="detail-left__top">
      <div class="detail-left__avatar">
        <img
          v-if="teacher.avatar"
          class="detail-left__avatar-img"
          :src="teacher.avatar"
          alt=""
        />
        <span v-else class="detail-left__avatar-fallback" aria-hidden="true">
          <UiIcon class="detail-left__avatar-icon" name="user" />
        </span>
      </div>
      <p class="detail-left__id">{{ idText }}</p>
    </div>

    <div class="detail-left__divider" aria-hidden="true"></div>

    <div class="detail-left__bio">
      <UiText
        :text="T.PROFILE_TITLE"
        size="var(--fs-lg)"
        weight="700"
      />
      <UiText
        :text="teacher.bio || ''"
        color="var(--gray-75)"
      />
    </div>
  </div>
</template>

<style scoped>
/* -- Column: flex column filling the modal row height; the uniform 5% padding
     gives the avatar equal space to the column top/left/right and the bio its
     ~5% left alignment. -- */
.detail-left {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 5% 5% 0;
  box-sizing: border-box;
}

/* -- Upper block: large centered avatar + id. -- */
.detail-left__top {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.detail-left__avatar {
  width: var(--space-8);
  max-width: 100%;
  min-width: 0;
}

.detail-left__avatar-img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  border-radius: var(--radius-img);
  object-fit: cover;
}

/* -- Neutral circle fallback: gray-10 disc with a gray-70 user glyph. -- */
.detail-left__avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius-circle);
  background: var(--gray-10);
  color: var(--gray-70);
}

.detail-left__avatar-icon {
  width: 45%;
  height: 45%;
}

.detail-left__id {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  line-height: var(--lh-tight);
  color: var(--ink);
  text-align: center;
}

/* -- Divider: normal flow with an auto top margin so it sits above the profile
     section and moves up as that lower content grows (never pinned to the upper
     half). -- */
.detail-left__divider {
  flex: 0 0 auto;
  margin-top: auto;
  border-top: var(--border-w) solid var(--divider);
}

/* -- Lower block: profile title + bio body, ~5% left inset via the column
     padding, ~2x line-height gap to the column bottom; scrolls if the bio is
     very long. -- */
.detail-left__bio {
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5) 0 calc(var(--lh-body) * 2em);
}
</style>
