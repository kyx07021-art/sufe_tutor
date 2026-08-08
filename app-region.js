/**
 * 地区赋分组件库（模块1：地区档案 + 赋分组件）
 *
 * 经典脚本（非模块），全部为顶层全局函数（声明提升，可被内联 onclick 直接引用）。
 * 依赖（index.html 中的加载顺序）：
 *   1. region-data.js —— 提供 globalThis.SUFE_REGIONS（地区数据单源）
 *   2. app-ui.js       —— 提供 escHtml（插值转义）；本文件的 collect 结果与
 *                        app-pages.js 现存 gaokao_scores / current_scores 形状兼容
 *   UI 文案：constants.js 的 UI 常量经 app-state.js 顶层 const 解构为全域词法绑定，
 *            本文件与 app-posts / app-chat 同样裸引 UI.*（勿重复 const，会撞声明）
 *   3. app-region.js  —— 本文件
 *   样式：style-region.css 需在 style.css 之后引入（paddle 类依赖层叠覆盖顺序）
 *
 * ============================================================
 * DOM 约定（供主会话接线）
 * ============================================================
 * 教师端（档案页）：
 *   #profile-province        省份下拉容器：innerHTML = renderProvinceSelect(
 *                            'profile-province', 已选省id, 'onchange="onTeacherProvinceChange()"')
 *   #profile-gaokao-scores   高考政策编辑器挂载点（index.html 已有该容器）：
 *                            innerHTML = renderTeacherGaokaoEditor(provinceId, graduationYear, existing)
 *                            graduationYear 即毕业年份（空 = 按最新政策；有值 = 按改革批次回退，
 *                            如浙江 2022 年前毕业用 21 档旧制）；existing 即档案里的 gaokao_scores
 *                            数组，组件内部自行回填。毕业年份输入 #profile-graduation-year 联动。
 *   收集：collectTeacherGaokao() → [{subject, score} | {subject, grade}]
 *         （对旧版编辑器 HTML 同样可收集，data 属性保持同名）
 *   联动：首选科目 pill / 再选科目勾选 / 文理切换均由组件内联 onclick 自处理，
 *         主会话无需额外接线；省份变化走 onTeacherProvinceChange()
 *
 * 学生端（需求弹窗）：
 *   #d-province              省份下拉容器：innerHTML = renderProvinceSelect(
 *                            'd-province', 已选省id, 'onchange="主会话联动函数()"')
 *   #d-grade                 年级下拉（index.html 已有）
 *   #d-subjects              目标科目容器（index.html 已有，其本身就是 .checkbox-grid）：
 *                            innerHTML = buildStudentSubjectsHtml(provinceId, gradeId)
 *                            （返回值是 label 列表，不含外层 grid 容器）
 *                            change 监听由主会话挂到 #d-subjects 上（事件冒泡可捕获）
 *   #d-scores                成绩行容器（index.html 已有）：
 *                            innerHTML = buildStudentScoreRows(provinceId, gradeId, 勾选的科目id数组)
 *                            页签默认激活「等第制」；回填分数制旧数据时，主会话先对
 *                            对应行调 switchScoreMode(该行的 [data-mode="score"] 页签) 再填值
 *   收集：collectStudentScores() →
 *         等第模式 {subject, mode:'grade', scale:0, score:'', grade:'A'}
 *         分数模式 {subject, mode:'score', scale:满分, score:'值'}
 *         （分数模式与现存 current_scores 的 {subject,scale,score} 向后兼容）
 *
 * 地区提示：regionLockNote(provinceId) → 非上海返回 .region-hint 提示段落，
 *           主会话渲染到省份选择器附近即可。
 * ============================================================
 */

// ------------------------------------------------------------
// 内部辅助（非对外约定，主会话请勿依赖）
// ------------------------------------------------------------

// 取值插值辅助：空值转空串，其余过 escHtml
function gkVal(v) {
  return escHtml(v === undefined || v === null ? '' : String(v));
}

// 解析省份高考政策。year 为教师毕业年份（可空：学生端/未填 → 恒最新政策），
// policyOf 内部按改革批次回退到该教师当年实际政策。region-data.js 中把第三至五批省份
// 登记为 {}（空对象 truthy，policyOf 的空壳分支给出 DEFAULT_POLICY）；
// 此处保留兜底纯属防御，policyOf 恒返回带 type 的完整形状。
function regionResolvePolicy(provinceId, year) {
  const R = globalThis.SUFE_REGIONS;
  const pol = R.policyOf(provinceId, year);
  if (pol && pol.type) return pol;
  return {
    ...R.policies['3+1+2'],
    type: '3+1+2',
    gradeSystem: R.gradeSystems.standard5,
    gradeSystemId: 'standard5',
    extraElective: null,
  };
}

// 读取档案表单「毕业年份」输入：严格四位数字，与服务端同口径钳制到 [CONFIG.GRAD_YEAR_MIN, MAX]
// （网安 L3 修复：之前 [1950,2050] 与服务端 [1980,2030] 不一致 → 实时渲染与保存重载可能 schema 跳变；
//  现钳制一致 → 1979 实时渲染 1980 政策 = 保存后重载政策）；非四位（空/小数/异常）→ undefined 按最新
function currentGradYear() {
  const el = document.getElementById('profile-graduation-year');
  if (!el) return undefined;
  const v = String(el.value).trim();
  if (!/^\d{4}$/.test(v)) return undefined;
  const C = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.CONFIG) || {};
  const min = C.GRAD_YEAR_MIN != null ? C.GRAD_YEAR_MIN : 1980;
  const max = C.GRAD_YEAR_MAX != null ? C.GRAD_YEAR_MAX : 2030;
  return Math.min(max, Math.max(min, +v));
}

// 教师端主科段落（三种政策都含语数外原始分，/150）。
// 未勾选任何主科时给出引导提示，勾了哪几科就只加载哪几科
function gkMainSection(mainIds, exOf) {
  const R = globalThis.SUFE_REGIONS;
  const names = R.subjectNames;
  let html = '<div class="gaokao-section">';
  if (!mainIds || !mainIds.length) {
    return html + `<p class="region-hint">${UI.REGION_HINT_FILL_MAIN}</p></div>`;
  }
  mainIds.forEach(sid => {
    const ex = exOf(sid);
    const max = R.subjectMaxScore[sid] || 150;
    html += `<div class="gaokao-row"><span class="subject-name">${escHtml(names[sid] || sid)}</span>
      <input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
        value="${gkVal(ex.score)}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
      <span class="score-max">/ ${max}</span></div>`;
  });
  return html + '</div>';
}

// ------------------------------------------------------------
// 公共组件：省份下拉 + 地区提示
// ------------------------------------------------------------

// 31 省下拉（首项「请选择」）。onchangeAttr 为开发者提供的原生属性串，
// 形如 onchange="onTeacherProvinceChange()"，原样拼入，不做转义。
function renderProvinceSelect(selectId, selectedId, onchangeAttr) {
  const R = globalThis.SUFE_REGIONS;
  const opts = R.provinces.map(p =>
    `<option value="${escHtml(p.id)}"${p.id === selectedId ? ' selected' : ''}>${escHtml(p.name)}</option>`
  ).join('');
  return `<select class="form-select" id="${escHtml(selectId)}"${onchangeAttr ? ' ' + onchangeAttr : ''}>
    <option value="">${UI.OPTION_PLACEHOLDER}</option>${opts}
  </select>`;
}

// 非上海省份的线下教学限制提示
function regionLockNote(provinceId) {
  if (provinceId === 'shanghai') return '';
  return `<p class="region-hint">${UI.REGION_HINT_OFFLINE_ONLY}</p>`;
}

// ------------------------------------------------------------
// 教师端：高考政策编辑器（渲染进 #profile-gaokao-scores）
// ------------------------------------------------------------

// 按省份政策分三支渲染：3+1+2 / 3+3 / 传统文理。
// graduationYear：教师毕业年份（空/undefined = 未填 → 按最新政策渲染；有值 → 按改革批次
//   回退到该教师当年实际政策，如浙江 2020 年毕业 → 21 档旧制、2023 年毕业 → 20 区间新制）。
// existing： gaokao_scores 数组（[{subject, score} | {subject, grade}]），内部自动回填。
function renderTeacherGaokaoEditor(provinceId, graduationYear, existing) {
  const R = globalThis.SUFE_REGIONS;
  const names = R.subjectNames;
  const list = Array.isArray(existing) ? existing : [];
  const exOf = sid => list.find(x => x && x.subject === sid) || {};
  const hasEx = sid => Object.keys(exOf(sid)).length > 0;
  // 填写范围 = 上方 #profile-subjects 勾选的擅长科目（单一入口，不全量填写）
  const checked = new Set([...document.querySelectorAll('#profile-subjects input:checked')].map(cb => cb.value));

  if (!R.isValidProvince(provinceId)) {
    return `<p class="text-sm text-muted">${UI.REGION_HINT_PICK_PROVINCE}</p>`;
  }

  const pol = regionResolvePolicy(provinceId, graduationYear || undefined);
  let html = '';
  // R2-12/H1 存量旧档成绩在当前政策下无匹配（如浙江 L 档 vs 20 区间 I 档）→ 顶部横幅警告，防静默丢失。
  // 保存拦截另在 handleSaveProfile（app-pages）用同款 gaokaoPolicyMismatchCount 复检
  const mismatches = gaokaoPolicyMismatchCount(pol, list);
  if (mismatches > 0) {
    html += alertHtml('warn', UI.GAOKAO_POLICY_MISMATCH_WARN.replace('{n}', mismatches).replace('{year}', graduationYear ? String(graduationYear) : '（未填）'), 'gaokao-mismatch-warn');
  }

  // 主科原始分（三分支共有，仅渲染勾选的擅长主科）
  html += gkMainSection(pol.main.filter(sid => checked.has(sid)), exOf);

  if (pol.type === '3+1+2') {
    // ---- 分支一：3+1+2 ---- 首选（物/历，勾选范围内选一）+ 再选（勾选科目各填等级赋分）
    const firstChecked = pol.first.filter(sid => checked.has(sid));
    const reChecked = pol.reassigned.filter(sid => checked.has(sid));
    const gs = pol.gradeSystem || R.gradeSystems.standard5;
    html += '<div class="gaokao-section">';
    if (!firstChecked.length && !reChecked.length) {
      html += `<p class="region-hint">${UI.REGION_HINT_FILL_ELECTIVE}</p>`;
    } else {
      if (firstChecked.length) {
        const firstSel = firstChecked.find(hasEx) || firstChecked[0];
        const firstEx = exOf(firstSel);
        html += `<div class="gaokao-row"><span class="subject-name">${UI.REGION_FIRST_SUBJECT_LABEL}${firstChecked.length > 1 ? UI.REGION_FIRST_TWO_HINT : ''}</span>
          <div class="gk-pill-group gk-first-pills" data-gk-role="first">
            ${firstChecked.map(sid => `<span class="grade-option gk-pill glass glass--solid ${sid === firstSel ? 'selected' : ''}"
              data-gk-first="${escHtml(sid)}" role="button" tabindex="0" onclick="pickGkPill(this)">${escHtml(names[sid] || sid)}</span>`).join('')}
          </div>
          <input type="number" class="score-inline" data-gk-role="first-score" data-gk-type="score"
            value="${gkVal(firstEx.score)}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
          <span class="score-max">/ 100</span>
        </div>`;
      }
      html += reChecked.map(sid => {
        const ex = exOf(sid);
        return `<div class="gaokao-row" data-gk-check-row="${escHtml(sid)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>
          <div class="grade-selector" data-gk-subject="${escHtml(sid)}">
            ${gs.levels.map(lv => `<span class="grade-option glass glass--solid ${ex.grade === lv.id ? 'selected' : ''}"
              data-grade="${escHtml(lv.id)}" role="button" tabindex="0" onclick="pickGrade(this)">${escHtml(lv.name)}</span>`).join('')}
          </div></div>`;
      }).join('');
    }
    html += '</div>';

  } else if (pol.type === '3+3') {
    // ---- 分支二：3+3 ---- 选考科目 = 勾选的擅长科目（浙江含技术）
    const electives = (pol.extraElective ? [...pol.electives, pol.extraElective] : [...pol.electives])
      .filter(sid => checked.has(sid));
    const gs = pol.gradeSystem;
    const isStandard = !!(gs && gs.type === 'standard');            // 海南：标准分，分数录入
    const usePills = !!(gs && gs.type === 'grade' && gs.levels.length <= 11); // 档位多（21 档）改用下拉

    html += `<div class="gaokao-section">`;
    if (!electives.length) {
      html += `<p class="region-hint">${UI.REGION_HINT_FILL_ELECTIVE}</p>`;
    } else {
      html += electives.map(sid => {
        const ex = exOf(sid);
        let ctl;
        if (isStandard) {
          const max = gs.max || 300;
          ctl = `<input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
            <span class="score-max">/ ${max}</span><span class="region-max-note">${UI.REGION_STANDARD_SCORE_NOTE}</span>`;
        } else if (usePills) {
          ctl = `<div class="grade-selector" data-gk-subject="${escHtml(sid)}">
            ${gs.levels.map(lv => `<span class="grade-option glass glass--solid ${ex.grade === lv.id ? 'selected' : ''}"
              data-grade="${escHtml(lv.id)}" role="button" tabindex="0" onclick="pickGrade(this)">${escHtml(lv.name)}</span>`).join('')}
          </div>`;
        } else if (gs && gs.type === 'grade') {
          ctl = `<select class="form-select gk-grade-select" data-gk-subject="${escHtml(sid)}">
            <option value="">${UI.REGION_GRADE_PLACEHOLDER}</option>
            ${gs.levels.map(lv => `<option value="${escHtml(lv.id)}"${ex.grade === lv.id ? ' selected' : ''}>${escHtml(lv.name)}</option>`).join('')}
          </select>`;
        } else {
          // 兜底：该省未配置赋分制时按原始分录入
          ctl = `<input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
            <span class="score-max">/ 100</span>`;
        }
        return `<div class="gaokao-row" data-gk-check-row="${escHtml(sid)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>${ctl}</div>`;
      }).join('');
    }
    html += '</div>';

  } else {
    // ---- 分支三：传统文理（理/文 track pill + 对应科目原始分） ----
    const tracks = pol.tracks || { science: [], arts: [] };
    const trackLabel = { science: UI.REGION_TRACK_SCIENCE, arts: UI.REGION_TRACK_ARTS };
    // 当前分科：优先按勾选的擅长科目推断 → 已有成绩推断 → 默认第一 track
    let curTrack = Object.keys(tracks).find(tk => (tracks[tk] || []).some(sid => checked.has(sid)))
      || Object.keys(tracks).find(tk => list.some(x => x && (tracks[tk] || []).includes(x.subject)))
      || Object.keys(tracks)[0] || '';

    html += `<div class="gaokao-section">
      <div class="gaokao-row">
        <div class="gk-pill-group gk-track-pills">
          ${Object.keys(tracks).map(tk => `<span class="grade-option gk-pill glass glass--solid ${tk === curTrack ? 'selected' : ''}"
            data-gk-track="${escHtml(tk)}" onclick="pickGkTrack(this)">${escHtml(trackLabel[tk] || tk)}</span>`).join('')}
        </div>
      </div>
      ${Object.keys(tracks).map(tk => (tracks[tk] || []).filter(sid => checked.has(sid)).map(sid => {
        const ex = exOf(sid);
        return `<div class="gaokao-row ${tk === curTrack ? '' : 'hidden'}" data-gk-track-row="${escHtml(tk)}">
          <span class="subject-name">${escHtml(names[sid] || sid)}</span>
          <input type="number" class="score-inline" data-gk-subject="${escHtml(sid)}" data-gk-type="score"
            value="${gkVal(ex.score)}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="100">
          <span class="score-max">/ 100</span></div>`;
      }).join('')).join('')}
    </div>`;
  }

  return html;
}

// 省份下拉变化：读 #profile-province 值，整体重渲编辑器（跨政策不保留旧输入）
// R2-12/M3 教师擅长科目池 = SUBJECTS + 该省政策 extraElective（浙江技术）。省份变更时重建，保留既有勾选；
// 离开浙江移除技术（技术仅浙江 7 选 3 含，服务端不加白名单限制——subjects 列透传，显示经 DISP.subjectName 兜底）。
function teacherSubjectPool(provinceId) {
  const base = [...(globalThis.APP_CONSTANTS.SUBJECTS || [])];
  if (provinceId) {
    const pol = globalThis.SUFE_REGIONS.policyOf(provinceId);
    const extra = pol && pol.extraElective;
    if (extra && !base.some(s => s.id === extra)) {
      const nm = (globalThis.SUFE_REGIONS.subjectNames || {})[extra];
      base.push({ id: extra, name: nm || extra });
    }
  }
  return base;
}
function rebuildTeacherSubjects(provinceId) {
  const el = document.getElementById('profile-subjects');
  if (!el) return;
  const checked = [...el.querySelectorAll('input:checked')].map(cb => cb.value);
  el.innerHTML = checkboxItemsHtml(teacherSubjectPool(provinceId), checked);
}

function onTeacherProvinceChange() {
  const sel = document.getElementById('profile-province');
  const el = document.getElementById('profile-gaokao-scores');
  if (!sel || !el) return;
  rebuildTeacherSubjects(sel.value); // M3：切省份同步科目池（浙江加技术，离开移除）
  el.innerHTML = renderTeacherGaokaoEditor(sel.value, currentGradYear(), []);
  if (typeof initCustomSelects === 'function') initCustomSelects(el); // 等第下拉（档位多省份）换自定义组件
}

// 擅长科目勾选变化：按新勾选集重渲编辑器。先收集当前输入作为 existing 回填，
// 保住已填成绩（取消勾选的科目随行移除，其成绩不再收集——不擅长即不展示）
function onTeacherSubjectsChange() {
  const sel = document.getElementById('profile-province');
  const el = document.getElementById('profile-gaokao-scores');
  if (!el) return;
  const existing = collectTeacherGaokao();
  el.innerHTML = renderTeacherGaokaoEditor(sel ? sel.value : '', currentGradYear(), existing);
  if (typeof initCustomSelects === 'function') initCustomSelects(el); // 重建后的等第下拉换自定义组件
}

// R2-12 毕业年份变更实时重渲：与科目变更同逻辑（currentGradYear 读最新年份，existing 保留已填成绩；
// 浙江教师改年份 → 21 档旧制/20 区间新制即时切换，无需保存重载）。挂 #profile-graduation-year change（app-pages）
function onTeacherGradYearChange() {
  onTeacherSubjectsChange();
}

// 单选 pill 通用切换（首选科目 / 文理分科共用 .gk-pill-group 容器）
function pickGkPill(el) {
  const group = el.closest('.gk-pill-group');
  if (!group) return;
  group.querySelectorAll('.gk-pill').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

// 文理分科切换：显隐对应 track 的科目行
function pickGkTrack(el) {
  pickGkPill(el);
  const root = document.getElementById('profile-gaokao-scores');
  if (!root) return;
  root.querySelectorAll('[data-gk-track-row]').forEach(row => {
    row.classList.toggle('hidden', row.dataset.gkTrackRow !== el.dataset.gkTrack);
  });
}

// 收集教师端编辑器输入 → [{subject, score} | {subject, grade}]
// 与现存 gaokao_scores 形状兼容；隐藏行（未勾选 / 非当前 track）一律跳过。
// data 属性与旧版 updateGaokaoScores 生成的 HTML 同名，旧编辑器亦可收集。

// R2-12/H1 存量成绩与当前政策失配检测：等第制政策下列出的 grade 不在当前 levels 内的条数
// （分数制 score 条目恒匹配；old 政策无 gradeSystem 恒匹配）。编辑器横幅与保存拦截共用，
// 防旧档成绩（如浙江 21 档 L 系列）在 20 区间新制下保存时被静默清空。
function gaokaoPolicyMismatchCount(pol, gaokaoList) {
  if (!pol || !Array.isArray(gaokaoList) || !gaokaoList.length) return 0;
  const gs = pol.gradeSystem;
  if (!gs || gs.type !== 'grade' || !gs.levels || !gs.levels.length) return 0;
  const ids = new Set(gs.levels.map(lv => lv.id));
  return gaokaoList.filter(x => x && x.grade != null && x.grade !== '' && !ids.has(x.grade)).length;
}

function collectTeacherGaokao() {
  const root = document.getElementById('profile-gaokao-scores');
  const out = [];
  if (!root) return out;

  // 1) 分数输入（主科 / 传统文理科目 / 海南标准分）
  root.querySelectorAll('input[data-gk-type="score"][data-gk-subject]').forEach(inp => {
    if (inp.closest('.hidden') || inp.value === '') return;
    out.push({ subject: inp.dataset.gkSubject, score: +inp.value });
  });

  // 2) 3+1+2 首选科目：科目 id 取选中 pill，分数取同行输入框
  const firstPill = root.querySelector('[data-gk-role="first"] .gk-pill.selected');
  const firstInput = root.querySelector('input[data-gk-role="first-score"]');
  if (firstPill && firstInput && firstInput.value !== '') {
    out.push({ subject: firstPill.dataset.gkFirst, score: +firstInput.value });
  }

  // 3) 等第 pill（五等级 / 上海 / 山东等档位 <=11 的省份）
  root.querySelectorAll('.grade-selector[data-gk-subject]').forEach(sel => {
    if (sel.closest('.hidden')) return;
    const s = sel.querySelector('.grade-option.selected');
    if (s) out.push({ subject: sel.dataset.gkSubject, grade: s.dataset.grade });
  });

  // 4) 等第下拉（浙江 / 京津 21 档）
  root.querySelectorAll('select.gk-grade-select[data-gk-subject]').forEach(sel => {
    if (sel.closest('.hidden') || !sel.value) return;
    out.push({ subject: sel.dataset.gkSubject, grade: sel.value });
  });

  return out;
}

// ------------------------------------------------------------
// 学生端：需求弹窗科目与成绩组件
// ------------------------------------------------------------

// 目标科目勾选列表（返回值是 label 列表，直接作 #d-subjects 的 innerHTML；
// #d-subjects 本身就是 .checkbox-grid 容器）。gradeId 未选时给出引导文案。
function buildStudentSubjectsHtml(provinceId, gradeId) {
  const R = globalThis.SUFE_REGIONS;
  if (!gradeId) return `<p class="text-sm text-muted">${UI.REGION_HINT_PICK_GRADE}</p>`;
  const ids = R.subjectsFor(provinceId, gradeId);
  if (!ids || !ids.length) return `<p class="text-sm text-muted">${UI.REGION_HINT_NO_SUBJECTS}</p>`;
  return checkboxItemsHtml(ids.map(sid => ({ id: sid, name: R.subjectNames[sid] || sid })));
}

// 各科成绩行：科目名 +（gradeLevelsFor 非空时）「等第制 | 分数制」页签 + 对应面板。
// 满分：语数外 150，其余 100；上海高中选考按等第制满分 70 上限提示。
// 返回值直接作 #d-scores 的 innerHTML。
function buildStudentScoreRows(provinceId, gradeId, subjectIds) {
  const R = globalThis.SUFE_REGIONS;
  const ids = (Array.isArray(subjectIds) ? subjectIds : []).filter(Boolean);
  if (!ids.length) return `<p class="text-sm text-muted">${UI.REGION_HINT_PICK_SUBJECTS}</p>`;

  const levels = R.gradeLevelsFor(provinceId, gradeId); // null = 该省该学段无等第制
  const stage = R.stageOfGrade(gradeId);
  const pol = regionResolvePolicy(provinceId);
  // 上海高中选考满分 70（取自该省 gradeSystem.max）
  const shMax = (provinceId === 'shanghai' && stage === 'senior' && pol.gradeSystem && pol.gradeSystem.max) || null;

  return ids.map(sid => {
    const sidE = escHtml(sid);
    const name = R.subjectNames[sid] || sid;
    const base = R.subjectMaxScore[sid] || 100;
    const max = (base !== 150 && shMax) ? shMax : base;

    const inputPane = `<input type="number" class="score-inline" data-sg-subject="${sidE}"
        data-score-max="${max}" placeholder="${UI.REGION_SCORE_PLACEHOLDER}" min="0" max="${max}">
      <span class="score-max">/ ${max}</span>${shMax && base !== 150 ? `<span class="region-max-note">${UI.REGION_SH_ELECTIVE_MAX_NOTE}</span>` : ''}`;

    // 主科（语数外）：统一原始分 /150，不提供等第制页签（三种高考政策主科都是原始分）
    if (R.policies['3+1+2'].main.includes(sid)) {
      return `<div class="score-row region-score-row" data-score-subject="${sidE}">
        <span class="score-subject">${escHtml(name)}</span>${inputPane}
      </div>`;
    }

    // 无等第制（小学/初中以外：如海南标准分制省份的高中）→ 仅分数输入
    if (!levels || !levels.length) {
      return `<div class="score-row region-score-row" data-score-subject="${sidE}">
        <span class="score-subject">${escHtml(name)}</span>${inputPane}
      </div>`;
    }

    // 有等第制 → 左右页签 + 两面板（默认激活等第制）
    return `<div class="score-row region-score-row" data-score-subject="${sidE}">
      <span class="score-subject">${escHtml(name)}</span>
      <div class="seg-tabs seg-tabs--score glass glass--solid">
        <button type="button" class="seg-tab active glass" data-mode="grade" onclick="switchScoreMode(this)">${UI.REGION_TAB_GRADE}</button>
        <button type="button" class="seg-tab glass" data-mode="score" onclick="switchScoreMode(this)">${UI.REGION_TAB_SCORE}</button>
      </div>
      <div class="score-mode-pane" data-mode="grade">
        <div class="grade-selector" data-sg-subject="${sidE}">
          ${levels.map(lv => `<span class="grade-option glass glass--solid" data-grade="${escHtml(lv.id)}" role="button" tabindex="0" onclick="pickGrade(this)">${escHtml(lv.name)}</span>`).join('')}
        </div>
      </div>
      <div class="score-mode-pane hidden" data-mode="score">${inputPane}
      </div>
    </div>`;
  }).join('');
}

// 行内切换「等第制 | 分数制」两面板显隐
function switchScoreMode(btn) {
  const row = btn.closest('.score-row');
  if (!row) return;
  row.querySelectorAll('.seg-tab').forEach(t => t.classList.toggle('active', t === btn));
  row.querySelectorAll('.score-mode-pane').forEach(p => p.classList.toggle('hidden', p.dataset.mode !== btn.dataset.mode));
}

// 收集学生端成绩输入：
//   等第模式 {subject, mode:'grade', scale:0, score:'', grade:等第id}
//   分数模式 {subject, mode:'score', scale:满分, score:输入值}
// 分数模式与现存 current_scores 的 {subject,scale,score} 向后兼容。
function collectStudentScores() {
  const root = document.getElementById('d-scores');
  const out = [];
  if (!root) return out;
  root.querySelectorAll('.region-score-row').forEach(row => {
    const sid = row.dataset.scoreSubject;
    const activeTab = row.querySelector('.seg-tab.active');
    const mode = activeTab ? activeTab.dataset.mode : 'score';
    if (mode === 'grade') {
      const sel = row.querySelector('.grade-option.selected');
      out.push({ subject: sid, mode: 'grade', scale: 0, score: '', grade: sel ? sel.dataset.grade : '' });
    } else {
      const inp = row.querySelector('input[data-sg-subject]');
      out.push({ subject: sid, mode: 'score', scale: inp ? +inp.dataset.scoreMax : 100, score: inp ? inp.value : '' });
    }
  });
  return out;
}
