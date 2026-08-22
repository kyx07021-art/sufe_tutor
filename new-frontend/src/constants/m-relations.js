/**
 * m-relations.js - M3 C1 relations module copy + geometry single source
 * -------------------------------------------------------
 * - All user-visible Chinese copy for the relations module lives here
 *   (zero raw Chinese in component templates/scripts/comments).
 * - Geometry constants (avatar sizes / card width / radius floor) are the
 *   module single source; components consume these names only.
 * - z-order tokens are defined in RelationsBoard.vue CSS (--rz-*) as the
 *   single source; not duplicated here.
 */

export const RELATIONS_COPY = {
  /** C1 page title (top bar tab / page heading) */
  PAGE_TITLE: '关系管理',
  /** Center (self) avatar id label */
  SELF_NAME: '我',
  /** Session states (status display mapping) */
  SESSION_ACTIVE: '会话中',
  SESSION_CLOSED: '会话已结束',
  /** Relation card button copy (M3-08) */
  CARD_ACTIVE: '会话中',
  CARD_ENDED: '会话已结束',
  /** Card-list heading / accessible region label (below the board, list mode) */
  SESSION_LIST_TITLE: '会话',
  /** Board accessibility description */
  BOARD_DESC: '关系分布图',
  /** Data states (M3-09) */
  LOADING: '加载中…',
  LOAD_FAILED: '关系加载失败',
  EMPTY: '暂无关系',
  RETRY: '重试',
}

/* Diameter constants defined once so the radius floors below are derived from
   them (single source — no duplicated bare numbers to drift). */
const SELF_D = 150
const OTHER_D = 100
const SELF_D_COMPACT = 104
const OTHER_D_COMPACT = 68

export const RELATIONS_GEOMETRY = {
  /** Self (center) avatar diameter px */
  SELF_D,
  /** Other (concentric) avatar diameter px */
  OTHER_D,
  /** Relation card width px (M3-08) */
  CARD_W: 200,
  /** Clearance kept between a floating card and the self avatar / its
   *  neighbors (px) */
  CARD_GAP: 8,
  /** Minimum readable card width (px): the F4 geometric gate — when the fitted
   *  width (tightest of max / center clearance / adjacent chord) falls below
   *  this the board switches to 'list' mode instead of rendering a too-narrow
   *  card. The width is NEVER clamped up to this floor. */
  CARD_W_MIN: 140,
  /** Viewport edge margin kept around the concentric ring (px) */
  EDGE_MARGIN: 16,
  /** Narrow-viewport breakpoint below which compact avatars + stage shrink apply */
  COMPACT_BREAKPOINT: 560,
  /** Minimum radius so an outer avatar never overlaps the center avatar
   *  (derived from the diameter constants above). */
  RADIUS_MIN: SELF_D / 2 + OTHER_D / 2 + 24,
  /** Compact variant for narrow viewports (< COMPACT_BREAKPOINT): smaller
   *  avatars so the concentric ring + avatars fit inside 375px without
   *  horizontal overflow. */
  SELF_D_COMPACT,
  OTHER_D_COMPACT,
  RADIUS_MIN_COMPACT: SELF_D_COMPACT / 2 + OTHER_D_COMPACT / 2 + 20,
}
