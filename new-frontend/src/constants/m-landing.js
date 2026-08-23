/**
 * m-landing.js - M1 landing page copy (single source)
 * --------------------------------------------------------------
 * All values are the user's landing-spec demo placeholders; the SLOGAN/body
 * will be swapped for real platform copy later. Kept here (not inside the Vue
 * components) so a future rewrite touches one source. ui.js re-exports this
 * file so the whole constants surface stays discoverable from one place.
 */

export const LANDING_COPY = {
  /** Hero headline (one black display line, centered) */
  HERO_TITLE: '经世知途·信息门户平台',
  /** Hero primary CTA (left): enter the student client */
  HERO_CTO_STUDENT: '我要找家教',
  /** Hero secondary CTA (right): enter the teacher client */
  HERO_CTO_TEACHER: '我要做家教',
  /** Hero login link for returning users (PA-2-F1: hero CTAs open register only) */
  HERO_LOGIN: '已有账号？登录',
  /** SLOGAN (big black, centered) */
  SLOGAN: '测试文本测试文本',
  /** Placeholder body: 20 x "测试文本" (gray, ~1/3 page width block) */
  BODY: '测试文本'.repeat(20),
  /** Gallery section accessible label (decorative placeholder images) */
  GALLERY_LABEL: '平台演示图片横廊',
}

/** M1-10 mirror sections copy (all text is still demo "test text" per the spec) */
export const MIRROR_COPY = {
  /** Black bold title */
  TITLE: '测试文本',
  /** Gray small paragraph under the title */
  DESC: '测试文本'.repeat(14),
}
