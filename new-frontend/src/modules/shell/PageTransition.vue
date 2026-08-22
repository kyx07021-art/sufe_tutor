<!--
  PageTransition.vue - page switch fade + light float transition (M2-13).
  Wraps routed views in a Vue <Transition> with name="page" mode="out-in".
  - mode="out-in": the leave animation completes before enter starts,
    so incoming/outgoing views never overlap-stack.
  - Transition is a built-in Vue component available in templates; no import.
  - The CSS lives in page-transition.css (global, non-scoped): Transition
    classes are applied to the child component's root element, so scoped
    styles would not match them.
  - reduced-motion is handled by base.css (media query fallback); JS only
    switches state, the animation is pure CSS.
-->
<template>
  <Transition name="page" mode="out-in">
    <slot />
  </Transition>
</template>

<style>
@import './page-transition.css';
</style>
