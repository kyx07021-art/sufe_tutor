/**
 * my-chats 会话页布局几何回归（G5 / 规则 45）：
 * playwright 真实浏览器断言会话列表/聊天窗在视口内 + .chats-shell 双栏结构在位。
 * 背景：V-4-1h 删 v1 壳时 my-chats 丢 .chats-shell 网格包裹，client-page--flush 的
 * height:100% 落在扁平子 div 上 → 列表/聊天窗推出视口外（overflow:hidden 裁剪），
 * 页面只剩满高空块（用户所见"HERO 排版错误 + 组件全消失"）。
 * 用法：node test/verify-chat-layout.mjs（需 playwright；不进 npm test glob）
 */
import { createServer } from 'node:http';
import { cwd } from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
const repo = cwd();
const require = createRequire(repo + '/package.json');
const { chromium } = require('playwright');
const port = 8942;
const dist = join(repo, 'dist');

const root = resolve(dist);
const server = createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  const file = resolve(dist, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); // URL path 去前导 / 转相对（Windows resolve 绝对路径会逃到盘符根）
  if (file !== root && !file.startsWith(root + sep)) { res.statusCode = 403; res.end('Forbidden'); return; } // 防路径遍历逃逸 dist
  if (existsSync(file)) { const t = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'; res.setHeader('Content-Type', t); res.end(readFileSync(file)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync(join(dist, 'index.html'))); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r)); // 仅 loopback，防局域网访问

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(1500);
await page.evaluate(() => { const b = document.querySelector('[data-action="onboard.browseGuest"]'); if (b) b.click(); }).catch(() => {});
await page.evaluate(() => {
  localStorage.setItem('sufe_session_teacher', JSON.stringify({ user: { id: 2, role: 'teacher', username: 'qa_teacher' }, authToken: 'mock', expires: Date.now() + 86400000 }));
  localStorage.setItem('sufe_last_role', 'teacher');
  localStorage.setItem('sufe_returning', '1');
});
await page.reload();
await page.waitForTimeout(3000);
await page.evaluate(() => { const b = document.querySelector('#sidebar-nav [data-page="my-chats"]'); if (b) b.click(); });
await page.waitForTimeout(1200);

const g = await page.evaluate(() => {
  const vh = innerHeight;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), inViewport: r.y >= 0 && r.bottom <= vh && r.height > 0 }; };
  const list = document.getElementById('my-chats-list');
  const frame = document.getElementById('chat-frame');
  return {
    vh,
    shell: !!document.querySelector('.chats-shell'),
    listPane: !!document.querySelector('.chats-list-pane #my-chats-list'),
    convList: !!document.querySelector('.chats-list-pane .conv-list'),
    chatPane: !!document.querySelector('.chat-pane #chat-frame'),
    listRect: rect(list),
    frameRect: rect(frame),
  };
});
console.log('GEOMETRY:', JSON.stringify(g));
await browser.close(); server.close();
const ok = g.shell && g.listPane && g.convList && g.chatPane && g.listRect && g.listRect.inViewport && g.frameRect && g.frameRect.inViewport;
console.log(ok ? '✓ my-chats 布局：chats-shell 双栏 + 列表/聊天窗在视口内' : '✗ my-chats 布局异常（列表/聊天窗视口外 = 断线复发）');
process.exit(ok ? 0 : 1);
