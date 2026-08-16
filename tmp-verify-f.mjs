// v1.4.8 生产验证：F1 filter 拦截 / F2 示例会话 / F3 遮罩单层 / F4 学生端卡面开详情
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = [];
const login = async (page, id) => {
  const resp = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: id, password: 'SufeQa2026!', deviceId: 'f-' + id + '-' + Date.now() }),
  })).json();
  if (!resp.authToken) return false;
  await page.evaluate(([tok, usr, role]) => {
    localStorage.setItem('sufe_session_' + role, JSON.stringify({ user: usr, authToken: tok, expires: Date.now() + 3600000 }));
    localStorage.setItem('sufe_last_role', role);
  }, [resp.authToken, resp.user, resp.user.role]);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  return true;
};
const browser = await chromium.launch();
try {
  // F3 遮罩单层：overlay 无背景（洞内干净）+ --dim 占位类存在
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  await p3.evaluate(() => { try { closeModal(); } catch (e) {} });
  await p3.evaluate(() => { try { enterRolePreview('teacher'); } catch (e) {} });
  await sleep(3500);
  await p3.evaluate(() => { try { startOnboardingTour && startOnboardingTour(); } catch (e) {} });
  await sleep(900);
  const m = await p3.evaluate(() => {
    const ov = document.querySelector('.tour-overlay');
    const cs = getComputedStyle(ov);
    const hole = document.querySelector('.tour-hole--show');
    return { overlayBg: cs.backgroundColor, holeShown: !!hole, dimOn: ov.classList.contains('tour-overlay--dim') };
  });
  R.push(['F3 遮罩单层（overlay 透明）', m.overlayBg === 'rgba(0, 0, 0, 0)' && m.holeShown ? 'OK' : 'FAIL ' + JSON.stringify(m)]);
  R.push(['F3b 洞显示时无 --dim', m.dimOn ? 'FAIL dim残留' : 'OK']);
  await ctx3.close();

  // F4 学生端：qa_student 引导我的需求——卡面步点击开详情
  const ctx4 = await browser.newContext();
  const p4 = await ctx4.newPage();
  await p4.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2000);
  const okLogin4 = await login(p4, 'qa_student');
  if (!okLogin4) { R.push(['F4 学生登录', 'FAIL']); } else {
    await p4.evaluate(() => { try { startOnboardingTour && startOnboardingTour(); } catch (e) {} });
    await sleep(900);
    // 推进到卡面步（我的需求：MyDemands→MyDemandsList→Card）
    for (let i = 0; i < 3; i++) {
      const hb = await p4.locator('.tour-hole').boundingBox().catch(() => null);
      if (!hb) break;
      await p4.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await sleep(700);
    }
    const st4 = await p4.evaluate(() => ({
      bubble: (document.querySelector('.tour-bubble-text') || {}).textContent ? document.querySelector('.tour-bubble-text').textContent.slice(0, 14) : 'NO',
      detailOpen: !!document.querySelector('.modal .demand-detail'),
      hole: !!document.querySelector('.tour-hole--show'),
    }));
    R.push(['F4 学生端卡面→详情打开', st4.detailOpen ? 'OK' : 'FAIL ' + JSON.stringify(st4)]);
  }
  await ctx4.close();
} catch (e) {
  R.push(['X 异常', e.message.slice(0, 120)]);
}
await browser.close();
for (const [k, v] of R) console.log(k + ' => ' + v);
const fails = R.filter(([, v]) => v.startsWith('FAIL') || v.startsWith('X'));
console.log('RESULT:', fails.length ? fails.length + ' FAIL' : 'ALL PASS (' + R.length + ')');
process.exit(fails.length ? 1 : 0);
