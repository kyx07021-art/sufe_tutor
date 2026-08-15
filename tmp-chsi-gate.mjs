import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('C-ERR:', m.text().slice(0, 150)); });
page.on('response', r => { const u = r.url(); if (u.includes('/api/teacher/profile') || u.includes('/api/teacher/verify-status')) console.log('RESP:', r.status(), u.replace(BASE, '').slice(0, 50)); });
const resp = await (await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'qa_teacher', password: 'SufeQa2026!', deviceId: 'gate-diag' }),
})).json();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(2500);
await page.evaluate(([tok, usr]) => {
  localStorage.setItem('sufe_session_teacher', JSON.stringify({ user: usr, authToken: tok, expires: Date.now() + 3600000 }));
  localStorage.setItem('sufe_last_role', 'teacher');
}, [resp.authToken, resp.user]);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(3500);
await page.evaluate(() => selectPage('edit-profile'));
await sleep(2500);
const st = await page.evaluate(() => {
  const gate = document.getElementById('chsi-gate');
  const info = document.getElementById('chsi-info');
  const form = document.getElementById('profile-form');
  return {
    gateH: gate ? gate.classList.contains('hidden') : 'no',
    gateHtml: gate && !gate.classList.contains('hidden') ? gate.innerHTML.slice(0, 60) : 'hidden',
    infoH: info ? info.classList.contains('hidden') : 'no',
    formH: form ? form.classList.contains('hidden') : 'no',
  };
});
console.log('gate 状态:', JSON.stringify(st));
await browser.close();
