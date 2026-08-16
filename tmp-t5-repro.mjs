// T5 复现：qa_teacher 引导推进到卡面步——点击后详情是否打开
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
try {
  const resp = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!', deviceId: 't5-repro' }),
  })).json();
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
  // 推进到卡面步（第 3 步）
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => { const h = document.querySelector('.tour-hole'); if (h) h.click(); });
    await sleep(600);
  }
  const st = await page.evaluate(() => ({
    bubble: (document.querySelector('.tour-bubble-text') || {}).textContent ? document.querySelector('.tour-bubble-text').textContent.slice(0, 20) : 'NO',
    hole: !!document.querySelector('.tour-hole--show'),
    cardCount: document.querySelectorAll('#demands-list .list-card--demand').length,
    detailOpen: !!document.querySelector('.modal .demand-detail'),
  }));
  console.log('卡面步状态:', JSON.stringify(st));
  // 点击卡面步的 hole（真实鼠标点击——模拟用户）
  const hb = await page.locator('.tour-hole').boundingBox();
  if (hb) {
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
  }
  await sleep(900);
  const after = await page.evaluate(() => ({
    detailOpen: !!document.querySelector('.modal .demand-detail'),
    bubble: (document.querySelector('.tour-bubble-text') || {}).textContent ? document.querySelector('.tour-bubble-text').textContent.slice(0, 20) : 'NO',
    modalCount: document.querySelectorAll('.modal-overlay').length,
  }));
  console.log('点击后:', JSON.stringify(after));
  console.log('RESULT:', after.detailOpen ? '详情打开' : '详情未打开（BUG 复现）');
  process.exit(after.detailOpen ? 0 : 1);
} catch (e) {
  console.log('X 异常:', e.message.slice(0, 120));
  process.exit(1);
} finally {
  await browser.close();
}
