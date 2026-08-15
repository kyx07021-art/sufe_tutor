// v1.4.3 生产验证：详情浮窗学习目标 tag + 联系方式占位 + 教师卡底部两列解耦
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = [];
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  await page.evaluate(() => { try { enterRolePreview('teacher'); } catch (e) {} });
  await sleep(4000);
  // 需求详情浮窗：学习目标 tag + 联系方式占位
  await page.evaluate(() => { try { selectPage('browse-demands'); } catch (e) {} });
  await sleep(2500);
  await page.evaluate(() => { const el = document.querySelector('.list-card--demand'); if (el) el.click(); });
  await sleep(800);
  const d = await page.evaluate(() => {
    const pills = [...document.querySelectorAll('.demand-subj-pill')].map(p => p.textContent.trim());
    const hint = document.querySelector('.demand-detail-contact-hint');
    const contactRow = [...document.querySelectorAll('.demand-detail-row')].find(r => r.textContent.includes('联系方式'));
    return { pills, hint: hint ? hint.textContent.trim() : null, hasContactRow: !!contactRow };
  });
  R.push(['A 学习目标 tag 渲染', d.pills.some(p => ['提分','培优','竞赛','兴趣培养','习惯养成','考前冲刺'].includes(p)) ? 'OK ' + d.pills.join('|') : 'FAIL ' + d.pills.join('|')]);
  R.push(['B 联系方式占位灰字', d.hint === '签约后可查看联系方式' ? 'OK' : 'FAIL ' + d.hint]);
  R.push(['C 联系方式行存在', d.hasContactRow ? 'OK' : 'FAIL']);
  // 教师卡底部两列解耦
  await page.evaluate(() => { try { closeModal(); } catch (e) {} });
  await sleep(300);
  await page.evaluate(() => { try { selectPage('browse-teachers'); } catch (e) {} });
  await sleep(3000);
  const t = await page.evaluate(() => {
    const card = document.querySelector('.list-card--teacher');
    if (!card) return null;
    const bottom = card.querySelector('.tc-bottom');
    const left = card.querySelector('.tc-bottom-left');
    const right = card.querySelector('.tc-bottom-right');
    const intro = card.querySelector('.tc-intro');
    const actions = card.querySelector('.tc-actions');
    if (!bottom || !left || !right) return { err: 'no-bottom' };
    const lb = left.getBoundingClientRect(), rb = right.getBoundingClientRect();
    return {
      hasIntro: !!intro, hasActions: !!actions,
      leftRight: lb.right <= rb.left, // 左列在右列左边（解耦分栏）
      sameRow: Math.abs(lb.top - rb.top) < 2, // 同行
      leftW: Math.round(lb.width), rightW: Math.round(rb.width),
    };
  });
  R.push(['D 教师卡两列解耦容器', t && !t.err ? 'OK' : 'FAIL ' + JSON.stringify(t)]);
  R.push(['E 左列简介右列按钮分栏', t && t.hasIntro && t.hasActions && t.leftRight && t.sameRow ? 'OK 左' + t.leftW + 'px 右' + t.rightW + 'px' : 'FAIL ' + JSON.stringify(t)]);
} catch (e) {
  R.push(['X 异常', e.message.slice(0, 100)]);
}
await browser.close();
for (const [k, v] of R) console.log(k + ' => ' + v);
const fails = R.filter(([, v]) => v.startsWith('FAIL') || v.startsWith('X'));
console.log('RESULT:', fails.length ? fails.length + ' FAIL' : 'ALL PASS (' + R.length + ')');
process.exit(fails.length ? 1 : 0);
