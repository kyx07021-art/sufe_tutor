// v1.4.5 T3 生产验证：qa_teacher（未验证学信网）引导——edit-profile 段显示验证门引导 + 表单步骤跳过
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  // 会话注入（绕登录限流——复用令牌纪律）：curl 登录拿 token + localStorage 注入
  const resp = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!', deviceId: 't3-chsi' }),
  })).json();
  await page.evaluate(([tok, usr]) => {
    localStorage.setItem('sufe_session_teacher', JSON.stringify({ user: usr, authToken: tok, expires: Date.now() + 3600000 }));
    localStorage.setItem('sufe_last_role', 'teacher');
  }, [resp.authToken, resp.user]);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  const role = await page.evaluate(() => state.user && state.user.role);
  console.log('登录角色:', role);
  if (role !== 'teacher') { console.log('RESULT: T3 FAIL 登录失败'); process.exit(1); }
  // 手动触发教师引导
  await page.evaluate(() => { try { startOnboardingTour && startOnboardingTour(); } catch (e) {} });
  await sleep(900);
  // 快速推进到 edit-profile 段（每步点击——最多 60 步）
  let sawChsi = false, sawForm = false, stepCount = 0;
  for (let i = 0; i < 70; i++) {
    const st = await page.evaluate(() => {
      const b = document.querySelector('.tour-bubble-text');
      const gate = document.getElementById('chsi-gate');
      return {
        text: b ? b.textContent : null,
        gateVisible: gate ? !gate.classList.contains('hidden') : false,
        hole: !!document.querySelector('.tour-hole--show'),
      };
    });
    if (!st.text) break;
    stepCount = i + 1;
    if (st.text.includes('学信网')) sawChsi = true;
    if (st.text.includes('资料表单')) sawForm = true;
    if (stepCount >= 28 && stepCount <= 42) {
      console.log('步 ' + stepCount + ':', (st.text || '').slice(0, 22), '| gate显示:', st.gateVisible);
    }
    await page.evaluate(() => { const h = document.querySelector('.tour-hole'); if (h) h.click(); });
    await sleep(450);
    if (sawChsi && stepCount > 5 && !st.hole && !st.text) break;
  }
  console.log('总步数:', stepCount, '| 见学信网门引导:', sawChsi, '| 见资料表单介绍:', sawForm);
  const ok = sawChsi && !sawForm; // 未验证：应见验证门引导、不见表单介绍
  console.log('RESULT:', ok ? 'T3 PASS（未验证分支正确）' : 'T3 FAIL');
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log('X 异常:', e.message.slice(0, 120));
  process.exit(1);
} finally {
  await browser.close();
}
