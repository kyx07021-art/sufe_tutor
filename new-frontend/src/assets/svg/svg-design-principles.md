# SVG Design Principles (New Frontend - JingShiZhiTu)

> The single style contract for all site-wide SVG icons. Read this before adding or modifying any icon to keep the whole icon set coherent.
> Icons are compiled to Vue components by `vite-svg-loader` and dispatched by `UiIcon.vue` via `name`.

## 1. Unified Canvas & Metrics

- **Canvas**: `viewBox="0 0 24 24"` (special icons may deviate, e.g. arrows use a 20 canvas, but must be noted).
- **Stroke**: `stroke="currentColor"`, line width `stroke-width="2"`, `fill="none"`.
- **Endpoints**: `stroke-linecap="round"`, `stroke-linejoin="round"` (rounded caps and joins, soft and consistent).
- **Spacing**: keep >= 1.5 units of breathing space between the graphic content and the canvas edge; do not touch the edge.

## 2. Color Conventions

- **Monochrome icons** always use `currentColor` - inherit the text color at the usage site (black text -> gray-60 hover -> gray-50 disabled); components never color icons individually.
- **Two/multi-color needs** (e.g. unknown-file logo base + question mark) reference CSS variables: `fill="var(--gray-20)"`,
  flipping automatically with dark mode; hardcoded hex is forbidden (unless the color does not change with the theme).
- **Brand-purple accents** are provided by the consuming component via the `--brand` variable, not hardcoded inside the SVG.

## 3. Graphic Style

- **Geometry first**: circles/rectangles/slant lines; avoid hand-drawn curves (casual `M`/`C` Beziers).
- **Check/arrow**: acute-angle (approx. 60 deg) visual; checks use `stroke-width="2.2"` slightly thicker, looking light and sharp.
- **Symbol semantics**:
  - arrow = direction guidance (A1 button focus shift);
  - magnifier = "show details";
  - paper plane = send;
  - star = rating (yellow supplied by the usage site);
  - plus/X = add/remove entries (variable input set).
- **File-type LOGO**: rounded rectangle + type letter (`<text>` centered), system font, bold.
  Unknown type = `var(--gray-20)` background + `var(--gray-10)` bold large question mark.

## 4. Naming

- Lowercase hyphenated: `arrow-right.svg`, `chat-bubble.svg`, `file-pdf.svg`.
- Semantic names over shape names (`mail` not `envelope-front`).
- After registering a new icon in `src/components/ui/icons.js`, `UiIcon name` works immediately.

## 5. Evolution Discipline

- All site icons live in this directory; any agent may help evolve the site-wide SVG set, but must not each go their own style.
- Changing an existing icon = an explicit site-wide-affecting change; all consuming visuals must be rechecked.
- New icons first follow this contract for drafting -> review -> then register.
