// S5 全站自查：主要页面控制台错误 + 关键布局断言（read-only 生产走查）
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 200)}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${String(e).slice(0, 200)}`));

async function walk(url, checks) {
  errors.length = 0;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const out = [];
  for (const [name, fn] of checks) {
    try { out.push(`${name}: ${await fn()}`); } catch (e) { out.push(`${name}: FAIL ${String(e).slice(0, 120)}`); }
  }
  console.log(`\n=== ${url} ===`);
  out.forEach(l => console.log(' ', l));
  const uniq = [...new Set(errors)];
  console.log(uniq.length ? `  错误(${uniq.length}):` : '  无控制台错误');
  uniq.forEach(e => console.log('   -', e.slice(0, 180)));
}

// 游客首页（登录页）
await walk('https://sufe-tutor.pages.dev/', [
  ['登录表单渲染', async () => (await page.locator('.auth-identifier, .auth-card').count()) > 0 ? 'OK' : 'MISSING'],
  ['页脚分隔', async () => { const el = page.locator('.auth-footer--split'); return (await el.count()) ? 'OK' : 'MISSING'; }],
]);

// 管理员统计页（修复验证点）
await page.goto('https://sufe-tutor.pages.dev/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.fill('.auth-identifier input, #auth-identifier, .auth-card input', 'admin_sufe').catch(() => {});
await page.fill('#auth-password', 'admin_sufe').catch(() => {});
await page.click('.auth-submit, .btn[onclick*="submit"], .auth-card button[type="submit"]').catch(() => {});
await page.waitForTimeout(5000);
const statsErrors = errors.slice();
console.log('\n=== 管理端登录后 ===');
console.log('  URL:', page.url());
const statsText = await page.locator('body').innerText().catch(() => '');
console.log('  统计页含「加载失败」:', statsText.includes('加载失败') ? 'YES(坏)' : 'NO(好)');
console.log('  统计页含「统计」:', statsText.includes('统计') ? 'YES' : 'NO');
console.log(statsErrors.length ? `  错误(${statsErrors.length}):` : '  无控制台错误');
statsErrors.forEach(e => console.log('   -', e.slice(0, 180)));

await browser.close();
console.log('\n走查完成');
