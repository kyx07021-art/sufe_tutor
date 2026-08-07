/**
 * 需求领域模块 —— 学生需求 CRUD + 意向 + 主动推送 + 匹配度
 *
 * 职责：
 *   1. 需求弹窗表单：创建/编辑（renderDemandModal + initDemandForm + 成绩回填 + 提交 handleSubmitDemand）
 *   2. 匹配度 + 需求卡：matchDegree/matchDetailHtml/showMatchDetail/closeMatchDetail/renderDemandCard
 *      （学生「我的需求」与教师「需求大厅」共用渲染，教师视角带匹配度徽章与意向按钮）
 *   3. 需求列表/推送：loadDemandList/loadMyDemands/reopenDemand/loadBrowseDemands、
 *      openSendDemandModal + pushCooldown 限流倒计时 + submitDemandPush/resolvePush
 *   4. 意向：submitIntent/showProfileIncompleteModal/toggleDemandIntents/refreshIntentsBox/
 *      renderIntentTeacherRow/resolveIntent
 *   5. 删除需求：confirmDeleteDemand/handleDeleteDemand
 *
 * 加载序要求：本文件必须在 app-state / app-api / app-anim / app-ui 之后加载（直接引用其顶层全局词法绑定）。
 *
 * 依赖的共享全局：
 *   state / UI / SUBJECTS / STUDENT_GRADES / GENDERS / TEACHING_METHODS / DISP（app-state）
 *   api()（app-api）；showToast()/initReveals()（app-anim）
 *   escHtml()/fmtDateTime()/loaderHtml()/renderAvatarHtml()/openModal()/closeModal()/confirmDanger()/
 *   openConfirmModal()/initCustomSelects()/syncCustomSelectText()/CARET_SVG/pickGrade（app-ui）
 *   renderProvinceSelect()/regionLockNote()/buildStudentSubjectsHtml()/buildStudentScoreRows()/
 *   collectStudentScores()/switchScoreMode（app-region）
 *   invalidate()/registerLogoutReset()（app-state）；openProfilePanel（app-teachers，运行时全局）
 *   ensureAuth()/selectPage()/loadInto()/setBadge()（app-shell/app-auth，运行时全局）
 *
 * 本文件函数全部为顶层全局（内联 onclick 可直接引用）。
 */
// 乱序守卫计数（loadBrowseDemands 用）：快速进出页签时，后发的请求先回会被过期响应覆盖，
// 每次调用自增，渲染前比对本地序号决定是否丢弃过期响应

// ============================================================
// 需求弹窗（创建 / 编辑）：表单模板 + 初始化 + 回填 + 提交
// ============================================================
function openDemandModal(demandId) {
  state.editingDemandId = demandId || null;
  const demand = demandId ? state.myDemands.find(d => d.id === demandId) : null;
  openModal({ title: demand ? UI.MODAL_TITLE_DEMAND_EDIT : UI.MODAL_TITLE_DEMAND_CREATE, body: renderDemandModal(demand) });
  initDemandForm(demand ? demand.province : null);
  if (demand) prefillDemandForm(demand);
}

function renderDemandModal(demand) {
  return `<div id="demand-alert"></div>
        <form onsubmit="handleSubmitDemand(event)" id="demand-form">
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PROVINCE} <span class="req">*</span></label>
            <span id="d-province-wrap"></span>
            <div id="d-region-note"></div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GRADE} <span class="req">*</span></label>
            <select class="form-select" id="d-grade" required onchange="updateDemandSubjects()">
              <option value="">${UI.OPTION_PLACEHOLDER}</option>${STUDENT_GRADES.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GENDER} <span class="req">*</span></label>
            <select class="form-select" id="d-gender" required>
              <option value="">${UI.OPTION_PLACEHOLDER}</option>${GENDERS.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_TARGET_SUBJECTS} <span class="req">*</span>${UI.LABEL_MULTI_SUFFIX}</label>
            <div class="checkbox-grid" id="d-subjects">${SUBJECTS.map(s=>`
              <label class="checkbox-item glass glass--solid"><input type="checkbox" value="${s.id}">${s.name}</label>
            `).join('')}</div>
          </div>
          <div class="form-group" id="d-scores-wrap">
            <label class="form-label">${UI.LABEL_CURRENT_SCORES}</label>
            <div id="d-scores"><p class="text-sm text-muted">${UI.HINT_SELECT_TARGET_SUBJECTS}</p></div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_TEACHING_METHOD} <span class="req">*</span></label>
            <select class="form-select" id="d-method" required onchange="toggleAddressField()">
              ${TEACHING_METHODS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>
          <div id="d-address-section">
            <div class="form-group">
              <label class="form-label">${UI.LABEL_ADDRESS} <span class="req">*</span></label>
              <input type="text" class="form-input" id="d-address" placeholder="${UI.ADDRESS_PLACEHOLDER}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_BUDGET}</label>
            <div style="display:flex;gap:var(--s3);align-items:center;">
              <input type="number" class="form-input" id="d-budget-min" placeholder="${UI.PLACEHOLDER_MIN}" min="0" step="1" style="flex:1;">
              <span class="text-muted">~</span>
              <input type="number" class="form-input" id="d-budget-max" placeholder="${UI.PLACEHOLDER_MAX}" min="0" step="1" style="flex:1;">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_EXPECTED_TIME}</label>
            <input type="text" class="form-input" id="d-expected-time" placeholder="${UI.EXPECTED_TIME_PLACEHOLDER}">
          </div>
          <div class="form-divider"></div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_SUBMITTER} <span class="req">*</span></label>
            <select class="form-select" id="d-submitter" required>
              <option value="parent">${UI.SUBMITTER_PARENT}</option><option value="student">${UI.SUBMITTER_STUDENT}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PARENT_CONTACT} <span class="req">*</span><span class="form-label-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span></label>
            <input type="text" class="form-input" id="d-parent-contact" placeholder="${UI.CONTACT_PLACEHOLDER}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_CONTACT} <span class="req">*</span><span class="form-label-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span></label>
            <input type="text" class="form-input" id="d-student-contact" placeholder="${UI.CONTACT_PLACEHOLDER}" required>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_ADDITIONAL_INFO}</label>
            <textarea class="form-input" id="d-info" rows="3" placeholder="${UI.DEMAND_INFO_PLACEHOLDER}"></textarea>
          </div>
          <div class="modal-footer">
            ${demand ? `<button type="button" class="btn btn-sm modal-footer-start glass glass--pressable" onclick="confirmDeleteDemand(${demand.id})">${UI.BTN_DELETE_DEMAND}</button>` : ''}
            <button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
            <button type="submit" class="btn glass glass--pressable" id="d-submit">${demand ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND}</button>
          </div>
        </form>`;
}

function initDemandForm(selectedProvince) {
  document.getElementById('d-province-wrap').innerHTML =
    renderProvinceSelect('d-province', selectedProvince || '', 'onchange="onDemandProvinceChange()"');
  onDemandProvinceChange(); // 初始即执行：未选省份也给提示、锁线上、科目池给出引导文案
  document.getElementById('d-subjects').addEventListener('change', updateDemandScores);
  toggleAddressField(); // 初始化地址字段可见性
  initCustomSelects(document.getElementById('demand-form')); // 省份/年级/性别/方式/身份下拉统一换自定义组件
}

// 编辑需求时回填表单（复用提交需求组件）。
// 时序关键：勾科目 → 手动 updateDemandScores()（程序改 checkbox 不派发 change）
// → 回填各科分制/分数 → 设教学方式 → 再调 toggleAddressField()
// （initDemandForm 那次跑在默认值上，会把线下需求的地址区错误隐藏）
function prefillDemandForm(d) {
  document.getElementById('d-province').value = d.province || '';
  onDemandProvinceChange(); // 锁线上约束 + 建科目池（科目池还需年级，下行补）
  document.getElementById('d-grade').value  = d.student_grade || '';
  updateDemandSubjects();
  document.getElementById('d-gender').value = d.student_gender || '';
  (d.target_subjects || []).forEach(sid => {
    const cb = document.querySelector(`#d-subjects input[value="${sid}"]`);
    if (cb) cb.checked = true;
  });
  updateDemandScores();
  prefillStudentScores(d.current_scores || []);
  document.getElementById('d-method').value = d.teaching_method || 'offline';
  toggleAddressField();
  document.getElementById('d-address').value        = d.address || '';
  document.getElementById('d-expected-time').value  = d.expected_time || '';
  document.getElementById('d-budget-min').value = d.budget_min || '';
  document.getElementById('d-budget-max').value = d.budget_max || '';
  document.getElementById('d-submitter').value      = d.submitter_type || 'parent';
  document.getElementById('d-parent-contact').value = d.parent_contact || '';
  document.getElementById('d-student-contact').value = d.student_contact || '';
  document.getElementById('d-info').value           = d.additional_info || '';
}

// 平时成绩回填：等第数据→点等级 pill（页签默认等第制）；分数数据→先切分数制页签再填值
function prefillStudentScores(scores) {
  (scores || []).forEach(cs => {
    const row = document.querySelector(`#d-scores .region-score-row[data-score-subject="${cs.subject}"]`);
    if (!row) return;
    if (cs.grade) {
      const pill = row.querySelector(`.grade-option[data-grade="${cs.grade}"]`);
      if (pill) pickGrade(pill);
    } else if (cs.score !== '' && cs.score != null) {
      const tab = row.querySelector('.score-mode-tab[data-mode="score"]');
      if (tab) switchScoreMode(tab);
      const inp = row.querySelector('input[data-sg-subject]');
      if (inp) inp.value = cs.score;
    }
  });
  // 程序回填不派发 change：手动同步自定义下拉的触发器文字
  document.querySelectorAll('#demand-form select').forEach(syncCustomSelectText);
}

function toggleAddressField() {
  const method = document.getElementById('d-method').value;
  const section = document.getElementById('d-address-section');
  const addrInput = document.getElementById('d-address');
  if (method === 'online') {
    section.style.display = 'none';
    addrInput.required = false;
  } else {
    section.style.display = '';
    addrInput.required = true;
  }
}

// 省份变化（模块1）：未选 / 非上海一律提示 + 锁线上；仅明确选中上海才放开线下
function onDemandProvinceChange() {
  const prov = document.getElementById('d-province').value;
  document.getElementById('d-region-note').innerHTML = regionLockNote(prov); // regionLockNote 对空值同样给提示
  const methodSel = document.getElementById('d-method');
  const onlineOnly = prov !== 'shanghai';
  [...methodSel.options].forEach(o => { o.disabled = onlineOnly && o.value !== 'online'; });
  if (onlineOnly) { methodSel.value = 'online'; toggleAddressField(); }
  updateDemandSubjects();
}

// 科目池 = SUFE_REGIONS.subjectsFor(省份, 年级)：地区 + 年级共同决定（需求 1.3）
function updateDemandSubjects() {
  const prov = document.getElementById('d-province').value;
  const grade = document.getElementById('d-grade').value;
  const el = document.getElementById('d-subjects');
  if (!prov || !grade) {
    el.innerHTML = `<p class="text-sm text-muted">${UI.HINT_SELECT_PROVINCE_GRADE}</p>`;
    document.getElementById('d-scores').innerHTML = '';
    return;
  }
  el.innerHTML = buildStudentSubjectsHtml(prov, grade);
  updateDemandScores();
}

// 平时成绩行：app-region.js 按省份等第制渲染「等第制/分数制」双页签。
// 增量更新：勾选/取消科目只增删对应行，保留其余科目已填的分数与等第选择
function updateDemandScores() {
  const prov = document.getElementById('d-province').value;
  const grade = document.getElementById('d-grade').value;
  const checked = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  const el = document.getElementById('d-scores');
  if (!prov || !grade) { el.innerHTML = ''; return; }
  if (!checked.length) { el.innerHTML = `<p class="text-sm text-muted">${UI.HINT_SELECT_TARGET_SUBJECTS}</p>`; return; }

  // 1) 移除取消勾选的科目行
  el.querySelectorAll('.region-score-row').forEach(row => {
    if (!checked.includes(row.dataset.scoreSubject)) row.remove();
  });
  // 2) 仅为新勾选的科目渲染行（已存在的行连同用户输入原样保留）
  const present = new Set([...el.querySelectorAll('.region-score-row')].map(r => r.dataset.scoreSubject));
  const fresh = checked.filter(sid => !present.has(sid));
  if (fresh.length) {
    const html = buildStudentScoreRows(prov, grade, fresh);
    const ph = el.querySelector(':scope > p'); // 「请先选择目标科目」占位
    if (ph) ph.replaceWith(document.createRange().createContextualFragment(html));
    else el.insertAdjacentHTML('beforeend', html);
  }
  // 3) 行序与科目勾选列表对齐（append 既有行不丢输入）
  checked.forEach(sid => {
    const row = el.querySelector(`.region-score-row[data-score-subject="${sid}"]`);
    if (row) el.appendChild(row);
  });
}

async function handleSubmitDemand(e) {
  e.preventDefault();
  const alertEl = document.getElementById('demand-alert');
  const province = document.getElementById('d-province').value;
  if (!province) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_PROVINCE}</div>`; return; }
  const subjects = [...document.querySelectorAll('#d-subjects input:checked')].map(cb => cb.value);
  if (!subjects.length) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_SUBJECT}</div>`; return; }

  const scores = collectStudentScores();

  const isEdit = !!state.editingDemandId;
  const payload = { demand: {
    province,
    student_grade: document.getElementById('d-grade').value,
    student_gender: document.getElementById('d-gender').value,
    target_subjects: subjects, current_scores: scores,
    teaching_method: document.getElementById('d-method').value,
    address: document.getElementById('d-address').value.trim(),
    expected_time: document.getElementById('d-expected-time').value.trim(),
    budget_min: +document.getElementById('d-budget-min').value,
    budget_max: +document.getElementById('d-budget-max').value,
    submitter_type: document.getElementById('d-submitter').value,
    parent_contact: document.getElementById('d-parent-contact').value.trim(),
    student_contact: document.getElementById('d-student-contact').value.trim(),
    additional_info: document.getElementById('d-info').value.trim(),
  }};

  try {
    const btn = document.getElementById('d-submit');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"><i></i><i></i><i></i></span>';
    if (isEdit) {
      await api(`/api/student/demands/${state.editingDemandId}`, { method: 'PUT', body: payload });
    } else {
      await api('/api/student/demands', { method: 'POST', body: payload });
    }
    closeModal();
    state.editingDemandId = null;
    showToast(isEdit ? UI.SUCCESS_DEMAND_UPDATED : UI.SUCCESS_DEMAND_SUBMITTED);
    invalidate('demands'); // 提交/编辑后清需求缓存，防非本页提交致 state.myDemands 陈旧（编辑回填读它）
    if (state.page === 'my-demands') loadMyDemands();
  } catch (err) {
    showToast(err.message); // v0.19.43 长表单滚到底部提交：错误条在浮窗顶部不可见，改 Toast
  } finally {
    const btn = document.getElementById('d-submit');
    if (btn) { btn.disabled = false; btn.textContent = isEdit ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND; }
  }
}

// ============================================================
// 删除需求（学生撤销 / 管理员下架）
// ============================================================
function confirmDeleteDemand(demandId, asAdmin) {
  confirmDanger(UI.BTN_DELETE_DEMAND, UI.CONFIRM_DELETE_DEMAND, `handleDeleteDemand(${demandId}, ${asAdmin ? 1 : 0})`);
}

async function handleDeleteDemand(demandId, asAdmin) {
  try {
    if (asAdmin) {
      await api(`/api/admin/demands/${demandId}`, { method: 'DELETE' });
    } else {
      await api(`/api/student/demands/${demandId}`, { method: 'DELETE', body: {} });
    }
    closeModal();
    showToast(UI.SUCCESS_DEMAND_DELETED);
    state.myDemands = state.myDemands.filter(d => d.id !== demandId);
    invalidate('demands'); // v0.23.1 审计 M2：否则 loadMyDemands/loadBrowseDemands 命中缓存，已删需求闪回
    if (asAdmin) { if (state.page === 'admin-demands') loadAdminDemands(); }
    else if (state.page === 'my-demands') loadMyDemands();
  } catch (err) {
    showToast(err.message);
  }
}

// ============================================================
// 需求卡与列表（学生「我的需求」与教师「需求大厅」共用渲染）
// ============================================================

// 用户名展示：注销用户（用户名以「已注销用户」开头）灰斜体墓碑样式——
// 双方数据（需求/会话/合同/评价）保留，但向其他用户明确表明该账户已注销
// 教师需求匹配度（运营建议 P3/B2 双向画像）：科目(权重60) + 区县(20) + 预算(20) 综合分，
// 按可用维度归一化到 0-100——教师浏览需求时显示「匹配度 N%」，帮助快速判断对错口。纯前端计算零后端改动。
function matchDegree(teacher, demand) {
  if (!teacher) return null;
  let score = 0, total = 0;
  const tSubj = Array.isArray(teacher.subjects) ? teacher.subjects : [];
  const W = CONFIG.MATCH_WEIGHT; // 权重单源 constants CONFIG（科目 60 + 区县 20 + 预算 20）
  const dSubj = Array.isArray(demand.target_subjects) ? demand.target_subjects : [];
  if (tSubj.length && dSubj.length) {
    total += W.subject;
    score += (dSubj.filter(s => tSubj.includes(s)).length / dSubj.length) * W.subject;
  }
  if (teacher.province && demand.province) {
    total += W.region;
    if (teacher.province === demand.province) score += W.region;
  }
  const price = teacher.price;
  if (price != null && (demand.budget_min || demand.budget_max)) {
    total += W.budget;
    const inRange = (!demand.budget_min || price >= demand.budget_min) && (!demand.budget_max || price <= demand.budget_max);
    if (inRange) score += W.budget;
  }
  if (!total) return null;
  return Math.min(100, Math.round(score / total * 100));
}

// 匹配度明细悬浮卡（v0.19.45）：分项对齐 matchDegree 口径——科目 60（命中比例）/ 区域 20（同省）/ 预算 20（报价在区间内），
// 缺数据维度不计分并明示。毛度同浮窗纸面（glass.css .match-detail 参数，modal 同级）
function matchDetailHtml(t, d, md) {
  const tSubj = Array.isArray(t.subjects) ? t.subjects : [];
  const dSubj = Array.isArray(d.target_subjects) ? d.target_subjects : [];
  const hit = dSubj.filter(s => tSubj.includes(s)).length;
  const subjOn = tSubj.length > 0 && dSubj.length > 0;
  const subjScore = subjOn ? Math.round(hit / dSubj.length * 60) : null;
  const regionOn = !!(t.province && d.province);
  const regionScore = regionOn ? (t.province === d.province ? 20 : 0) : null;
  const budgetOn = t.price != null && (d.budget_min || d.budget_max);
  const budgetScore = budgetOn
    ? ((!d.budget_min || t.price >= d.budget_min) && (!d.budget_max || t.price <= d.budget_max) ? 20 : 0) : null;
  const bar = (s, max) => `<div class="match-bar${s === 0 ? ' match-bar--zero' : ''}"><i style="width:${s == null ? 0 : Math.round(s / max * 100)}%"></i></div>`;
  const row = (k, s, max, hint) => `<div class="match-row">
    <span class="match-row-top"><span class="match-row-k">${k}</span><span class="match-row-s${s == null ? ' match-row-s--skip' : ''}">${s == null ? UI.MATCH_DIM_SKIP : s + '/' + max}</span></span>
    ${bar(s, max)}
    <span class="match-row-hint">${hint}</span>
  </div>`;
  const subjHint = subjOn ? UI.MATCH_SUBJECT_HIT.replace('{hit}', hit).replace('{total}', dSubj.length) : UI.MATCH_DIM_SKIP;
  const regionHint = !regionOn ? UI.MATCH_DIM_SKIP : (regionScore === 20 ? UI.MATCH_REGION_HIT.replace('{name}', escHtml(DISP.provinceName(d.province))) : UI.MATCH_REGION_MISS);
  const budgetHint = !budgetOn ? UI.MATCH_DIM_SKIP : (budgetScore === 20 ? UI.MATCH_BUDGET_HIT : UI.MATCH_BUDGET_MISS);
  return `<div class="match-detail glass glass--float" role="dialog" aria-label="${UI.MATCH_DETAIL_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${md}%</span><span class="match-detail-title">${UI.MATCH_DETAIL_TITLE}</span></div>
    <p class="match-detail-sub">${UI.MATCH_DETAIL_SUB}</p>
    ${row(UI.MATCH_ITEM_SUBJECT, subjScore, 60, subjHint)}
    ${row(UI.MATCH_ITEM_REGION, regionScore, 20, regionHint)}
    ${row(UI.MATCH_ITEM_BUDGET, budgetScore, 20, budgetHint)}
    <p class="match-note">${UI.MATCH_NOTE}</p>
  </div>`;
}

// 点击开关 + 外部点击 / Esc / 滚动关闭（同一时刻至多一张）。
// v0.19.46 数据从缓存重建（按按钮 data-id 找需求 + state.allTeachers 找本人档案）——
// 原 window._matchDetail 单槽被最后一张卡渲染覆盖：多 tag 时点谁都显示最后一张的数据
let _matchDetailOpen = false;
let _browseDemands = []; // 教师需求大厅当前列表（含置顶推送卡），showMatchDetail 的按 id 取数源
// v0.23.1 审计 M1/m5：探测刷新替换缓存数组后重挂镜像（state.myDemands 编辑回填源、
// _browseDemands 匹配度明细取数源）——不重挂则就地变更/取数作用在游离旧数组上
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('demands', () => {
    const mine = dhPeek('/api/student/demands?scope=mine');
    if (mine && mine.demands) state.myDemands = mine.demands;
    const plaza = dhPeek(state.user && state.user.role === 'teacher'
      ? '/api/student/demands?scope=for-teacher' : '/api/student/demands');
    const pushes = dhPeek('/api/demand-pushes');
    if (plaza && plaza.demands) {
      _browseDemands = [...(pushes && pushes.pushes ? pushes.pushes : []), ...plaza.demands];
    }
  });
}
function showMatchDetail(btn) {
  const d = _browseDemands.find(x => x.id === +btn.dataset.id);
  const t = state.allTeachers.find(x => x.user_id === state.user.id);
  if (!d || !t) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  const md = matchDegree(t, d);
  if (md == null) return;
  btn.insertAdjacentHTML('afterend', matchDetailHtml(t, d, md));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  // v0.19.47 挂 body（custom-select 面板完整模式）：.list-card 常驻 backdrop-filter（--g-f-card 微毛），
  // Chrome 中它是 fixed 后代的 containing block——不挂 body 则 fixed 实际仍相对卡：定位偏移/被 overflow:hidden 切/图层困卡内，
  // 上版只改 CSS 没改挂载点，正是「还是老样子」的根因
  document.body.appendChild(card);
  const r = btn.getBoundingClientRect();
  card.style.left = `${r.left}px`;
  card.style.top = `${r.bottom + 6}px`;
  _matchDetailOpen = true;
}
function closeMatchDetail() {
  const card = document.querySelector('.match-detail');
  if (card) card.remove();
  _matchDetailOpen = false;
}
document.addEventListener('click', e => {
  if (!_matchDetailOpen) return;
  if (!e.target.closest('.match-detail') && !e.target.closest('.tag-match')) closeMatchDetail();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMatchDetail(); });
// 滚动即收起（fixed 不跟随滚动，同 custom-select 面板模式；capture 捕获所有滚动容器）
document.addEventListener('scroll', () => { if (_matchDetailOpen) closeMatchDetail(); },
  { capture: true, passive: true });

function renderDemandCard(d, opts = {}) {
  const { editable = false, admin = false, teacher = false, myTeacher = null } = opts;
  const push = opts.push; // 学生主动推送的待处理需求（教师视角置顶卡）
  // 需求编号（#0004 四位）：v0.20.0 从小气泡挪出，直接跟在时间标记右侧（与时间同排的普通文本）
  const idTag = d.display_id ? `<span class="demand-id-tag">#${String(d.display_id).padStart(4, '0')}</span>` : '';
  // 匹配度徽章（教师视角 + 教师档案齐全时展示）：v0.19.45 变按钮，点击呼出明细悬浮卡
  const matchTag = (teacher && myTeacher)
    ? (() => { const md = matchDegree(myTeacher, d); if (md == null) return ''; return `<button type="button" class="tag tag-match glass glass--solid" data-id="${d.id}" onclick="showMatchDetail(this)" title="${UI.TAG_MATCH_TITLE}">${UI.TAG_MATCH}${md}%</button>`; })()
    : '';
  const provinceName = DISP.provinceName(d.province);
  const subjNames = (d.target_subjects||[]).map(id => DISP.subjectName(id));
  const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade;
  const gender = DISP.genderName(d.student_gender);
  const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
  const method = DISP.methodName(d.teaching_method) || DISP.methodName('offline');
  // 教师视角：意向按钮四态（未提交 / 待处理 / 已建立联系 / 未获选），状态取自列表接口的 my_intent_status
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === 'accepted' ? `<button type="button" class="btn btn-sm btn-intent-ok glass glass--pressable" disabled>${UI.INTENT_ACCEPTED}</button>`
    : d.my_intent_status === 'pending'  ? `<button type="button" class="btn btn-sm btn-intent-wait glass glass--pressable" disabled>${UI.INTENT_PENDING}</button>`
    : d.my_intent_status === 'rejected' ? `<button type="button" class="btn btn-sm btn-intent-wait glass glass--pressable" disabled>${UI.INTENT_REJECTED}</button>`
    : `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="submitIntent(${d.id})">${UI.BTN_SUBMIT_INTENT}</button>`;
  const budget = (d.budget_min || d.budget_max)
    ? `${d.budget_min||UI.BUDGET_NO_LIMIT}~${d.budget_max||UI.BUDGET_NO_LIMIT}${UI.BUDGET_UNIT_SUFFIX}` : UI.BUDGET_NEGOTIABLE;

  // 三行点号纯文字（同教师卡语言，行间细线分隔）：
  // ① 基本信息：地区·年级·性别·提交者 ② 教学需求：线上/下·报价 ③ 需求科目和成绩：科目: 分数/分制（等第制直接显等第）
  const infoBase = [provinceName, grade, gender, `${UI.SUBMITTER_PREFIX}${submitter}`].filter(Boolean).map(escHtml).join(' · ');
  const timeStr = d.expected_time ? `${UI.LABEL_EXPECTED_TIME}：${d.expected_time}` : '';
  const infoDemandRow = [method, budget, timeStr].filter(Boolean).map(escHtml).join(' · ');
  const scoreItems = (d.current_scores||[]).map(cs => DISP.demandScoreCell(cs)).filter(Boolean);
  const infoScores = (scoreItems.length ? scoreItems : subjNames).map(escHtml).join(' · ');

  return `<div class="list-card list-card--demand glass">
    ${renderAvatarHtml(d.avatar, d.username || '?', 'demand-avatar', d.user_id)}
    <div class="demand-card-main">
    <div class="list-card-header">
      <span class="list-card-title">${DISP.usernameHtml(d.username || '')}${matchTag}${d.status === 'contracted' ? ` <span class="tag tag-ok glass glass--solid">${UI.DEMAND_TAG_CONTRACTED}</span>` : d.status === 'revoked' ? ` <span class="tag tag-warn glass glass--solid">${UI.DEMAND_TAG_REVOKED}</span>` : ''}</span>
      <span class="demand-card-tools">
        ${push ? `<span class="push-note-row">
          <span class="push-pin-tag">${UI.PUSH_TAG_ACTIVE}</span>
          <span class="list-card-meta">${fmtDateTime(push.push_created_at)}</span>${idTag}
          <span class="push-note-text">${UI.PUSH_NOTE_TEXT}</span>
          <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolvePush(${push.push_id},'reject')">${UI.BTN_PUSH_REJECT}</button>
          <button type="button" class="btn btn-xs glass glass--pressable" onclick="resolvePush(${push.push_id},'accept')">${UI.BTN_PUSH_ACCEPT}</button>
        </span>` : `<span class="list-card-meta">${fmtDateTime(d.created_at)}</span>${idTag}${teacherIntentBtn}`}
        ${editable && d.status === 'revoked' ? `<button type="button" class="btn btn-sm glass glass--pressable" onclick="reopenDemand(${d.id})">${UI.BTN_REOPEN_DEMAND}</button>`
          : editable && d.status !== 'contracted' ? `<button type="button" class="btn btn-outline btn-sm glass glass--pressable" onclick="openDemandModal(${d.id})">${UI.BTN_EDIT}</button>` : ''}
        ${admin && d.status !== 'contracted' ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmDeleteDemand(${d.id}, true)">${UI.BTN_REMOVE}</button>` : ''}
      </span>
    </div>
    <div class="demand-info">
      ${infoBase ? `<div class="demand-info-row">${infoBase}</div>` : ''}
      ${infoDemandRow ? `<div class="demand-info-row">${infoDemandRow}</div>` : ''}
      ${infoScores ? `<div class="demand-info-row">${infoScores}</div>` : ''}
    </div>
    ${d.address ? `<div class="list-card-detail">${UI.ADDRESS_PREFIX}${escHtml(d.address)}</div>` : ''}
    ${d.additional_info ? `<div class="list-card-detail">${UI.ADDITIONAL_PREFIX}${escHtml(d.additional_info)}</div>` : ''}
    <div class="demand-card-foot">
      <div class="list-card-contact">
        <span class="contact-sign-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span>
      </div>
      ${editable && d.status !== 'revoked' ? `<button type="button" class="drop-toggle glass glass--solid" id="intent-toggle-${d.id}" onclick="toggleDemandIntents(${d.id})">${UI.INTENTS_TITLE} (${d.intent_count || 0}) <span class="drop-caret">${CARET_SVG}</span><span class="corner-dot${d.pending_intents ? '' : ' hidden'}" id="intent-dot-${d.id}"></span></button>` : ''}
    </div>
    ${editable && d.status !== 'revoked' ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
    </div>
  </div>`;
}

async function loadDemandList(elId, { mine }) {
  // 教师大厅视角附带你自己的意向状态（my_intent_status），供按钮三态渲染
  const url = mine ? '/api/student/demands?scope=mine'
                   : '/api/student/demands?scope=for-teacher';
  await loadInto(elId, async () => {
    const data = await dhGet(url, { domain: 'demands' }); // v0.23.0 静默数据层
    const demands = data.demands || [];
    if (mine) {
      state.myDemands = demands; // 编辑回填的数据源
      setBadge('my-demands', demands.filter(d => d.pending_intents > 0).length); // 有待处理意向的需求数 → 侧栏红点
    }
    return demands;
  }, demands => demands.map(d => renderDemandCard(d, { editable: mine, teacher: !mine })).join(''),
  { empty: mine ? UI.EMPTY_NO_MY_DEMANDS : UI.EMPTY_NO_DEMANDS, peek: () => dhPeek(url) });
}

function loadMyDemands()     { return loadDemandList('my-demands-list', { mine: true }); }

// 重开「合同已撤销」的需求：revoked→open 重回广场接收意向（手动触发；后端把关所有者+状态）
function reopenDemand(demandId) {
  openConfirmModal(UI.CONFIRM_REOPEN_DEMAND, async () => {
    try {
      const data = await api(`/api/student/demands/${demandId}/reopen`, { method: 'POST', body: {} });
      showToast(data.message || UI.DEMAND_REOPENED_TOAST);
      invalidate('demands');
      loadMyDemands();
    } catch (err) { showToast(err.message); }
  });
}

// 教师需求大厅：普通需求 + 学生主动推送的待处理需求（置顶 + 特殊操作行）
async function loadBrowseDemands() {
  // 乱序守卫：快速进出页签时丢弃过期响应。
  // 计数器首用须 || 0 初始化——++undefined=NaN，而 NaN !== NaN 恒真会把首次渲染误判为过期而丢弃
  //（loadInto 同款坑注释见 app-shell.js；此处在 v0.21.0 起因漏初始化致需求大厅恒不渲染）
  const seq = (loadSeqs['browse-demands'] = (loadSeqs['browse-demands'] || 0) + 1);
  const el = document.getElementById('demands-list');
  el.innerHTML = `<div class="empty-state">${loaderHtml()}</div>`;
  try {
    const isGuest = !state.user; // 访客教师可浏览公开需求列表；推送卡片与意向操作点了再走登录通路
    // v0.22.8：教师档案并入同一批并行取数——原逻辑在需求+推送之后串行等 /api/teachers，
    // 教师首访大厅被第三个 RTT 卡住渲染（审计热点①）
    const needTeachers = !isGuest && state.user.role === 'teacher' && !state.allTeachers.length;
    const [dData, pData, tData] = await Promise.all([
      // v0.23.0 静默数据层：三路走会话缓存（命中即返，miss 再发请求；预取已填缓存则零网络）
      dhGet(isGuest ? '/api/student/demands' : '/api/student/demands?scope=for-teacher', { domain: 'demands' }),
      isGuest ? Promise.resolve({ pushes: [] }) : dhGet('/api/demand-pushes', { domain: 'demands' }),
      needTeachers ? dhGet('/api/teachers', { domain: 'teachers' }).catch(() => null) : Promise.resolve(null), // 教师档案失败不阻塞需求列表
    ]);
    if (needTeachers && tData && Array.isArray(tData.teachers)) state.allTeachers = tData.teachers;
    const pushes = pData.pushes || [];
    const demands = dData.demands || [];
    _browseDemands = [...pushes, ...demands]; // 匹配度明细取数源（push 置顶卡与普通卡同库）
    if (state.page === 'browse-demands') setBadge('browse-demands', 0); // 进页即视为已读；await 期间若已切走，不得掐灭轮询刚点亮的新推送红点
    if (seq !== loadSeqs['browse-demands']) return; // 过期响应不渲染
    if (!pushes.length && !demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    // 当前教师档案（匹配度徽章用）：登录教师 + 已填档案时才有
    const myTeacher = (!isGuest && state.user.role === 'teacher') ? state.allTeachers.find(t => t.user_id === state.user.id) : null;
    const pushDemandIds = new Set(pushes.map(p => p.id));
    const pinned = pushes.map(p => renderDemandCard(p, { push: p, teacher: true, myTeacher })).join('');
    const normal = demands.filter(d => !pushDemandIds.has(d.id)).map(d => renderDemandCard(d, { teacher: true, myTeacher })).join('');
    if (seq !== loadSeqs['browse-demands']) return; // 内层 await（拉教师档案）期间再进页：过期响应不渲染
    el.innerHTML = (pinned ? `<div class="section-title" style="margin-bottom:8px;">${UI.PUSH_SECTION_TITLE}</div>${pinned}` : '') + normal;
    initReveals(el);
  } catch (err) {
    if (seq !== loadSeqs['browse-demands']) return; // 过期请求的错误不覆盖新列表
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 学生把某条需求主动发给指定教师：弹窗列出自己的需求单选
async function openSendDemandModal(teacherUserId) {
  if (!ensureAuth()) return;
  const t = state.allTeachers.find(x => x.user_id === teacherUserId);
  const tName = t ? t.username : UI.PUSH_TEACHER_FALLBACK;
  // 每次现拉自己的需求（不用页内缓存）：签约可能在其他页发生，缓存会把已签约需求漏进候选
  let demands = [];
  try { demands = (await api('/api/student/demands?scope=mine')).demands || []; state.myDemands = demands; }
  catch { demands = state.myDemands; }
  demands = demands.filter(d => d.status !== 'contracted'); // 已签约需求已成交，不可再推送
  const pickHtml = demands.length ? `<div class="push-pick">${demands.map(d => {
    const grade = STUDENT_GRADES.find(g=>g.id===d.student_grade)?.name || d.student_grade || '';
    const subs = DISP.subjectNames(d.target_subjects);
    const prov = DISP.provinceName(d.province);
    const method = DISP.methodName(d.teaching_method);
    return `<label class="push-pick-item glass"><input type="radio" name="push-demand" value="${d.id}">
      <span><span class="push-pick-main">${escHtml(grade)}${subs ? ' · ' + escHtml(subs) : ''}</span>
      <span class="push-pick-sub">${[prov, method].filter(Boolean).map(escHtml).join(' · ')}</span></span></label>`;
  }).join('')}</div>` : `<p class="text-sm text-muted">${state.myDemands.length ? UI.PUSH_NO_AVAILABLE_DEMANDS : UI.EMPTY_NO_MY_DEMANDS_SHORT}</p>`;
  openModal({
    title: `${UI.PUSH_MODAL_TITLE_PREFIX}${escHtml(tName)}`,
    style: 'max-width:480px;',
    closable: false,
    body: `<p class="text-sm text-muted" style="margin-bottom:12px;">${UI.PUSH_MODAL_HINT}</p>
        ${pickHtml}`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" ${demands.length ? '' : 'disabled'} onclick="submitDemandPush(${teacherUserId})">${UI.BTN_SEND}</button>`,
  });
}

// 推送限流：每分钟限发一条。发送后全部「发送需求」按钮变灰 + 秒级倒计时
let pushCooldownUntil = 0, pushCooldownTimer = null;
function pushCooldownLeft() { return Math.max(0, Math.ceil((pushCooldownUntil - Date.now()) / 1000)); }
function renderPushBtn(t) {
  const left = pushCooldownLeft();
  return left > 0
    ? `<button type="button" class="tc-push-btn glass glass--pressable" disabled>${UI.PUSH_BTN_COOLDOWN} ${left}s</button>`
    : `<button type="button" class="tc-push-btn glass glass--pressable" onclick="openSendDemandModal(${t.user_id})">${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span></button>`;
}
function startPushCooldown(seconds) {
  pushCooldownUntil = Date.now() + seconds * 1000;
  clearInterval(pushCooldownTimer);
  pushCooldownTimer = setInterval(() => {
    const left = pushCooldownLeft();
    document.querySelectorAll('.tc-push-btn').forEach(b => {
      b.disabled = left > 0;
      b.innerHTML = left > 0 ? `${UI.PUSH_BTN_COOLDOWN} ${left}s` : `${UI.BTN_PUSH_DEMAND} <span class="arrow">→</span>`;
    });
    if (left <= 0) clearInterval(pushCooldownTimer);
  }, 1000);
}

async function submitDemandPush(teacherUserId) {
  const sel = document.querySelector('input[name="push-demand"]:checked');
  if (!sel) { showToast(UI.VALIDATE_SELECT_DEMAND); return; }
  if (pushCooldownLeft() > 0) { showToast(`${UI.PUSH_BTN_COOLDOWN} ${pushCooldownLeft()}s`); return; }
  try {
    const data = await api('/api/demand-pushes', { method: 'POST', body: { teacherUserId, demandId: +sel.value } });
    closeModal();
    startPushCooldown(60);
    showToast(data.message || UI.PUSH_SENT_FALLBACK);
  } catch (err) { showToast(err.message); }
}

// 教师处理学生主动推送：确认 = 建会话；拒绝 = 婉拒（学生收通知）
async function resolvePush(pushId, action) {
  try {
    await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.PUSH_ACCEPTED_TOAST : UI.PUSH_REJECTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则已处理推送卡从缓存滞留
    if (action === 'accept') invalidate('chat'); // accept 建会话：切到 my-chats 立即见新会话
    loadBrowseDemands();
  } catch (err) { showToast(err.message); }
}

// ============================================================
// 意向（教师提交意向 / 学生处理意向）
// ============================================================
async function submitIntent(demandId) {
  if (!ensureAuth()) return; // 访客浏览需求大厅可看卡片，点意向即走登录通路
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: {} });
    showToast(UI.INTENT_SUBMITTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则按钮仍显示「提交意向」，操作看似无效
    if (state.page === 'browse-demands') loadBrowseDemands(); // 按钮刷新为「意向已提交」态
  } catch (err) {
    if (err.code === 'PROFILE_INCOMPLETE') { showProfileIncompleteModal(); return; } // 按稳定 code 分支，勿比对中文文案
    showToast(err.message);
  }
}

// 档案不完整：拦截提交并引导去补档案（后端同样把关，弹窗只是更友好的引导）
function showProfileIncompleteModal() {
  openModal({
    title: UI.PROFILE_INCOMPLETE_TITLE,
    style: 'max-width:420px;',
    body: `<p class="text-sm" style="color:var(--ink-3);line-height:1.7;">${UI.PROFILE_INCOMPLETE_HINT}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_LATER}</button>
          <button type="button" class="btn glass glass--pressable" onclick="closeModal();selectPage('edit-profile')">${UI.BTN_GO_COMPLETE_PROFILE}</button>`,
  });
}

// 展开 / 收起某条需求的意向列表（学生端）：grid-rows 动效 + ▾ 翻转，首次展开才拉数据
async function toggleDemandIntents(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const toggle = document.getElementById(`intent-toggle-${demandId}`);
  const open = box.classList.toggle('open');
  if (toggle) toggle.classList.toggle('open', open); // v 形箭头翻转
  if (open) {
    const dot = document.getElementById(`intent-dot-${demandId}`);
    if (dot) dot.classList.add('hidden'); // 打开即视为已读，红点消除
  }
  if (open && !box.dataset.loaded) await refreshIntentsBox(demandId);
}

async function refreshIntentsBox(demandId) {
  const box = document.getElementById(`intents-box-${demandId}`);
  if (!box) return;
  const inner = box.querySelector('.intents-box-inner') || box;
  inner.innerHTML = `<div class="intents-box-content">${loaderHtml()}</div>`;
  try {
    const data = await api(`/api/demands/${demandId}/intents`);
    const ts = data.teachers || [];
    // 缓存意向教师，供个人信息面板复用（findCachedTeacher 第三数据源）
    ts.forEach(t => {
      state.intentTeachers = state.intentTeachers.filter(x => x.user_id !== t.user_id);
      state.intentTeachers.push(t);
    });
    const content = `<div class="section-title">${UI.INTENTS_TITLE} (${ts.length})</div>` +
      (ts.length ? ts.map(t => renderIntentTeacherRow(t, demandId)).join('')
                 : `<p class="text-sm text-muted">${UI.EMPTY_NO_INTENTS}</p>`);
    inner.innerHTML = `<div class="intents-box-content">${content}</div>`;
    box.dataset.loaded = '1';
  } catch (err) {
    inner.innerHTML = `<div class="intents-box-content"><p class="text-sm text-muted">${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

function renderIntentTeacherRow(t, demandId) {
  const st = t.intent_status;
  const tag = st === 'accepted' ? `<span class="tag tag-ok glass glass--solid">${UI.INTENT_STATUS_ACCEPTED}</span>`
    : st === 'rejected' ? `<span class="tag tag-danger glass glass--solid">${UI.INTENT_STATUS_REJECTED}</span>` : `<span class="tag tag-warn glass glass--solid">${UI.INTENT_STATUS_PENDING}</span>`;
  const provName = escHtml(DISP.provinceName(t.province)); // 网安审计 N-15：province 未知名回显原 id，防注入
  const viewBtn = `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="openProfilePanel(${t.user_id})">${UI.BTN_VIEW}</button>`;
  const actions = st === 'pending'
    ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'accept',${demandId})">${UI.BTN_AGREE}</button>
       <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'reject',${demandId})">${UI.BTN_REJECT}</button>` : '';
  return `<div class="admin-row glass">
    <div class="admin-row-main">
      <div class="admin-row-line"><strong>${DISP.usernameHtml(t.username)}</strong> ${DISP.starsHtml(t.rating)} ${tag}</div>
      <div class="admin-row-meta">${[provName, `${t.price || '?'}${UI.PRICE_UNIT}`].filter(Boolean).join(' · ')}</div>
    </div>
    <div class="admin-row-actions">${viewBtn}${actions}</div>
  </div>`;
}

// 学生同意 / 拒绝意向；同意后自动建立会话，可前往「我的会话」
async function resolveIntent(intentId, action, demandId) {
  try {
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.INTENT_ACCEPTED_TOAST : UI.INTENT_REJECTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则意向计数/状态不刷新
    if (action === 'accept') invalidate('chat'); // accept 建会话：切到 my-chats 立即见新会话
    await refreshIntentsBox(demandId);
    loadMyDemands(); // 刷新意向计数（整列重渲染，意向栏回到收起态）
  } catch (err) { showToast(err.message); }
}

// 登出复位：模块级残留清理（会话切换/登出时由认证层 runLogoutResets 统一调用）
registerLogoutReset(() => {
  pushCooldownUntil = 0;
  pushCooldownTimer = null;
  _browseDemands = [];
  _matchDetailOpen = false;
});
