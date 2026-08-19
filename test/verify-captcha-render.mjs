/**
 * 拼图验证码渲染回归（v1.4.17 起强制——渲染改动交付红线见 CLAUDE.md）：
 * playwright 真实浏览器 canvas 像素断言，防止 destination-out/in 缺 fill 类渲染 bug 再犯。
 * 覆盖 v2 迁移版（/v2 = src/client/core/captcha.js esbuild bundle，V-2 生产路径；V-4-1h 后唯一形态，
 * v1 经典 app-captcha.js 已删）。用法：node test/verify-captcha-render.mjs
 * （需 playwright chromium；不进 npm test glob，交付渲染改动前手动跑）
 *
 * 断言：①有效缺口中心 alpha=0（透明洞已抠出）②拼图块中心 alpha>0 且四角 alpha=0（已裁剪成形状非矩形）
 *      ③透明洞连通域计数 >= 3（有效 1 + 无效空缺 2；连通域而非网格单元——单个 32px 洞覆盖多个
 *        采样单元，按单元计数阈值恒被满足，删掉无效空缺 fill 也拦不住；连通域计数才能区分）
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const port = 8932;

// 迁移版模块 bundle（write:false → 内存字符串；启动时构建一次，两页共用 server 实例）
const v2Bundle = await build({
  entryPoints: ['src/client/core/captcha.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});
const v2Js = v2Bundle.outputFiles[0].text;

const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/captcha-v2.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(v2Js);
    return;
  }
  // 验证页在 test/ 目录（不进 build 静态复制面）；'/v2' 为迁移版（V-4-1h 后唯一形态，v1 经典页已删）
  const file = u === '/v2' ? '/test/captcha-render-verify-v2.html' : u;
  try {
    const body = readFileSync('.' + file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(port, r));

const browser = await chromium.launch();

async function verifyPage(path, label) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log(`[${label}] PAGEERROR:`, e.message));
  await page.goto(`http://localhost:${port}${path}`);
  await page.waitForFunction(() => window.__painted === true, null, { timeout: 5000 });
  const r = await page.evaluate(() => {
    const cv = document.getElementById('captcha-canvas');
    const pz = document.getElementById('captcha-puzzle');
    const cctx = cv.getContext('2d');
    const pctx = pz.getContext('2d');
    const cutX = Math.round(window.__target * 240);
    const hole = cctx.getImageData(cutX + 20, 60, 1, 1).data[3]; // 有效缺口中心 alpha（0=透明洞）
    const pC = pctx.getImageData(20, 20, 1, 1).data[3];          // 拼图块中心（应有内容）
    const pCorners = [[2, 2], [37, 2], [2, 37], [37, 37]].map(([x, y]) => pctx.getImageData(x, y, 1, 1).data[3]);
    // 透明洞连通域计数：4px 步长采样 + 8 邻域合并——单洞覆盖的多个采样单元合并为 1
    const img = cctx.getImageData(0, 0, cv.width, cv.height).data;
    const step = 4;
    const cellSet = new Set();
    for (let y = 2; y < cv.height - 2; y += step)
      for (let x = 2; x < cv.width - 2; x += step)
        if (img[(y * cv.width + x) * 4 + 3] === 0) cellSet.add(x + ':' + y);
    const seen = new Set();
    let holeCount = 0;
    for (const key of cellSet) {
      if (seen.has(key)) continue;
      holeCount++;
      seen.add(key);
      const stack = [key.split(':').map(Number)];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        for (let dy = -step; dy <= step; dy += step) {
          for (let dx = -step; dx <= step; dx += step) {
            if (!dx && !dy) continue;
            const k = (cx + dx) + ':' + (cy + dy);
            if (cellSet.has(k) && !seen.has(k)) { seen.add(k); stack.push([cx + dx, cy + dy]); }
          }
        }
      }
    }
    return { cutX, hole, pC, pCorners, holeCount };
  });
  await page.close();
  const ok = r.hole === 0 && r.pC > 0 && r.pCorners.every(a => a === 0) && r.holeCount >= 3;
  console.log(`[${label}]`, JSON.stringify(r));
  console.log(ok ? `✓ ${label} 渲染回归通过：透明洞 + 形状裁剪 + 洞连通域 ${r.holeCount}（>=3）` : `✗ ${label} 渲染回归失败`);
  return ok;
}

const v2Ok = await verifyPage('/v2', '迁移版 core/captcha');

await browser.close();
server.close();
process.exit(v2Ok ? 0 : 1);
