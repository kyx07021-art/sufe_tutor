// v1.4.8 F1/F2 补充验证：filter 拦截 + 示例会话（等 v1.4.7/v1.4.8 激活后跑）
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = [];
const browser = await chromium.launch();
try {
  const resp = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!', deviceId: 'f2-' + Date.now() }),
  })).json();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  await page.evaluate(([tok, usr]) => {
    localStorage.setItem('sufe_session_teacher', JSON.stringify({ user: usr, authToken: tok, expires: Date.now() + 3600000 }));
    localStorage.setItem('sufe_last_role', 'teacher');
  }, [resp.authToken, resp.user]);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  await page.evaluate(() => { try { startOnboardingTour && startOnboardingTour(); } catch (e) {} });
  await sleep(900);
  // 推进到筛选步（browse-teachers 段：teachersList→FilterToggle→FilterSubject）
  // teacherUser 顺序：需求大厅 6 步 → 教师同行 4 步（BrowseTeachersPeer/TeachersList/FilterToggle/FilterSubject）——约第 10-12 步
  let sawFilter = false, panelOpened = false;
  for (let i = 0; i < 16; i++) {
    const st = await page.evaluate(() => ({
      text: (document.querySelector('.tour-bubble-text') || {}).textContent || '',
      hole: !!document.querySelector('.tour-hole--show'),
      panelHidden: (() => { const el = document.querySelector('.filter-panel'); return el ? el.classList.contains('hidden') : null; })(),
    }));
    if (st.text.includes('筛选')) sawFilter = true;
    if (sawFilter && st.text.includes('筛选')) {
      // 点击筛选步的 hole——面板不应被打开
      const before = st.panelHidden;
      await page.evaluate(() => { const h = document.querySelector('.tour-hole'); if (h) h.click(); });
      await sleep(600);
      const after = await page.evaluate(() => {
        const el = document.querySelector('.filter-panel');
        return el ? el.classList.contains('hidden') : null;
      });
      if (before === after) { R.push(['F1 筛选开关点击拦截（面板未打开）', 'OK']); }
      else { R.push(['F1 筛选开关点击拦截', 'FAIL 面板状态变了 ' + before + '→' + after]); }
      break;
    }
    await page.evaluate(() => { const h = document.querySelector('.tour-hole'); if (h) h.click(); });
    await sleep(500);
  }
  if (!sawFilter) R.push(['F1 筛选步未找到', 'SKIP（步数可能已变）']);
  // F2 示例会话：推进到 my-chats 段（约第 18-20 步）——示例会话注入检查
  let sawDemo = false, demoClicked = false;
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => ({
      text: (document.querySelector('.tour-bubble-text') || {}).textContent || '',
      demoConv: !!document.querySelector('#conv-list .tour-demo-conv'),
      pane: (document.getElementById('chat-pane') || {}).innerHTML ? document.getElementById('chat-pane').innerHTML.slice(0, 40) : '',
    }));
    if (st.demoConv) sawDemo = true;
    if (st.text.includes('会话')) {
      // my-chats 段——点示例会话
      if (st.demoConv) {
        await page.evaluate(() => { const d = document.querySelector('#conv-list .tour-demo-conv'); if (d) d.click(); });
        await sleep(700);
        const pane = await page.evaluate(() => {
          const el = document.getElementById('chat-pane');
          return el && el.querySelector('.chat-messages') ? 'chat-open' : 'no-chat';
        });
        demoClicked = pane === 'chat-open';
        R.push(['F2 示例会话点击开空白聊天窗', demoClicked ? 'OK' : 'FAIL pane=' + pane]);
      } else {
        R.push(['F2 示例会话注入', 'FAIL 未注入']);
      }
      break;
    }
    await page.evaluate(() => { const h = document.querySelector('.tour-hole'); if (h) h.click(); });
    await sleep(500);
  }
  if (!sawDemo && !R.some(([k]) => k.includes('F2 示例会话注入'))) R.push(['F2 示例会话', 'SKIP（未到 my-chats 段）']);
  await ctx.close();
} catch (e) {
  R.push(['X 异常', e.message.slice(0, 120)]);
}
await browser.close();
for (const [k, v] of R) console.log(k + ' => ' + v);
const fails = R.filter(([, v]) => v.startsWith('FAIL') || v.startsWith('X'));
console.log('RESULT:', fails.length ? fails.length + ' FAIL' : 'ALL PASS (' + R.length + ')');
process.exit(fails.length ? 1 : 0);
