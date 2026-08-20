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
  // 会话列表 / 消息 mock：让 loadConversations → openConversation 真实链路跑通
  // （本地静态服务器无 /api，不 mock 则列表拉 index.html 解析失败渲染空）
  if (u === '/api/conversations' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ conversations: [
      { id: 5, student_user_id: 9, teacher_user_id: 40, status: 'active', student_name: '学生甲', teacher_name: '教师乙', student_avatar: '', teacher_avatar: '', unread_count: 0, created_at: '2026-08-07 00:00:00', last_kind: 'text', last_body: '你好', last_at: '2026-08-07 12:00:00', last_sender: 9 },
    ] }));
    return;
  }
  const msg = u.match(/^\/api\/conversations\/(\d+)\/messages$/);
  if (msg && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ conversation: { id: Number(msg[1]), status: 'active' }, messages: [{ id: 1, sender_user_id: 9, kind: 'text', body: '你好，请问这周可以试课吗？', created_at: '2026-08-07 12:00:00' }] }));
    return;
  }
  const file = resolve(dist, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); // URL path 去前导 / 转相对（Windows resolve 绝对路径会逃到盘符根）
  if (file !== root && !file.startsWith(root + sep)) { res.statusCode = 403; res.end('Forbidden'); return; } // 防路径遍历逃逸 dist
  if (existsSync(file)) { const t = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'; res.setHeader('Content-Type', t); res.end(readFileSync(file)); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync(join(dist, 'index.html'))); }
});
await new Promise(r => server.listen(port, '127.0.0.1', r)); // 仅 loopback，防局域网访问

const browser = await chromium.launch();

async function newLoggedInPage(viewport) {
  const page = await browser.newPage({ viewport });
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
  return page;
}

// 桌面端（>860px）：双栏均可见、布局不变（S-7a 验收④）
{
  const page = await newLoggedInPage({ width: 1440, height: 900 });
  const g = await page.evaluate(() => ({
    vh: innerHeight,
    shell: !!document.querySelector('.chats-shell'),
    listPane: !!document.querySelector('.chats-list-pane #my-chats-list'),
    convList: !!document.querySelector('.chats-list-pane .conv-list'),
    chatPane: !!document.querySelector('.chat-pane #chat-frame'),
  }));
  const g2 = await page.evaluate(() => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom) }; };
    return { listRect: rect(document.getElementById('my-chats-list')), frameRect: rect(document.getElementById('chat-frame')) };
  });
  await page.close();
  const listIn = g2.listRect && g2.listRect.y >= 0 && g2.listRect.bottom <= 900 && g2.listRect.h > 0;
  const frameIn = g2.frameRect && g2.frameRect.y >= 0 && g2.frameRect.bottom <= 900 && g2.frameRect.h > 0;
  const desktopOk = g.shell && g.listPane && g.convList && g.chatPane && listIn && frameIn;
  console.log(desktopOk ? '✓ 桌面端：chats-shell 双栏 + 列表/聊天窗在视口内' : '✗ 桌面端布局异常');
  if (!desktopOk) process.exit(1);
}

// 移动端（≤860px）：默认显列表 → 点会话切聊天窗 → 返回列表（S-7a 验收①②③）
{
  const page = await newLoggedInPage({ width: 390, height: 844 });
  const snap = async () => page.evaluate(() => {
    const vh = innerHeight;
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), inViewport: r.y >= 0 && r.bottom <= vh && r.height > 0 }; };
    const list = document.getElementById('my-chats-list');
    const frame = document.getElementById('chat-frame');
    const shell = document.querySelector('.chats-shell');
    return {
      vh,
      hasClass: shell ? shell.classList.contains('chats-show-chat') : false,
      listDisplay: list ? getComputedStyle(list).display : '',
      paneDisplay: frame ? getComputedStyle(frame.parentElement).display : '',
      listRect: rect(list),
      frameRect: rect(frame),
    };
  });

  const init = await snap();
  const initOk = init.listRect && init.listRect.inViewport && init.listRect.h > 0
    && init.paneDisplay === 'none' && !init.hasClass;
  console.log('移动端初始:', JSON.stringify(init));
  console.log(initOk ? '✓ 初始：列表可见、聊天窗隐藏、无切换类' : '✗ 初始状态异常');

  // 点会话（列表第一行 data-action="chat.openConv"）→ 聊天窗应显示
  await page.evaluate(() => { const row = document.querySelector('[data-action="chat.openConv"]'); if (row) row.click(); }).catch(() => {});
  await page.waitForTimeout(1200);
  const opened = await snap();
  const openedOk = opened.frameRect && opened.frameRect.inViewport && opened.frameRect.h > 0
    && opened.paneDisplay === 'flex' && opened.hasClass;
  console.log('移动端开会话:', JSON.stringify(opened));
  console.log(openedOk ? '✓ 开会话：聊天窗在视口内 + 切换类已加' : '✗ 开会话后聊天窗不可见');

  // 点返回（data-action="chat.back"）→ 列表恢复
  await page.evaluate(() => { const b = document.querySelector('[data-action="chat.back"]'); if (b) b.click(); }).catch(() => {});
  await page.waitForTimeout(800);
  const back = await snap();
  const backOk = back.listRect && back.listRect.inViewport && back.listRect.h > 0
    && back.paneDisplay === 'none' && !back.hasClass;
  console.log('移动端返回:', JSON.stringify(back));
  console.log(backOk ? '✓ 返回：列表恢复可见 + 切换类已移除' : '✗ 返回后列表未恢复');

  await page.close();
  if (!(initOk && openedOk && backOk)) process.exit(1);
}

await browser.close(); server.close();
console.log('✓ my-chats 布局：桌面双栏 + 移动端切换全通过');
process.exit(0);
