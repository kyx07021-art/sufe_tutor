/**
 * 需求五·匹配度优化单测（node:vm 模拟浏览器经典脚本全局）
 * 覆盖：
 *   - matchDegree 五维算法（科目/性格/区域/预算/性别）与归一化
 *   - genderMatchScore：需求均可 / 教师 nonbinary（不愿透露）折半 / 相反 0
 *   - personality 重合度口径：重合数/需求偏好数；需求无偏好跳过；教师无性格 → 0
 *   - matchLevel 三色阈值（CONFIG.MATCH_COLOR_HIGH/MID）
 *   - matchDetailHtml：五维行 + 计分口径文案内嵌权重
 *   - 学生端教师匹配度：attachStudentMatch 取最高值、逐需求降序、排序、卡徽章、明细卡结构与开关
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx(html = '<!DOCTYPE html><html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  return {
    ctx: vm.createContext({
      window: w, document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      localStorage: w.localStorage,
      console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    }),
    dom,
  };
}

// 共享脚本加载序（同 index.html）：constants → region-data → app-display → app-state → app-api →
// app-datahub → app-anim → app-ui → app-demands → app-teachers（app-teachers 依赖 match 系列）
const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-demands.js', 'app-teachers.js'];
function loadCommon(ctx) {
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
}

// 夹具注入 vm 全局（权重 constants CONFIG.MATCH_WEIGHT：subject 45 / personality 15 / region 15 / budget 15 / gender 10）
function seedFixtures(ctx) {
  vm.runInContext(`
    const TEACHER = { subjects: ['math', 'english'], province: 'shanghai', price_min: 150, price_max: 180,
      personality_tags: ['patience', 'humorous'], gender: 'male', nonacademic_projects: [] };
    const DEMAND = { id: 1, target_type: 'academic', target_subjects: ['math', 'physics'], province: 'shanghai',
      budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience', 'strict'], preferred_teacher_gender: 'male' };
  `, ctx);
}

test('matchDegree 五维综合（全命中口径）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 科目 22.5 + 性格 7.5 + 区域 15 + 预算 15 + 性别 10 = 70 / total 100 → 70
  assert.equal(vm.runInContext('matchDegree(TEACHER, DEMAND)', ctx), 70);
});

test('matchDegree 性别：教师 nonbinary（不愿透露）对明确偏好折半 50', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 性别 50/100*10 = 5 → score 22.5+7.5+15+15+5 = 65 / 100 → 65
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, gender: "nonbinary" }, DEMAND)', ctx), 65);
});

test('matchDegree 性别：教师未填性别对明确偏好同样折半（视同不愿透露）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, gender: "" }, DEMAND)', ctx), 65);
});

test('matchDegree 性别：偏好 male 对教师 female → 0', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 性别 0 → score 22.5+7.5+15+15+0 = 60 / 100 → 60
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, gender: "female" }, DEMAND)', ctx), 60);
});

test('matchDegree 性别：需求均可（""）任何教师 100（含不愿透露）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  assert.equal(vm.runInContext('matchDegree(TEACHER, { ...DEMAND, preferred_teacher_gender: "" })', ctx), 70, '教师 male + 需求均可：性别维全分，其余同综合例');
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, gender: "nonbinary" }, { ...DEMAND, preferred_teacher_gender: "" })', ctx), 70, '教师 nonbinary + 需求均可：仍 100');
});

test('matchDegree 性格：需求无偏好 → 维度不适用（不计权重）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 科目 22.5 + 区域 15 + 预算 15 + 性别 10 = 62.5 / total 85 → round(73.5) = 74
  assert.equal(vm.runInContext('matchDegree(TEACHER, { ...DEMAND, preferred_personality_tags: [] })', ctx), 74);
});

test('matchDegree 性格：教师无性格 tag 且需求有偏好 → 重合 0', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 性格 0 → score 22.5+0+15+15+10 = 62.5 / 100 → 63
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, personality_tags: [] }, DEMAND)', ctx), 63);
});

test('matchDegree 性格：全中更高（2/2 偏好命中 → 78，高于基础 1/2 的 70）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // pHit 2/2 → 性格 15 → score 22.5+15+15+15+10 = 77.5 / 100 → 78
  assert.equal(vm.runInContext('matchDegree({ ...TEACHER, personality_tags: ["patience", "strict"] }, DEMAND)', ctx), 78);
});

test('genderMatchScore 单点口径（undeclared 同 nonbinary 未披露）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  assert.equal(vm.runInContext('genderMatchScore("", "male")', ctx), 100);
  assert.equal(vm.runInContext('genderMatchScore("", "nonbinary")', ctx), 100);
  assert.equal(vm.runInContext('genderMatchScore("", "undeclared")', ctx), 100, '需求均可 + 不愿透露 → 100');
  assert.equal(vm.runInContext('genderMatchScore("male", "male")', ctx), 100);
  assert.equal(vm.runInContext('genderMatchScore("male", "female")', ctx), 0);
  assert.equal(vm.runInContext('genderMatchScore("male", "nonbinary")', ctx), 50);
  assert.equal(vm.runInContext('genderMatchScore("male", "undeclared")', ctx), 50, '明确偏好 + 教师不愿透露 → 折半');
  assert.equal(vm.runInContext('genderMatchScore("female", "")', ctx), 50);
});

test('DISP.genderName：undeclared/非binary/空 一律不显字，仅男/女出字', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  assert.equal(vm.runInContext('DISP.genderName("undeclared")', ctx), '', '不愿透露 → 不展示');
  assert.equal(vm.runInContext('DISP.genderName("nonbinary")', ctx), '', '历史 nonbinary → 不展示');
  assert.equal(vm.runInContext('DISP.genderName("")', ctx), '', '空 → 不展示');
  assert.equal(vm.runInContext('DISP.genderName("male")', ctx), '男');
  assert.equal(vm.runInContext('DISP.genderName("female")', ctx), '女');
  assert.equal(vm.runInContext('DISP.demandStudentGenderName("undeclared")', ctx), '', '需求侧同口径');
});

test('matchLevel 三色阈值', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  assert.equal(vm.runInContext('matchLevel(100)', ctx), 'hi');
  assert.equal(vm.runInContext('matchLevel(80)', ctx), 'hi');
  assert.equal(vm.runInContext('matchLevel(79)', ctx), 'mid');
  assert.equal(vm.runInContext('matchLevel(60)', ctx), 'mid');
  assert.equal(vm.runInContext('matchLevel(59)', ctx), 'lo');
  assert.equal(vm.runInContext('matchLevel(0)', ctx), 'lo');
});

test('matchDetailHtml：五维行齐全 + 计分口径内嵌当前权重', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  const html = vm.runInContext('matchDetailHtml(TEACHER, DEMAND, 70)', ctx);
  for (const k of ['科目匹配', '性格匹配', '区域匹配', '预算匹配', '性别匹配']) {
    assert.ok(html.includes(k), `明细应含 ${k}`);
  }
  assert.ok(html.includes('科目 45 分'), '计分口径应含科目权重 45');
  assert.ok(html.includes('性格 15 分'), '计分口径应含性格权重 15');
  assert.ok(html.includes('性别 10 分'), '计分口径应含性别权重 10');
  assert.ok(html.includes('命中 1/2 个偏好性格'), '性格命中提示');
  assert.ok(html.includes('match-row'), '明细行结构');
});

test('需求卡匹配度按钮：三色遮罩类 + 「匹配度N% · 点击展开明细」文案', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx); seedFixtures(ctx);
  // 70 → mid 黄；直接调 renderDemandCard（教师视角，myTeacher 显式传夹具）
  const html = vm.runInContext(`renderDemandCard(
    { ...DEMAND, id: 2, display_id: 7, student_grade: 'senior1', student_gender: 'female', status: 'open', username: '学生A', avatar: '', created_at: '2026-08-07 04:27:09' },
    { teacher: true, myTeacher: TEACHER }
  )`, ctx);
  assert.ok(html.includes('tag-match match-btn match-btn--mid'), '70 → mid 黄');
  assert.ok(html.includes('匹配度 70%'), '匹配度文案');
  assert.ok(html.includes('点击展开明细'), '展开明细提示');
});

// ============================================================
// 学生端教师匹配度（item5）＋ 排序（item6）
// ============================================================
test('学生端教师列表：逐需求取最高匹配值、明细降序、排序与卡徽章', async () => {
  const { ctx, dom } = makeCtx('<!DOCTYPE html><html><body><div id="teachers-list"></div></body></html>');
  loadCommon(ctx);
  ctx.T_HIGH = {
    user_id: 1, username: 'T高', subjects: ['math'], province: 'shanghai', price_min: 150,
    personality_tags: ['patience'], gender: 'male', avatar: '', rating: 5,
  };
  ctx.T_LOW = {
    user_id: 2, username: 'T低', subjects: ['english'], province: 'beijing', price_min: 150,
    personality_tags: [], gender: 'female', avatar: '', rating: 4,
  };
  // 开放需求两条件为：T高 对 #0007 满分、对 #0008 低分；T低 对 #0007 低分、对 #0008 中分 → 最高值 T高100 > T低75
  vm.runInContext(`
    state.user = { id: 50, username: '学生S', role: 'student' };
    state.allTeachers = [T_HIGH, T_LOW];
    dhGet = async (url) => {
      if (url.includes('scope=mine')) return { demands: [
        { id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1', province: 'shanghai', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male', status: 'open' },
        { id: 12, display_id: 8, target_type: 'academic', target_subjects: ['english'], student_grade: 'junior2', province: 'beijing', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male', status: 'open' },
        { id: 13, display_id: 9, target_type: 'academic', target_subjects: ['math'], status: 'contracted' },
      ] };
      return {};
    };
  `, ctx);
  await vm.runInContext('attachStudentMatch([T_HIGH, T_LOW])', ctx);

  const hi = vm.runInContext('T_HIGH._matchForStudent', ctx);
  assert.equal(hi.md, 100, 'T高最高匹配 = 对 #0007 满分');
  assert.equal(hi.items.length, 2, '仅开放需求参与，contracted 不计');
  assert.equal(hi.items[0].d.id, 11, '明细按匹配度降序：先 #0007(100)');
  assert.equal(hi.items[1].d.id, 12, '后 #0008(40)');

  const lo = vm.runInContext('T_LOW._matchForStudent', ctx);
  assert.equal(lo.md, 75, 'T低最高匹配 75');

  // 排序：T高(100) 在前、T低(75) 在后（Array.from 剥 vm realm 数组原型，deepEqual 才可严格比较）
  vm.runInContext('sortTeachersByMatch([T_HIGH, T_LOW])', ctx);
  assert.deepEqual(Array.from(vm.runInContext('[T_HIGH.user_id, T_LOW.user_id]', ctx)), [1, 2], '默认按最高匹配度降序');

  // 卡徽章：三色类 + 文案（插入 DOM 供明细卡测试取按钮）
  vm.runInContext(`document.getElementById('teachers-list').innerHTML = renderTeacherCard(T_HIGH) + renderTeacherCard(T_LOW)`, ctx);
  const cardHtml = vm.runInContext('renderTeacherCard(T_HIGH)', ctx);
  assert.ok(cardHtml.includes('match-btn--hi'), '100 → hi 绿');
  assert.ok(cardHtml.includes('匹配度 100%'), '卡上最高匹配度文案');
  assert.ok(cardHtml.includes('tc-match'), '徽章独立行不挤 username');
  const lowCardHtml = vm.runInContext('renderTeacherCard(T_LOW)', ctx);
  assert.ok(lowCardHtml.includes('match-btn--mid'), '75 → mid 黄');

  // 明细卡：逐需求降序 + 头部格式【需求#xxxx · 主要信息】匹配度：xx%
  vm.runInContext(`showTeacherMatchDetail(document.querySelector('.tag-match'))`, ctx);
  const detail = dom.window.document.querySelector('.match-detail');
  assert.ok(detail, '明细卡已挂载');
  assert.ok(detail.classList.contains('match-detail--teacher'), '学生端明细卡变体');
  const heads = [...detail.querySelectorAll('.match-t-head')];
  assert.equal(heads.length, 2);
  assert.ok(heads[0].textContent.includes('需求#0007') && heads[0].textContent.includes('匹配度：100%'), '首条 = 最高匹配需求（头行格式【需求#xxxx · 主要信息 匹配度：xx%】）');
  assert.ok(heads[1].textContent.includes('需求#0008'), '次条 = 次高');
  assert.ok(detail.querySelector('.match-t-item .match-row'), '每条含五维明细行');
  assert.ok(detail.querySelector('.match-t-list').style.maxHeight.includes('320'), '条目区限高（CONFIG.MATCH_DETAIL_MAX_HEIGHT）');

  // 关闭：同教师端共用开关
  vm.runInContext('closeMatchDetail()', ctx);
  assert.ok(!dom.window.document.querySelector('.match-detail'), '明细卡已移除');
});

test('学生端教师匹配：开放需求归零后旧徽章清除（v0.25.8 审计修复）', async () => {
  const { ctx } = makeCtx('<!DOCTYPE html><html><body><div id="teachers-list"></div></body></html>');
  loadCommon(ctx);
  ctx.T1 = {
    user_id: 1, username: 'T1', subjects: ['math'], province: 'shanghai', price_min: 150,
    personality_tags: ['patience'], gender: 'male', avatar: '', rating: 5,
  };
  // 第一次：有开放需求 → 挂上 _matchForStudent
  vm.runInContext(`
    state.user = { id: 50, username: 'S', role: 'student' };
    state.allTeachers = [T1];
    dhGet = async (url) => {
      if (url.includes('scope=mine')) return { demands: [
        { id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], student_grade: 'senior1', province: 'shanghai', budget_min: 100, budget_max: 200, preferred_personality_tags: ['patience'], preferred_teacher_gender: 'male', status: 'open' },
      ] };
      return {};
    };
  `, ctx);
  await vm.runInContext('attachStudentMatch([T1])', ctx);
  assert.ok(vm.runInContext('T1._matchForStudent', ctx), '有开放需求时挂匹配');
  // 第二次：开放需求归零（全部签约/关闭）→ 旧徽章必须清除（否则卡上残留过期徽章 + 按过期值排序）
  vm.runInContext(`
    dhGet = async (url) => {
      if (url.includes('scope=mine')) return { demands: [
        { id: 11, display_id: 7, target_type: 'academic', target_subjects: ['math'], status: 'contracted' },
      ] };
      return {};
    };
  `, ctx);
  await vm.runInContext('attachStudentMatch([T1])', ctx);
  assert.equal(vm.runInContext('T1._matchForStudent', ctx), undefined, '开放需求归零后旧匹配清除');
});

test('教师需求大厅：普通需求默认按匹配度降序（item6）', async () => {
  const { ctx, dom } = makeCtx('<!DOCTYPE html><html><body><div id="demands-list"></div></body></html>');
  loadCommon(ctx);
  vm.runInContext(`
    setBadge = () => {};
    initReveals = () => {};
    ensureAuth = () => true;
    showToast = () => {};
    api = async (url) => {
      if (url.includes('demand-pushes')) return { pushes: [] };
      if (url.includes('/api/teachers')) return { teachers: [{ user_id: 38, username: 'kkkk', subjects: ['english'], province: 'guangdong', price_min: 150, personality_tags: [], gender: '' }] };
      return { demands: [
        { id: 1, display_id: 7, user_id: 39, username: '学生A', student_grade: 'senior1', target_type: 'academic', target_subjects: ['english'], province: 'guangdong', budget_min: 100, budget_max: 200, status: 'open', created_at: '2026-08-07 04:27:09' },
        { id: 2, display_id: 8, user_id: 40, username: '学生B', student_grade: 'senior2', target_type: 'academic', target_subjects: ['math'], province: 'beijing', budget_min: 100, budget_max: 200, status: 'open', created_at: '2026-08-07 04:27:10' },
      ] };
    };
    state.user = { id: 38, username: 'kkkk', role: 'teacher' };
    state.page = 'browse-demands';
    state.allTeachers = [];
  `, ctx);
  await vm.runInContext('loadBrowseDemands()', ctx);
  const html = dom.window.document.getElementById('demands-list').innerHTML;
  const iA = html.indexOf('data-id="1"'); // 匹配度按钮 data-id = 需求 id
  const iB = html.indexOf('data-id="2"');
  assert.ok(iA >= 0 && iB >= 0, '两条需求都渲染');
  assert.ok(iA < iB, 'english 命中（100%）排前，math 未中（29%）沉后');
});

test('教师看教师：不参与匹配度（无 _matchForStudent 不排序）', async () => {
  const { ctx } = makeCtx();
  loadCommon(ctx);
  ctx.A = { user_id: 1, username: '甲', avatar: '', rating: 5, grade: 'senior', province: 'shanghai' };
  ctx.B = { user_id: 2, username: '乙', avatar: '', rating: 4, grade: 'junior', province: 'beijing' };
  vm.runInContext('sortTeachersByMatch([A, B])', ctx);
  assert.deepEqual(Array.from(vm.runInContext('[A.user_id, B.user_id]', ctx)), [1, 2], '无学生匹配语境保持原序');
  const html = vm.runInContext('renderTeacherCard(A)', ctx);
  assert.ok(!html.includes('match-btn'), '教师看教师卡无匹配度按钮');
});
