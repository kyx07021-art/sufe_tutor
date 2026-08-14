// v0.31.8 R1-R3 生产验证：wizard 8 页拆分 + 类型联动 + sliding track/完成态进度条
//   P1 8 页渲染 + sliding track 结构 + --dw-step-active 变量
//   P2 逐页校验（P1 省份/P2 上海线下地址/P3 年级/P4 科目/P8 联系方式）
//   P3 R1：P4 教学目标 tag-pick + P6 教师偏好页（偏好性格/性别移入）
//   P4 R2：切非学科 → P5 标题「技能现状」+ 成绩行清空 + 技能文本框；提交 payload 含 teaching_goal/skill_notes
//   P5 R3：完成态不跟当前页——新建 Next 校验通过 done；编辑翻到过 visited
//   P6 编辑回填：教学目标/技能 note/偏好跨页保留 + 服务端落库验证
import { chromium } from 'playwright';
const BASE = 'https://sufe-tutor.pages.dev';
const login = async (id) => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'SufeQa2026!' }) });
  if (r.status !== 200) { console.log('login', id, r.status, await r.text()); process.exit(1); }
  return r.json();
};
const { authToken, user } = await login('qa_student');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
p.on('dialog', d => d.dismiss().catch(() => {}));
await p.addInitScript(({ user, authToken }) => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('sufe_session_student', JSON.stringify({ user, authToken, expires: Date.now() + 3600e3 }));
  localStorage.setItem('sufe_last_role', 'student');
}, { user, authToken });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => typeof openDemandModal === 'function' && !!document.querySelector('.client-main'))) break; }
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`); };

// 打开新建需求表单（学生我的需求页）
await p.evaluate(() => selectPage('my-demands'));
await p.waitForTimeout(1500);
await p.evaluate(() => openDemandModal(null));
await p.waitForSelector('#demand-form .dw-step', { timeout: 10000 });
await p.waitForTimeout(600);

// P1 结构：8 页 + track + 变量
const s1 = await p.evaluate(() => ({
  steps: [...document.querySelectorAll('#demand-form .dw-step')].map(s => +s.dataset.step),
  track: !!document.querySelector('.dw-steps-track'),
  viewport: !!document.querySelector('.dw-steps-viewport'),
  activeIdx: document.getElementById('demand-form').style.getPropertyValue('--dw-step-active'),
  activeStep: +document.querySelector('.dw-step.dw-step--active').dataset.step,
  chips: document.querySelectorAll('#dw-stepper .dw-step-chip').length,
  goals: document.querySelectorAll('#d-teaching-goals .tag-pick').length,
  prefGenderStep: document.getElementById('d-pref-gender').closest('.dw-step').dataset.step,
}));
check('P1 8 页 + sliding track', s1.steps.length === 8 && s1.track && s1.viewport, `steps=${s1.steps.length} track=${s1.track} viewport=${s1.viewport}`);
check('P1 初始 P1 + 变量 0', s1.activeStep === 1 && s1.activeIdx === '0', `active=${s1.activeStep} idx=${s1.activeIdx}`);
check('P3 R1 教学目标 + 教师偏好独立页', s1.goals >= 6 && s1.prefGenderStep === '6', `goals=${s1.goals} prefGender P${s1.prefGenderStep}`);

// P2 逐页校验：P1 缺省份拦截
await p.evaluate(() => demandWizardNext());
const blocked1 = await p.evaluate(() => +document.querySelector('.dw-step.dw-step--active').dataset.step === 1);
check('P2 P1 缺省份拦截', blocked1, `P1 不前进`);

// 走合法流：P1 选省 → P2 线上 → ... → P4 勾科目 → 选教学目标 → P6 → P7 → P8 提交按钮
await p.evaluate(() => { document.getElementById('d-province').value = 'shanghai'; onDemandProvinceChange(); demandWizardNext(); });
await p.waitForTimeout(400); // 侧滑动画
await p.evaluate(() => demandWizardNext()); // P2 线上放行
await p.waitForTimeout(400);
await p.evaluate(() => { document.getElementById('d-grade').value = 'senior1'; updateDemandSubjects(); demandWizardNext(); }); // P3
await p.waitForTimeout(400);
// P4 勾科目 + 教学目标
await p.evaluate(() => {
  const cb = [...document.querySelectorAll('#d-subjects input')].find(c => c.value === 'math');
  cb.checked = true; updateDemandScores();
  [...document.querySelectorAll('#d-teaching-goals .tag-pick')].find(b => b.dataset.id === 'score').classList.add('selected');
  demandWizardNext();
});
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext()); // P5 成绩可选
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext()); // P6 教师偏好可选
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext()); // P7 预算
await p.waitForTimeout(400);
const s2 = await p.evaluate(() => ({
  active: +document.querySelector('.dw-step.dw-step--active').dataset.step,
  submitVisible: !document.getElementById('d-submit').classList.contains('hidden'),
  submitEnabled: !document.getElementById('d-submit').disabled,
  nextHidden: document.getElementById('dw-next').classList.contains('hidden'),
  p1Done: [...document.querySelectorAll('#dw-stepper .dw-step-chip')].find(c => +c.dataset.step === 1).classList.contains('dw-step-chip--done'),
  p1Lined: [...document.querySelectorAll('#dw-stepper .dw-step-chip')].find(c => +c.dataset.step === 1).classList.contains('dw-step-chip--lined'),
}));
check('P2 合法流到 P8 提交', s2.active === 8 && s2.submitVisible && s2.submitEnabled && s2.nextHidden, `P${s2.active} submit=${s2.submitVisible}`);
check('P5 R3 完成态：P1 校验通过 done + 连线实紫', s2.p1Done && s2.p1Lined, `P1 done=${s2.p1Done} lined=${s2.p1Lined}`);

// P4 R2：关掉表单重开，切非学科验证联动
await p.evaluate(() => closeModal());
await p.waitForTimeout(400);
await p.evaluate(() => openDemandModal(null));
// 等表单 DOM 就绪（.dw-step 常驻；#d-type-tabs 在 P4 非 active 步 visibility:hidden，waitForSelector visible 等不到——JS 操作不依赖可见性）
await p.waitForSelector('#demand-form .dw-step', { timeout: 10000 });
await p.waitForTimeout(300);
await p.evaluate(() => switchDemandType({ dataset: { type: 'nonacademic' } }));
await p.waitForTimeout(300);
const s3 = await p.evaluate(() => ({
  title: document.getElementById('d-scores-title').textContent,
  scoreRows: document.querySelectorAll('#d-scores .region-score-row').length,
  skillHidden: document.getElementById('d-skill-notes').classList.contains('hidden'),
}));
check('P4 R2 切非学科：标题技能现状 + 成绩清空', s3.title === '技能现状' && s3.scoreRows === 0 && !s3.skillHidden, `title=${s3.title} scoreRows=${s3.scoreRows}`);
// 勾非学科项目 → 技能文本框渲染
await p.evaluate(() => {
  const cb = [...document.querySelectorAll('#d-nonacademic input')].find(c => c.value === 'music');
  cb.checked = true; renderSkillNotes();
});
const s4 = await p.evaluate(() => ({
  noteRows: document.querySelectorAll('#d-skill-notes .skill-note-row').length,
  noteLabel: document.querySelector('#d-skill-notes .skill-note-label')?.textContent,
}));
check('P4 R2 技能文本框按项目渲染', s4.noteRows === 1 && s4.noteLabel === '乐器/音乐', `rows=${s4.noteRows} label=${s4.noteLabel}`);

// P6 提交非学科需求（含技能 note + 教学目标）→ 服务端落库
await p.evaluate(() => closeModal());
await p.waitForTimeout(400);
await p.evaluate(() => openDemandModal(null));
await p.waitForTimeout(300);
// 走全流程非学科
await p.evaluate(() => { document.getElementById('d-province').value = 'shanghai'; onDemandProvinceChange(); demandWizardNext(); });
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext());
await p.waitForTimeout(400);
await p.evaluate(() => { document.getElementById('d-grade').value = 'senior1'; updateDemandSubjects(); demandWizardNext(); });
await p.waitForTimeout(400);
await p.evaluate(() => { switchDemandType({ dataset: { type: 'nonacademic' } });
  const cb = [...document.querySelectorAll('#d-nonacademic input')].find(c => c.value === 'music'); cb.checked = true; renderSkillNotes();
  [...document.querySelectorAll('#d-teaching-goals .tag-pick')].find(b => b.dataset.id === 'interest').classList.add('selected');
  demandWizardNext(); });
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext());
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext());
await p.waitForTimeout(400);
await p.evaluate(() => demandWizardNext());
await p.waitForTimeout(400);
await p.evaluate(() => {
  const ta = document.querySelector('#d-skill-notes .skill-note-row[data-project="music"] textarea');
  if (ta) ta.value = '钢琴八级';
  document.getElementById('d-parent-contact').value = '13800138000';
  document.getElementById('d-student-contact').value = '13900139000';
  document.getElementById('d-submit').click();
});
await p.waitForTimeout(2500);
const created = await p.evaluate(() => !document.getElementById('modal-container').innerHTML.includes('demand-form'));
check('P6 非学科需求提交成功（含技能/教学目标）', created, `表单已提交关闭`);
// 服务端验证落库（本人需求）
const my = await fetch(BASE + '/api/student/demands?scope=mine', { headers: { 'X-Auth-Token': authToken } });
const myJson = await my.json();
const mine = (myJson.demands || myJson || []).filter(d => d.target_type === 'nonacademic')[0];
check('P6 落库 teaching_goal/skill_notes', mine && mine.teaching_goal?.includes('interest') && mine.skill_notes?.[0]?.project === 'music' && mine.skill_notes?.[0]?.note === '钢琴八级',
  mine ? `goal=${JSON.stringify(mine.teaching_goal)} skill=${JSON.stringify(mine.skill_notes)}` : '无数据');
// 编辑回填（P6）
await p.evaluate((id) => openDemandModal(id), mine.id);
await p.waitForTimeout(800);
const s6 = await p.evaluate(() => ({
  title: document.getElementById('d-scores-title').textContent,
  goalSel: [...document.querySelectorAll('#d-teaching-goals .tag-pick.selected')].map(b => b.dataset.id),
  noteVal: document.querySelector('#d-skill-notes .skill-note-row[data-project="music"] textarea')?.value || '',
  prefStep: +document.querySelector('.dw-step.dw-step--active').dataset.step,
}));
check('P6 编辑回填：技能现状/教学目标/note/回 P1', s6.title === '技能现状' && s6.goalSel.includes('interest') && s6.noteVal === '钢琴八级' && s6.prefStep === 1,
  `title=${s6.title} goal=${JSON.stringify(s6.goalSel)} note=${s6.noteVal} P${s6.prefStep}`);
// 清理测试数据
await p.evaluate(() => closeModal());
await p.waitForTimeout(300);
const del = await fetch(BASE + '/api/student/demands/' + mine.id, { method: 'DELETE', headers: { 'X-Auth-Token': authToken } });
check('清理测试需求', del.status === 200, `DELETE ${del.status}`);

await browser.close();
const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
