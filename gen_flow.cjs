// 生成"流场"短线 SVG（线段方向随坐标平滑变化，呈场线流动感），
// 编码为 data-URI 并注入 style.css 的 /*FLOW_URL*/ 占位符。无外部依赖。
const fs = require('fs');

const W = 320, H = 320, M = 18, N = 11, L = 15;
const step = (W - 2 * M) / (N - 1);
let lines = '';
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const x = M + i * step, y = M + j * step;
    // 平滑向量场：多个正弦叠加，使相邻线段方向连续变化（流动感），而非统一朝向
    const deg = -42 + 58 * Math.sin(x * 0.017) + 34 * Math.cos(y * 0.021) + 22 * Math.sin((x + y) * 0.011);
    const r = deg * Math.PI / 180;
    const dx = Math.cos(r) * L / 2, dy = Math.sin(r) * L / 2;
    lines += `<line x1='${(x - dx).toFixed(1)}' y1='${(y - dy).toFixed(1)}' x2='${(x + dx).toFixed(1)}' y2='${(y + dy).toFixed(1)}'/>`;
  }
}
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' fill='none' stroke='#111114' stroke-width='1.3' stroke-linecap='round'>${lines}</svg>`;
const url = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';

const path = 'style.css';
let css = fs.readFileSync(path, 'utf8');
const sentinel = '/*FLOW_URL*/ none';
const n = css.split(sentinel).length - 1;
if (n !== 1) { console.error('sentinel occurrences =', n, '(expected 1)'); process.exit(1); }
css = css.replace(sentinel, url);
fs.writeFileSync(path, css);
console.log('flow-field injected; lines =', N * N, '; svg bytes =', svg.length);
