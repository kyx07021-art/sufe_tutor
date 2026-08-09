/**
 * R28（v0.25.93）：主页入口按钮定制设计——liquid × flat 融合开始按钮
 *
 * 调研收敛（成熟开始按钮语言）：光标跟随光斑 + hover 辉光边缘 + 微光扫过 + 弹簧按压。
 *   - HTML：两个 .entry 按钮内各挂 .entry-glow 光斑子元素；
 *   - CSS：.entry-glow radial-gradient 跟随 --mx/--my（hover 显现）、::after 扫光、
 *     hover 辉光 box-shadow、:active 弹簧按压；
 *   - JS：app-auth mousemove 委托更新 --mx/--my（JS 只写几何变量，视觉全在 CSS 层）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('R28 主页入口：两个 .entry 各挂 .entry-glow 光斑子元素', () => {
  const html = readFileSync('./index.html', 'utf8');
  const entries = [...html.matchAll(/<button class="entry glass"/g)];
  assert.equal(entries.length, 2, '两个入口按钮');
  const glowCount = [...html.matchAll(/<span class="entry-glow"/g)];
  assert.equal(glowCount.length, 2, '每个入口一个光斑子元素');
  // 光斑在按钮内部（同一 button 内）
  assert.ok(html.includes('<button class="entry glass" onclick="handleFeatureClick(\'student\')">\n                <span class="entry-glow"'),
    '光斑紧随按钮开始（学生入口）');
});

test('R28 CSS：光斑跟随变量 + 扫光 + 辉光边缘 + 弹簧按压（四件套）', () => {
  const css = readFileSync('./style.css', 'utf8');
  assert.ok(css.includes('.entry-glow {') && css.includes('radial-gradient(240px circle at var(--mx, 50%) var(--my, 50%)'),
    '光斑径向渐变跟随 --mx/--my（光标位置）');
  assert.ok(css.includes('.entry:hover .entry-glow, .entry:focus-visible .entry-glow { opacity: 1; }'),
    'hover 光斑显现');
  assert.ok(css.includes('.entry::after {') && css.includes('@keyframes entry-sheen'),
    '::after 微光扫过 + keyframes');
  assert.ok(css.includes('.entry:hover::after { animation: entry-sheen .7s'),
    'hover 触发扫光');
  // v0.25.95（用户反馈「扫过小半个按钮」）：扫光几何修正——光带加宽盖满（width 62% / top -50% / height 200%），
  // 横扫全宽（translateX -150% → 320%，相对自身宽度投影后全程覆盖按钮左右缘，Chrome 逐帧实测）
  assert.ok(css.includes('width: 62%; height: 200%;') && css.includes('top: -50%'),
    '扫光带宽盖满按钮（原 36% 只扫小半个按钮）');
  assert.ok(css.includes('transform: translateX(-150%) rotate(18deg);') &&
    css.includes('@keyframes entry-sheen { to { transform: translateX(320%) rotate(18deg); } }'),
    '扫光自左外横扫至右外（全覆盖）');
  assert.ok(css.includes('.entry.glass:hover, .entry.glass:focus-visible {') && css.includes('color-mix(in srgb, var(--accent) 30%, transparent)'),
    'hover 辉光边缘（.entry.glass 提特异性压玻璃引擎后加载规则）');
  assert.ok(css.includes('.entry:active { transform: translateY(1px) scale(.985);'),
    'active 弹簧按压（flat 触感）');
  assert.ok(!css.includes('.entry:hover { background-color'), '不引入散装 hover 背景（走引擎 token）');
});

test('R28 JS：mousemove 委托只更新 .entry 的 --mx/--my（零内联视觉）', () => {
  const auth = readFileSync('./app-auth.js', 'utf8');
  assert.ok(auth.includes("e.target.closest ? e.target.closest('.entry') : null"),
    'mousemove 委托命中 .entry');
  assert.ok(auth.includes("setProperty('--mx'") && auth.includes("setProperty('--my'"),
    '更新光斑坐标变量');
  assert.ok(!auth.includes('entry-glow.style') && !auth.includes('entry-glow.classList'), 'JS 不直接操作光斑视觉（纯 CSS 层）');
});
