// v0.29.0 需求五生产验证：地址结构化（区·镇/街道）+ 匹配度镇间距离 + 存量兼容
// QA 固定账户；临时数据验证后删除，不污染生产。
import { chromium } from 'playwright';

const BASE = 'https://sufe-tutor.pages.dev';
const results = [];
const ok = (name, pass, detail = '') => results.push((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));

const AUTH = async (identifier, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200) throw new Error('login ' + identifier + ' failed: ' + r.status + ' ' + await r.text());
  return r.json();
};
const J = h => ({ ...h, 'Content-Type': 'application/json' });
const post = (url, token, body) => fetch(BASE + url, { method: 'POST', headers: J(token ? { 'X-Auth-Token': token } : {}), body: JSON.stringify(body) });
const del = (url, token) => fetch(BASE + url, { method: 'DELETE', headers: J({ 'X-Auth-Token': token }) });

const DEMAND_OK = '嘉定区·南翔镇';       // 教师常住地 嘉定·嘉定镇街道 ↔ 南翔镇 = 11.49km
const DEMAND_NEAR = '嘉定区·嘉定镇街道';   // 同镇 0km → 「零距离」满分
const createdIds = [];
let stuTok = null;

const cleanup = async () => {
  // 无待清理项或未持有令牌时不再登录（避免重复触发登录限流）
  if (!createdIds.length || !stuTok) return;
  for (const id of createdIds) {
    const r = await del('/api/student/demands/' + id, stuTok);
    if (r && !r.ok) console.log('cleanup ' + id + ': ' + r.status);
  }
};

try {
  const stu = await AUTH('qa_student', 'SufeQa2026!');
  const tch = await AUTH('qa_teacher', 'SufeQa2026!');
  stuTok = stu.authToken; const tchTok = tch.authToken;
  ok('登录 qa_student/qa_teacher', true, 'student=' + stu.user.id + ' teacher=' + tch.user.id);

  const mk = (address, method, extra) => post('/api/student/demands', stuTok, {
    demand: Object.assign({ province: 'shanghai', student_grade: 'senior1', student_gender: 'female',
      target_type: 'academic', target_subjects: ['math'], current_scores: [],
      teaching_method: method || 'offline', address: address || '', additional_info: '',
      budget_min: 100, budget_max: 200, submitter_type: 'parent',
      parent_contact: '13800138000', student_contact: '13900139000' }, extra || {}),
  });

  // 1) 三条临时需求：南翔（11.49km）/ 同镇嘉定镇街道（0km）/ 线上单
  const okRes = await mk(DEMAND_OK);
  const okBody = await okRes.json();
  ok('上海线下合法「区·镇/街道」地址创建', okRes.status === 200, 'status=' + okRes.status + ' id=' + okBody.id);
  if (okBody.id) createdIds.push(okBody.id);
  const nearRes = await mk(DEMAND_NEAR);
  const nearBody = await nearRes.json();
  ok('同镇地址创建', nearRes.status === 200, 'id=' + nearBody.id);
  if (nearBody.id) createdIds.push(nearBody.id);

  // 2) 非法地址 → 400 ADDRESS_REQUIRED（单区名/自由文本均拒）
  for (const bad of ['杨浦区', '上海市嘉定区南翔镇xx路88号', '浦东新区杨高中路']) {
    const r = await mk(bad);
    const b = await r.json();
    ok('非法地址拒绝 400（' + bad + '）', r.status === 400 && b.error === '请选择授课所在区与镇/街道', r.status + ' ' + b.error);
  }

  // 3) 线上单：地址被清空（线上不收集地址）
  const onlineRes = await mk('', 'online');
  const onlineBody = await onlineRes.json();
  ok('线上单创建', onlineRes.status === 200, 'id=' + onlineBody.id);
  if (onlineBody.id) {
    createdIds.push(onlineBody.id);
    const got = await (await fetch(BASE + '/api/student/demands?scope=mine', { headers: { 'X-Auth-Token': stuTok } })).json();
    const mine = (got.demands || []).find(d => d.id === onlineBody.id);
    ok('线上单 address 落库为空', mine && mine.address === '', mine ? 'address=' + JSON.stringify(mine.address) : '未找到');
  }

  // 4) 教师档案：非法结构化地址 → 400；合法常住地 → 200
  const profBad = await post('/api/teacher/profile', tchTok, { profile: { province: 'shanghai', address: '嘉定镇' } });
  const profBadBody = await profBad.json();
  ok('教师档案非法地址 400', profBad.status === 400, profBad.status + ' ' + profBadBody.error);
  const profOk = await post('/api/teacher/profile', tchTok, { profile: { province: 'shanghai', grade: 'senior1', gender: 'female', subjects: ['math'], price_min: 150, price_max: 200, intro: '验证距离匹配', address: '嘉定区·嘉定镇街道' } });
  ok('教师档案设上海常住地 200', profOk.status === 200, 'status=' + profOk.status);

  // 5) 教师需求大厅：匹配度明细——上海线下单区域维 = 镇间距离
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.addInitScript(({ user, authToken }) => {
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
      localStorage.setItem('sufe_session_teacher', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
      localStorage.setItem('sufe_last_role', 'teacher');
    }, { user: tch.user, authToken: tchTok });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    let wentHall = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1200);
      const ready = await page.evaluate(() => !!(document.getElementById('view-client') && typeof selectPage === 'function' && typeof loadBrowseDemands === 'function'));
      if (ready) { await page.evaluate(() => selectPage('browse-demands')).catch(() => {}); wentHall = true; break; }
    }
    ok('进入需求大厅', wentHall, '');
    let detailHtml = null, nearHtml = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1200);
      const r = await page.evaluate(({ farId, nearId }) => {
        const btnFar = document.querySelector('.list-card--demand[data-demand-id="' + farId + '"] .match-btn');
        const btnNear = document.querySelector('.list-card--demand[data-demand-id="' + nearId + '"] .match-btn');
        let d1 = null, d2 = null;
        if (btnFar) { btnFar.click(); const card = document.querySelector('.match-detail'); if (card) d1 = card.innerText; }
        if (btnNear) { btnNear.click(); const card2 = document.querySelector('.match-detail'); if (card2) d2 = card2.innerText; }
        return { d1: d1, d2: d2, foundFar: !!btnFar, foundNear: !!btnNear };
      }, { farId: createdIds[0], nearId: createdIds[1] });
      if (r.d1 && r.d2) { detailHtml = r.d1; nearHtml = r.d2; break; }
      if (r.foundFar && r.foundNear) { detailHtml = r.d1; nearHtml = r.d2; break; }
    }
    ok('南翔镇需求匹配明细卡出现', !!detailHtml, detailHtml ? '' : '未找到匹配明细');
    if (detailHtml) {
      const line = detailHtml.split('\n').find(l => l.includes('距') || l.includes('公里') || l.includes('区域'));
      ok('距离维 hint 显示公里数', detailHtml.includes('距授课点约') && /\d+ 公里/.test(detailHtml), line || '');
    }
    if (nearHtml) {
      const line = nearHtml.split('\n').find(l => l.includes('零距离') || l.includes('区域'));
      ok('同镇需求「零距离」满分', nearHtml.includes('零距离'), line || '');
    }
    const onlineR = await page.evaluate((oid) => {
      const btn = document.querySelector('.list-card--demand[data-demand-id="' + oid + '"] .match-btn');
      if (!btn) return null;
      btn.click();
      const card = document.querySelector('.match-detail');
      return card ? card.innerText : null;
    }, createdIds[2]);
    ok('线上单匹配明细卡出现', !!onlineR, '');
    if (onlineR) {
      const line = onlineR.split('\n').find(l => l.includes('线上') || l.includes('区域') || l.includes('计入'));
      ok('线上单区域维 = 距离不计分', onlineR.includes('线上授课') || onlineR.includes('未计入'), line || '');
    }
    await page.evaluate(() => selectPage('edit-profile')).catch(() => {});
    let hasPicker = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1200);
      hasPicker = await page.evaluate(() => {
        const el = document.getElementById('profile-addr-picker');
        return !!(el && el.querySelector('.sh-addr-district') && document.getElementById('profile-address').value === '嘉定区·嘉定镇街道');
      });
      if (hasPicker) break;
    }
    ok('教师档案页渲染上海常住地 picker 且回填常住地', hasPicker, '');
    await browser.close(); browser = null;
  } catch (e) { ok('前端 UI 走查', false, e.message); }

  // 7) 存量兼容（服务端）：旧自由文本地址保存 → 400（提示重选，前端回填已清空）
  const legacy = await post('/api/teacher/profile', tchTok, { profile: { province: 'shanghai', address: '上海市嘉定区南翔镇民主街88号' } });
  ok('旧自由文本地址保存被拒 400', legacy.status === 400, 'status=' + legacy.status);
} catch (e) {
  ok('脚本异常', false, e.message);
} finally {
  await cleanup();
}

console.log(results.join('\n'));
const fails = results.filter(r => r.startsWith('FAIL')).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' PASS');
process.exit(fails ? 1 : 0);
