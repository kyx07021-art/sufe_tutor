/**
 * 需求领域模块 —— 学生需求 CRUD + 意向 + 主动推送 + 匹配度
 *
 * 职责：
 *   1. 需求弹窗表单：创建/编辑（renderDemandModal + initDemandForm + 成绩回填 + 提交 handleSubmitDemand）
 *   2. 匹配度 + 需求卡：genderMatchScore/matchDims/matchDegree/matchLevel/matchRowsHtml/matchDetailHtml/
 *      showMatchDetail/closeMatchDetail/renderDemandCard
 *      （学生「我的需求」与教师「需求大厅」共用渲染，教师视角带匹配度徽章与意向按钮；
 *       需求五五维匹配：科目/性格/区域/预算/性别，权重与阈值单源 constants CONFIG；学生端教师列表匹配度复用本组函数）
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
 *   escHtml()/fmtDateTime()/fmtDate()/loaderHtml()/renderAvatarHtml()/openModal()/closeModal()/
 *   confirm()（v0.25.10：原 openConfirmModal/confirmDanger/reAuthModal 三原语合并）/initCustomSelects()/
 *   syncCustomSelectText()/CARET_SVG/pickGrade（app-ui）
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
async function openDemandModal(demandId) {
  state.editingDemandId = demandId || null;
  const demand = demandId ? state.myDemands.find(d => d.id === demandId) : null;
  // R2-b：编辑分支先异步拉最新需求（scope=mine）再回填——不依赖 state.myDemands 镜像
  // （签约/推送等可能在别页改动需求，陈旧镜像会让编辑表单回填旧值）。拉取失败回落旧缓存。
  let editDemand = demand || null;
  if (demandId) {
    // 竞态快照：await 期间若用户开了别的弹窗/切页，弹窗区内容变化 → 丢弃过期回填不覆盖
    const modalBefore = document.getElementById('modal-container').innerHTML;
    try {
      invalidate('demands'); // 编辑强制拉最新（不走 60s TTL 缓存，避免读到与 state.myDemands 相同的镜像）
      const data = await dhGet('/api/student/demands?scope=mine', { domain: 'demands' });
      if (state.editingDemandId !== demandId) return; // 竞态守卫①：用户已点开其他需求/新建
      if (document.getElementById('modal-container').innerHTML !== modalBefore) return; // 竞态守卫②：弹窗区被其他交互占用
      if (data && Array.isArray(data.demands)) {
        state.myDemands = data.demands; // 同步镜像源（与 dhOnDomainRefresh 重挂同款，编辑回填源防游离旧数组）
        editDemand = data.demands.find(x => x.id === demandId) || demand;
      }
    } catch {
      if (state.editingDemandId !== demandId || document.getElementById('modal-container').innerHTML !== modalBefore) return;
      editDemand = demand;
    }
  }
  // v0.25.31 需求表单点遮罩不关（编辑成本高，防误触丢输入；仅 ✕/取消关闭，与发帖/签约表单同口径）
  openModal({ title: editDemand ? UI.MODAL_TITLE_DEMAND_EDIT : UI.MODAL_TITLE_DEMAND_CREATE, body: renderDemandModal(editDemand), closable: false });
  initDemandForm(editDemand ? editDemand.province : null);
  if (editDemand) prefillDemandForm(editDemand);
}

// R2-b 需求类型分段切换：学科 / 非学科。JS 只切 .active/.hidden 类（零内联样式），样式在 style.css
function switchDemandType(btn) {
  setDemandType(btn.dataset.type);
}
function setDemandType(type) {
  const isAc = type !== DEMAND_TYPES.NONACADEMIC;
  const tabs = document.getElementById('d-type-tabs');
  if (tabs) tabs.querySelectorAll('.seg-tab').forEach(t => t.classList.toggle('active', t.dataset.type === type));
  const ac = document.getElementById('d-section-academic');
  const na = document.getElementById('d-section-nonacademic');
  if (ac) ac.classList.toggle('hidden', !isAc);
  if (na) na.classList.toggle('hidden', isAc);
}

function renderDemandModal(demand) {
  // R2-b 学生性别选项：'' = 不愿透露（默认，视同未填）+ GENDERS 男/女；
  // GENDERS 教师侧含 undeclared 默认（学生侧以 '' 表示不愿透露，剔除 undeclared 与历史 nonbinary）
  const studentGenders = [{ id: '', name: UI.OPTION_GENDER_NOT_SAY }, ...GENDERS.filter(g => g.id !== 'undeclared' && g.id !== 'nonbinary')];
  const prefGenders = GENDERS.filter(g => g.id !== 'undeclared' && g.id !== 'nonbinary'); // 偏好老师性别：不限('') + 男/女
  return `
        <form onsubmit="handleSubmitDemand(event)" id="demand-form">
          <div class="form-group">
            <!-- R2-8 学科/非学科分段切换：标准分段控件 .seg-tabs（v0.25.20 需求二；v0.25.23 审计：构造走 segTabsHtml 壳） -->
            ${segTabsHtml([
              { key: DEMAND_TYPES.ACADEMIC, label: UI.LABEL_TYPE_ACADEMIC, onclick: 'switchDemandType(this)' },
              { key: DEMAND_TYPES.NONACADEMIC, label: UI.LABEL_TYPE_NONACADEMIC, onclick: 'switchDemandType(this)' },
            ], DEMAND_TYPES.ACADEMIC, { containerClass: 'demand-type-tabs', containerId: 'd-type-tabs', attr: 'type' })}
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PROVINCE} <span class="req">*</span></label>
            <span id="d-province-wrap"></span>
            <div id="d-region-note"></div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GRADE} <span class="req">*</span></label>
            <!-- M3（v0.25.103）：年级随地区学制动态（上海五四学制无小学六年级、六年级=预备班）；
                 未选地区时禁用并提示先选地区 -->
            <select class="form-select" id="d-grade" required onchange="updateDemandSubjects()"${demand && demand.province ? '' : ' disabled'}>
              <option value="">${demand && demand.province ? UI.OPTION_PLACEHOLDER : UI.SELECT_PROVINCE_FIRST}</option>${gradeOptionsForProvince(demand && demand.province).map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_STUDENT_GENDER}</label>
            <select class="form-select" id="d-gender">
              ${studentGenders.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="demand-section" id="d-section-academic">
            <div class="form-group">
              <label class="form-label">${UI.LABEL_TARGET_SUBJECTS} <span class="req">*</span>${UI.LABEL_MULTI_SUFFIX}</label>
              <div class="checkbox-grid" id="d-subjects">${checkboxItemsHtml(SUBJECTS)}</div>
            </div>
            <div class="form-group" id="d-scores-wrap">
              <label class="form-label">${UI.LABEL_CURRENT_SCORES}</label>
              <div id="d-scores"><p class="text-sm text-muted">${UI.HINT_SELECT_TARGET_SUBJECTS}</p></div>
            </div>
          </div>
          <div class="demand-section hidden" id="d-section-nonacademic">
            <div class="form-group">
              <label class="form-label">${UI.LABEL_TARGET_PROJECTS} <span class="req">*</span>${UI.LABEL_MULTI_SUFFIX}</label>
              <div class="checkbox-grid" id="d-nonacademic">${checkboxItemsHtml(NONACADEMIC_PROJECTS)}</div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PREFERRED_PERSONALITY}${UI.PERSONALITY_TAGS_HINT.replace('{max}', CONFIG.PERSONALITY_TAGS_MAX)}</label>
            <div id="d-personality-tags">${PERSONALITY_TAGS.map(tag=>
              `<button type="button" class="tag-pick glass glass--solid" data-id="${escHtml(tag.id)}" onclick="toggleTagPick(this, 'd-personality-tags', ${CONFIG.PERSONALITY_TAGS_MAX})">${escHtml(tag.name)}</button>`).join('')}</div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_PREFERRED_GENDER}</label>
            <select class="form-select" id="d-pref-gender">
              <option value="">${UI.OPTION_PREF_GENDER_ANY}</option>${prefGenders.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_TEACHING_METHOD} <span class="req">*</span></label>
            <select class="form-select" id="d-method" required onchange="toggleAddressField()">
              ${TEACHING_METHODS.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
            </select>
          </div>
          <div id="d-address-section">
            <div class="form-group">
              <!-- 需求五：地址结构化（区·镇/街道 二级联动），picker 渲染进容器；隐藏 input 保持提交签名不变 -->
              <label class="form-label">${UI.LABEL_ADDRESS} <span class="req">*</span></label>
              <div id="d-addr-picker" class="sh-addr-picker"></div>
              <input type="hidden" id="d-address" placeholder="${UI.ADDRESS_PLACEHOLDER}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_BUDGET}</label>
            <div class="range-row">
              <input type="number" class="form-input" id="d-budget-min" placeholder="${UI.PLACEHOLDER_MIN}" min="0" step="1">
              <span class="text-muted">~</span>
              <input type="number" class="form-input" id="d-budget-max" placeholder="${UI.PLACEHOLDER_MAX}" min="0" step="1">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${UI.LABEL_EXPECTED_TIME}</label>
            <div id="d-time-slots" class="time-slots">${renderTimeSlotContainerHtml()}</div>
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

// M3（v0.25.103）：年级选项按地区学制——五四学制（上海）无小学六年级、六年级=初中预备班；
// 默认六三学制含小学六年级。单源 FIVE_FOUR_PROVINCES + STUDENT_GRADES。
function gradeOptionsForProvince(prov) {
  const fiveFour = globalThis.SUFE_REGIONS && globalThis.SUFE_REGIONS.isFiveFour(prov);
  return STUDENT_GRADES.filter(g => {
    if (g.id === 'prep') return !!fiveFour;
    if (g.id === 'p6') return !fiveFour;
    return true;
  });
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
  // R2-b：先按类型激活对应区块，再回填该类型的 target 勾选
  setDemandType(d.target_type === DEMAND_TYPES.NONACADEMIC ? DEMAND_TYPES.NONACADEMIC : DEMAND_TYPES.ACADEMIC);
  document.getElementById('d-gender').value = d.student_gender || ''; // '' = 不愿透露（prefill 兼容旧数据 undefined）
  // 回填勾选用遍历比对 value，勿用属性选择器插值（网安 L3：历史恶意 sid 含 " ] 会让 querySelector
  // 抛 SyntaxError 打不开编辑浮窗；v0.25.2 教师档案回填同款教训——pickById 遍历替代）
  const checkById = (containerId, pid) => {
    const el = document.getElementById(containerId);
    if (!el) return null;
    return [...el.querySelectorAll('input')].find(cb => cb.value === pid) || null;
  };
  if (d.target_type === DEMAND_TYPES.NONACADEMIC) {
    (d.target_subjects || []).forEach(sid => { const cb = checkById('d-nonacademic', sid); if (cb) cb.checked = true; });
  } else {
    (d.target_subjects || []).forEach(sid => { const cb = checkById('d-subjects', sid); if (cb) cb.checked = true; });
    updateDemandScores();
    prefillStudentScores(d.current_scores || []);
  }
  // R2-b 偏好性格 / 偏好老师性别回填
  (d.preferred_personality_tags || []).forEach(id => {
    const btn = [...document.querySelectorAll('#d-personality-tags .tag-pick')].find(b => b.dataset.id === id);
    if (btn) btn.classList.add('selected');
  });
  document.getElementById('d-pref-gender').value = d.preferred_teacher_gender || '';
  document.getElementById('d-method').value = d.teaching_method || 'offline';
  // 需求五：先写隐藏地址值再 toggleAddressField（picker 挂载时据隐藏值回填区/镇下拉）。
  // 存量兼容（v0.29.0）：库内旧自由文本地址不是合法「区·镇/街道」→ 清空重选（保存时不被 400 卡死）
  const R5 = globalThis.SUFE_REGIONS;
  const storedAddr = (R5 && R5.isValidShanghaiAddr(d.address)) ? (d.address || '') : '';
  document.getElementById('d-address').value = storedAddr;
  toggleAddressField();
  prefillTimeSlots(document.getElementById('d-time-slots'), d.expected_time || '');
  document.getElementById('d-budget-min').value = d.budget_min || '';
  document.getElementById('d-budget-max').value = d.budget_max || '';
  document.getElementById('d-submitter').value      = d.submitter_type || 'parent';
  document.getElementById('d-parent-contact').value = d.parent_contact || '';
  document.getElementById('d-student-contact').value = d.student_contact || '';
  document.getElementById('d-info').value           = d.additional_info || '';
  // 程序回填不派发 change：手动同步全部自定义下拉的触发器文字（prefillStudentScores 已同步学科分支，此处两分支兜底）
  document.querySelectorAll('#demand-form select').forEach(syncCustomSelectText);
}

// 平时成绩回填：等第数据→点等级 pill（页签默认等第制）；分数数据→先切分数制页签再填值。
// v0.25.15 审计修复：弃属性选择器插值（[data-score-subject="${cs.subject}"]），脏数据含 " 或 ] 会让
// querySelector 抛 SyntaxError → 编辑弹窗打不开（自伤 DoS）；改遍历 dataset 比对（同库内 checkById 模式）。
function prefillStudentScores(scores) {
  const rows = [...document.querySelectorAll('#d-scores .region-score-row')];
  (scores || []).forEach(cs => {
    const row = rows.find(r => r.dataset.scoreSubject === cs.subject);
    if (!row) return;
    if (cs.grade) {
      const pill = [...row.querySelectorAll('.grade-option')].find(p => p.dataset.grade === cs.grade);
      if (pill) pickGrade(pill);
    } else if (cs.score !== '' && cs.score != null) {
      const tab = row.querySelector('.seg-tab[data-mode="score"]');
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
  const prov = document.getElementById('d-province').value;
  const section = document.getElementById('d-address-section');
  const addrInput = document.getElementById('d-address');
  // 需求五：地址结构化（区·镇/街道）——仅 上海 + 线下 展示精细选择；其余线上/非上海 隐藏
  const isShanghaiOffline = prov === 'shanghai' && method !== 'online';
  if (!isShanghaiOffline) {
    section.classList.add('hidden'); // v0.25.19 审计 G-12：style.display 直写改 .hidden 类（与同文件其余显隐口径统一）
    addrInput.value = '';
    addrInput.required = false;
    return;
  }
  section.classList.remove('hidden');
  addrInput.required = true;
  if (typeof mountShanghaiAddrPicker === 'function') {
    mountShanghaiAddrPicker('d', addrInput.value || '', { hiddenId: 'd-address' }); // 幂等重建；组合值写 #d-address
  }
}

// 省份变化（模块1）：未选 / 非上海一律提示 + 锁线上；仅明确选中上海才放开线下
function onDemandProvinceChange() {
  const prov = document.getElementById('d-province').value;
  document.getElementById('d-region-note').innerHTML = regionLockNote(prov); // regionLockNote 对空值同样给提示
  // M3：地区→学制→年级选项重建（未选地区禁用+提示先选；切换省份保留原值若仍在列表）
  const gradeSel = document.getElementById('d-grade');
  const prevGrade = gradeSel.value;
  const gradeOpts = gradeOptionsForProvince(prov);
  gradeSel.disabled = !prov;
  gradeSel.innerHTML = `<option value="">${prov ? UI.OPTION_PLACEHOLDER : UI.SELECT_PROVINCE_FIRST}</option>`
    + gradeOpts.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  if (prevGrade && gradeOpts.some(g => g.id === prevGrade)) gradeSel.value = prevGrade;
  const methodSel = document.getElementById('d-method');
  const onlineOnly = !(globalThis.SUFE_REGIONS && globalThis.SUFE_REGIONS.allowsOffline(prov)); // 线下许可数据驱动（v0.25.86 审计去 'shanghai' 硬编码）
  [...methodSel.options].forEach(o => { o.disabled = onlineOnly && o.value !== 'online'; });
  if (onlineOnly) methodSel.value = 'online';
  toggleAddressField(); // 需求五：省份切换恒刷新地址区（上海+线下 → 精细选择；其余隐藏）
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
  const province = document.getElementById('d-province').value;
  if (!province) { showToast(UI.VALIDATE_SELECT_PROVINCE, 'error'); return; }
  // R2-b 需求类型 + 按类型收集目标（学科 → #d-subjects；非学科 → #d-nonacademic）
  const type = document.querySelector('#d-type-tabs .seg-tab.active').dataset.type;
  const targetSel = type === DEMAND_TYPES.NONACADEMIC ? '#d-nonacademic input:checked' : '#d-subjects input:checked';
  const subjects = [...document.querySelectorAll(targetSel)].map(cb => cb.value);
  if (!subjects.length) { showToast(UI.VALIDATE_SELECT_SUBJECT, 'error'); return; }

  const scores = type === DEMAND_TYPES.NONACADEMIC ? [] : collectStudentScores(); // 非学科无成绩概念
  const prefTags = [...document.querySelectorAll('#d-personality-tags .tag-pick.selected')].map(b => b.dataset.id);

  // v0.25.0 结构化期望时间：校验（半填/缺起止/结束早于开始）通过后收集为 [{type:'week',...}] JSON
  const timeErr = validateTimeSlots(document.getElementById('d-time-slots'));
  if (timeErr) { showToast(timeErr, 'error'); return; }
  const timeSlots = collectTimeSlots(document.getElementById('d-time-slots'));

  const isEdit = !!state.editingDemandId;
  const payload = { demand: {
    province,
    target_type: type,
    student_grade: document.getElementById('d-grade').value,
    student_gender: document.getElementById('d-gender').value,
    target_subjects: subjects, current_scores: scores,
    preferred_personality_tags: prefTags,
    preferred_teacher_gender: document.getElementById('d-pref-gender').value,
    teaching_method: document.getElementById('d-method').value,
    address: document.getElementById('d-address').value.trim(),
    expected_time: timeSlots.length ? JSON.stringify(timeSlots) : '',
    budget_min: +document.getElementById('d-budget-min').value,
    budget_max: +document.getElementById('d-budget-max').value,
    submitter_type: document.getElementById('d-submitter').value,
    parent_contact: document.getElementById('d-parent-contact').value.trim(),
    student_contact: document.getElementById('d-student-contact').value.trim(),
    additional_info: document.getElementById('d-info').value.trim(),
  }};

  try {
    const btn = document.getElementById('d-submit');
    btnLoading(btn);
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
    btnDone(btn, isEdit ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_DEMAND);
  }
}

// ============================================================
// 删除需求（学生撤销 / 管理员下架）
// ============================================================
function confirmDeleteDemand(demandId, asAdmin) {
  confirm({ title: UI.BTN_DELETE_DEMAND, message: UI.CONFIRM_DELETE_DEMAND, onConfirm: () => handleDeleteDemand(demandId, asAdmin ? 1 : 0) });
}

async function handleDeleteDemand(demandId, asAdmin) {
  // F12（v0.27.0）乐观删除：确认后卡片立即移除（本地数据 + DOM），失败整列重渲染恢复——
  // 删除需求不再等服务端往返（高频操作，卡顿感来源之一）。成功只 invalidate + toast（卡片已不在）。
  closeModal();
  const card = document.querySelector(`.list-card--demand[data-demand-id="${demandId}"]`);
  if (card) card.remove(); // 乐观：卡片立即消失
  state.myDemands = state.myDemands.filter(d => d.id !== demandId);
  try {
    if (asAdmin) {
      await api(`/api/admin/demands/${demandId}`, { method: 'DELETE' });
      // 审计：同步管理端数组——否则「加载更多」adminDemandsAll.concat(下一页) 整列重渲染会把已删卡复活
      if (typeof adminDemandsAll !== 'undefined') {
        adminDemandsAll = adminDemandsAll.filter(d => d.id !== demandId);
      }
    } else {
      await api(`/api/student/demands/${demandId}`, { method: 'DELETE', body: {} });
    }
    showToast(UI.SUCCESS_DEMAND_DELETED);
    invalidate('demands'); // v0.23.1 审计 M2：否则 loadMyDemands/loadBrowseDemands 命中缓存，已删需求闪回
  } catch (err) {
    // 失败回滚：整列重渲染恢复卡片（loadMyDemands/loadAdminDemands 从服务端取回该需求）
    if (asAdmin) { if (state.page === 'admin-demands') loadAdminDemands(); }
    else if (state.page === 'my-demands') loadMyDemands();
    showToast(err.message);
  }
}

// ============================================================
// 需求卡与列表（学生「我的需求」与教师「需求大厅」共用渲染）
// ============================================================

// 需求五·性别匹配分（R2-10 偏好性别）：
//   需求偏好 ''=均可 → 100（任何教师）；明确 male/female 与教师一致 → 100、相反 → 0；
//   教师不愿透露（undeclared，含历史 nonbinary/未填）→ 明确偏好折半（CONFIG.GENDER_MATCH_UNDISCLOSED=50），均可仍 100。
//   口径：教师未填性别与「不愿透露」同等对待——需求方明确性别偏好时，未披露方无法证明符合，折半而非归零（避免「没填就罚 0」过苛）。
function genderMatchScore(pref, teacherGender) {
  if (!pref) return 100;
  if (!teacherGender || teacherGender === 'undeclared' || teacherGender === 'nonbinary') return CONFIG.GENDER_MATCH_UNDISCLOSED;
  return teacherGender === pref ? 100 : 0;
}

// 需求五：上海镇间距离（Haversine，公里）。坐标取 region-data SUFE_REGIONS.shanghaiTownCoords
// （218 个镇/街道 [lat,lng] 单源，WGS-84/GCJ-02 互差数百米，20km 级评分下可忽略）。
function haversineKm(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// 距离→分数（用户定策）：20km 以内随距离增大线性下降到 0，距离再远都是 0。
function distanceScore(km) {
  const maxKm = CONFIG.MATCH_DISTANCE_MAX_KM;
  return km <= maxKm ? Math.max(0, 1 - km / maxKm) : 0;
}

// 五维分项统一计算（需求五：科目/性格/区域/预算/性别）。权重单源 constants CONFIG.MATCH_WEIGHT。
// 返回每维 { label, score, max, hint }：score 为该维加权得分（0..max，缺数据维 = null 不计入总分）。
// matchDegree 与明细卡（教师视角/学生逐需求）共用本函数——口径单点，杜绝总分与明细分叉。
// 缺数据口径：科目/区域/预算需双方都有值才计；性格仅需求有偏好才计（无偏好 = 无约束，维度不适用）；
// 性别恒计（需求偏好默认 ''=均可，总有定义）。
function matchDims(t, d) {
  const W = CONFIG.MATCH_WEIGHT;
  // R2-b 科目维度按需求类型分流：academic → 教师擅长科目 subjects；nonacademic → 教师非学科项目 nonacademic_projects
  const type = d && d.target_type === DEMAND_TYPES.NONACADEMIC ? DEMAND_TYPES.NONACADEMIC : DEMAND_TYPES.ACADEMIC;
  const tSubj = type === DEMAND_TYPES.NONACADEMIC
    ? (Array.isArray(t.nonacademic_projects) ? t.nonacademic_projects : [])
    : (Array.isArray(t.subjects) ? t.subjects : []);
  const dSubj = Array.isArray(d.target_subjects) ? d.target_subjects : [];
  const hit = dSubj.filter(s => tSubj.includes(s)).length;
  const subjOn = tSubj.length > 0 && dSubj.length > 0;
  const subjScore = subjOn ? hit / dSubj.length * W.subject : null;

  // R5-2 性格匹配：重合 tag 数 / 需求偏好数 归一 0-100 → 加权。需求无偏好则维度不适用（不计分不计权重）；
  // 教师无性格 tag 且需求有偏好 → 重合 0（教师一条偏好都满足不了）。
  const prefTags = Array.isArray(d.preferred_personality_tags) ? d.preferred_personality_tags : [];
  const tPersonality = Array.isArray(t.personality_tags) ? t.personality_tags : [];
  const pHit = prefTags.filter(tag => tPersonality.includes(tag)).length;
  const personalityOn = prefTags.length > 0;
  const personalityScore = personalityOn ? pHit / prefTags.length * W.personality : null;

  // 需求五：区域维度三分支——①线上单：距离无关，维度不参与加权（跳过）；
  // ②上海线下单：教师常住地与需求镇/街道距离 20km 线性衰减计分（缺任一坐标则跳过，不惩罚未知）；
  // ③其余线下单（非上海/历史数据）：沿旧口径同省满分/异省 0（无镇级坐标，省份即距离代理）。
  const online = d.teaching_method === 'online';
  let regionScore = null;
  let regionHint = UI.MATCH_DIM_SKIP;
  if (!online && d.province === 'shanghai') {
    const R = globalThis.SUFE_REGIONS;
    const tC = R && R.townCoordByAddr ? R.townCoordByAddr(t.address) : null;
    const dC = R && R.townCoordByAddr ? R.townCoordByAddr(d.address) : null;
    if (tC && dC) {
      const km = haversineKm(tC, dC);
      regionScore = distanceScore(km) * W.region;
      regionHint = km <= 0.5 ? UI.MATCH_DISTANCE_SAME
        : UI.MATCH_DISTANCE_HIT.replace('{km}', km < 10 ? km.toFixed(1) : String(Math.round(km)));
    } else if (!tC) {
      regionHint = UI.MATCH_DISTANCE_NO_LOCALE; // 教师未填上海常住地 → 该维跳过（不惩罚未知）
    }
  } else if (!online && t.province && d.province) {
    regionScore = t.province === d.province ? W.region : 0;
    regionHint = regionScore === W.region
      ? UI.MATCH_REGION_HIT.replace('{name}', escHtml(DISP.provinceName(d.province))) : UI.MATCH_REGION_MISS;
  } else if (online) {
    regionHint = UI.MATCH_DISTANCE_ONLINE;
  }

  // R2-13：匹配度用最低报价代表（区间重叠未来扩展）
  const budgetOn = t.price_min != null && (d.budget_min || d.budget_max);
  const budgetScore = budgetOn
    ? ((!d.budget_min || t.price_min >= d.budget_min) && (!d.budget_max || t.price_min <= d.budget_max) ? W.budget : 0) : null;

  const prefGender = d.preferred_teacher_gender || '';
  const gScore = genderMatchScore(prefGender, t.gender);
  const genderScore = gScore / 100 * W.gender;
  const genderHint = !prefGender ? UI.MATCH_GENDER_ANY
    : gScore === CONFIG.GENDER_MATCH_UNDISCLOSED ? UI.MATCH_GENDER_UNDISCLOSED
    : gScore === 100 ? UI.MATCH_GENDER_HIT : UI.MATCH_GENDER_MISS;

  return [
    { key: 'subject', label: UI.MATCH_ITEM_SUBJECT, score: subjScore, max: W.subject,
      hint: subjOn ? UI.MATCH_SUBJECT_HIT.replace('{hit}', hit).replace('{total}', dSubj.length) : UI.MATCH_DIM_SKIP },
    { key: 'personality', label: UI.MATCH_ITEM_PERSONALITY, score: personalityScore, max: W.personality,
      hint: !personalityOn ? UI.MATCH_DIM_SKIP : (pHit > 0 ? UI.MATCH_PERSONALITY_HIT.replace('{hit}', pHit).replace('{total}', prefTags.length) : UI.MATCH_PERSONALITY_MISS) },
    { key: 'region', label: UI.MATCH_ITEM_REGION, score: regionScore, max: W.region, hint: regionHint },
    { key: 'budget', label: UI.MATCH_ITEM_BUDGET, score: budgetScore, max: W.budget,
      hint: !budgetOn ? UI.MATCH_DIM_SKIP : (budgetScore === W.budget ? UI.MATCH_BUDGET_HIT : UI.MATCH_BUDGET_MISS) },
    { key: 'gender', label: UI.MATCH_ITEM_GENDER, score: genderScore, max: W.gender, hint: genderHint },
  ];
}

// 教师需求匹配度（运营建议 P3/B2 双向画像）：科目/性格/区域/预算/性别五维加权，
// 按可用维度归一化到 0-100——教师浏览需求显示「匹配度 N%」，学生看教师取各活跃需求最高值。纯前端计算零后端改动。
function matchDegree(teacher, demand) {
  if (!teacher || !demand) return null;
  const dims = matchDims(teacher, demand);
  let score = 0, total = 0;
  for (const dim of dims) {
    if (dim.score == null) continue; // 缺数据维不计
    total += dim.max;
    score += Math.min(dim.max, dim.score);
  }
  if (!total) return null;
  return Math.min(CONFIG.MATCH_MAX, Math.round(score / total * 100));
}

// 匹配度按钮三色等级（需求五·item1）：阈值单源 CONFIG.MATCH_COLOR_*，≥HIGH 绿 / ≥MID 黄 / 其余红
function matchLevel(md) {
  if (md >= CONFIG.MATCH_COLOR_HIGH) return 'hi';
  if (md >= CONFIG.MATCH_COLOR_MID) return 'mid';
  return 'lo';
}

// 五维明细行渲染（教师视角明细卡 / 学生逐需求明细共用）；score 为加权得分（null=跳过），max 为该维权重。
// R25（v0.25.90）：比例条配色随卡级三色——有效维度填充标准色 + 未填充淡色遮罩，缺数据 --skip 灰底。
// v0.25.94（用户反馈）：每个百分比条按各自比例独立配色——行级 match-row--hi/mid/lo（阈值同 matchLevel，
// 各维 score/max 归一化后判定），不再随卡级一股脑同色；总百分比仍随卡级 match-detail--*。
function matchRowsHtml(dims) {
  const row = (k, s, max, hint) => {
    const skip = s == null;
    const pct = skip ? 0 : Math.round(s / max * 100);
    const lvl = skip ? '' : (pct >= CONFIG.MATCH_COLOR_HIGH ? 'hi' : pct >= CONFIG.MATCH_COLOR_MID ? 'mid' : 'lo');
    return `<div class="match-row${lvl ? ` match-row--${lvl}` : ''}">
      <span class="match-row-top"><span class="match-row-k">${k}</span><span class="match-row-s${skip ? ' match-row-s--skip' : ''}">${skip ? UI.MATCH_DIM_SKIP : Math.round(s) + '/' + max}</span></span>
      <div class="match-bar${skip ? ' match-bar--skip' : ''}"><i style="--bar-w:${pct}%"></i></div>
      <span class="match-row-hint">${hint}</span>
    </div>`;
  };
  return dims.map(dim => row(dim.label, dim.score, dim.max, dim.hint)).join('');
}

// 权重说明文案插值单点（v0.25.8 审计修复，教师端/学生端明细卡共用）：MATCH_NOTE 权重插值收敛一处防双写漂移
function matchNoteHtml() {
  const W = CONFIG.MATCH_WEIGHT;
  return UI.MATCH_NOTE
    .replace('{subject}', W.subject).replace('{region}', W.region).replace('{budget}', W.budget)
    .replace('{personality}', W.personality).replace('{gender}', W.gender);
}

// 匹配度明细悬浮卡（v0.19.45 起）：分项对齐 matchDegree 口径（matchDims 单点），
// 缺数据维度不计分并明示。毛度同浮窗纸面（glass.css .match-detail 参数，modal 同级）
// R25（v0.25.90）：卡级三色等级类（matchLevel 同阈值）→ 总百分比/比例条/比例值随红黄绿遮罩，
// 不再恒紫；缺数据维度保持灰。比例条填充=标准色（--md-bar）、未填充=淡色遮罩（--md-track）。
function matchDetailHtml(t, d, md) {
  const note = matchNoteHtml();
  return `<div class="match-detail glass glass--float match-detail--${matchLevel(md)}" role="dialog" aria-label="${UI.MATCH_DETAIL_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${md}%</span><span class="match-detail-title">${UI.MATCH_DETAIL_TITLE}</span></div>
    <p class="match-detail-sub">${UI.MATCH_DETAIL_SUB}</p>
    ${matchRowsHtml(matchDims(t, d))}
    <p class="match-note">${note}</p>
  </div>`;
}

// 点击开关 + 外部点击 / Esc / 滚动关闭（同一时刻至多一张）。
// v0.19.46 数据从缓存重建（按按钮 data-id 找需求 + state.allTeachers 找本人档案）——
// 原 window._matchDetail 单槽被最后一张卡渲染覆盖：多 tag 时点谁都显示最后一张的数据
let _matchDetailOpen = false;
let _browseDemands = []; // 教师需求大厅当前列表（含置顶推送卡），showMatchDetail 的按 id 取数源
let _browsePushes = [], _browseNormal = []; // #158（v0.25.66）：排序/筛选控件变更时本地重渲的数据源（取数缓存命中零网络）
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
  positionFloatCard(btn, card); // v0.25.19 审计 G-14：锚定逻辑收编 app-anim 单点
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
  const idTag = d.display_id ? `<span class="demand-id-tag">${DISP.demandIdText(d.display_id)}</span>` : '';
  // 匹配度徽章（教师视角 + 教师档案齐全时展示）：需求五·item1 升级标准按钮，按分值三色遮罩（matchLevel），
  // 点击呼出明细悬浮卡（沿用 .tag-match 作关闭判定的语义标记，造型走 .match-btn--*）
  const matchTag = (teacher && myTeacher)
    ? (() => { const md = (d._md !== undefined) ? d._md : matchDegree(myTeacher, d); if (md == null) return ''; return `<button type="button" class="tag-match match-btn match-btn--${matchLevel(md)} glass glass--pressable" data-id="${d.id}" onclick="showMatchDetail(this)" title="${UI.TAG_MATCH_TITLE}">${UI.TAG_MATCH}${md}%${UI.TAG_MATCH_HINT}</button>`; })()
    : '';
  const provinceName = DISP.provinceName(d.province);
  // R2-b 类型徽章：学科 / 非学科（标题行紧邻用户名左侧展示；「非最终方案，待调整整体排版」见 CLAUDE.md R2-8）
  const typeBadge = `<span class="tag tag-accent glass glass--solid">${d.target_type === DEMAND_TYPES.NONACADEMIC ? UI.BADGE_TYPE_NONACADEMIC : UI.BADGE_TYPE_ACADEMIC}</span> `;
  // R2-b 目标名按类型分流（DISP.demandTargetNameList 单点映射）：非学科显示项目名、学科显示科目名
  const subjNames = DISP.demandTargetNameList(d.target_subjects, d.target_type);
  const grade = DISP.studentGradeName(d.student_grade);
  // R2-11 学生性别 '' = 不愿透露 与历史 nonbinary 一律视同未填：demandStudentGenderName 返回 ''，
  // 下方 .filter(Boolean) 自然省略不展示（网安 L2：存量 nonbinary 不再显示「非二元」）
  const gender = DISP.demandStudentGenderName(d.student_gender);
  const submitter = d.submitter_type === 'parent' ? UI.SUBMITTER_PARENT : UI.SUBMITTER_STUDENT;
  const method = DISP.methodName(d.teaching_method) || DISP.methodName('offline');
  // 教师视角：意向按钮四态（未提交 / 待处理 / 已建立联系→ / 未获选），状态取自列表接口的 my_intent_status
  // R11：四态统一 .btn-soft 轻量描边外观（与编辑/推送动作同族，白卡/灰底都可见）
  // R26：已建立联系不再是静态禁用按钮——「已建立联系→」可点击，直接跳到与该学生的会话页
  const teacherIntentBtn = !teacher ? ''
    : d.my_intent_status === STATUS.ACCEPTED ? `<button type="button" class="btn btn-soft btn-sm btn-intent-ok glass glass--pressable" onclick="goChatWithStudent(${d.user_id})">${UI.INTENT_ACCEPTED_GO}</button>`
    : d.my_intent_status === STATUS.PENDING  ? `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled data-demand-id="${d.id}">${UI.INTENT_PENDING}</button>`
    : d.my_intent_status === STATUS.REJECTED ? `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled>${UI.INTENT_REJECTED}</button>`
    : `<button type="button" class="btn btn-soft btn-sm glass glass--pressable btn-intent-cta" data-demand-id="${d.id}" onclick="submitIntent(${d.id})">${UI.BTN_SUBMIT_INTENT}</button>`;
  // v0.25.12（反馈 #92）：推送需求操作按钮与提交意向统一 btn-sm 尺寸（原 btn-xs 是没复用组件的败笔），
  // 与说明文案一并下沉到底栏右下角
  const pushActions = !teacher || !push ? '' : `
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="resolvePush(${push.push_id},'reject')">${UI.BTN_PUSH_REJECT}</button>
      <button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="resolvePush(${push.push_id},'accept')">${UI.BTN_PUSH_ACCEPT}</button>`;
  // 学生/管理员侧卡片操作（编辑/重开/下架）同归底栏右下角（统一 btn-sm + R11 统一 .btn-soft 外观）
  const ownerActions = (editable && d.status === STATUS.REVOKED ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="reopenDemand(${d.id})">${UI.BTN_REOPEN_DEMAND}</button>`
    : editable && d.status !== STATUS.CONTRACTED ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="openDemandModal(${d.id})">${UI.BTN_EDIT}</button>` : '')
    // v0.25.95（调试阶段放开）：管理员移除按钮放开到全部状态（含已签约 contracted，服务端 force 路径同事务清引用）
    + (admin ? `<button type="button" class="btn btn-soft btn-sm glass glass--pressable" onclick="confirmDeleteDemand(${d.id}, true)">${UI.BTN_REMOVE}</button>` : '');
  const budget = DISP.demandBudgetText(d);

  // 三行点号纯文字（同教师卡语言，行间细线分隔）：
  // ① 基本信息：地区·年级·性别·提交者 ② 教学需求：线上/下·报价 ③ 需求科目和成绩：科目: 分数/分制（等第制直接显等第）
  const infoBase = [provinceName, grade, gender, `${UI.SUBMITTER_PREFIX}${submitter}`].filter(Boolean).map(escHtml).join(' · ');
  const timeStr = d.expected_time ? `${UI.LABEL_EXPECTED_TIME}：${DISP.expectedTimeText(d.expected_time)}` : '';
  const infoDemandRow = [method, budget, timeStr].filter(Boolean).map(escHtml).join(' · ');
  const scoreItems = (d.current_scores||[]).map(cs => DISP.demandScoreCell(cs)).filter(Boolean);
  const infoScores = (scoreItems.length ? scoreItems : subjNames).map(escHtml).join(' · ');

  return `<div class="list-card list-card--demand glass" data-demand-id="${d.id}"${push ? ` data-push-id="${push.push_id}"` : ''}>
    ${renderAvatarHtml(d.avatar, d.username || '?', 'demand-avatar', d.user_id)}
    <div class="demand-card-main">
    <div class="list-card-header">
      <span class="list-card-title">${DISP.usernameHtml(d.username || '')}${DISP.deactivatedTag(d.username)}${typeBadge}${matchTag}${d.status === STATUS.CONTRACTED ? ` <span class="tag tag-ok glass glass--solid">${UI.DEMAND_TAG_CONTRACTED}</span>` : d.status === STATUS.REVOKED ? ` <span class="tag tag-warn glass glass--solid">${UI.DEMAND_TAG_REVOKED}</span>` : ''}</span>
      <span class="demand-card-tools">
        <span class="list-card-meta">${push ? fmtDate(push.push_created_at) : fmtDate(d.created_at)}</span>${idTag}
      </span>
    </div>
    <div class="demand-info">
      ${infoBase ? `<div class="demand-info-row">${infoBase}</div>` : ''}
      ${infoDemandRow ? `<div class="demand-info-row">${infoDemandRow}</div>` : ''}
      ${infoScores ? `<div class="demand-info-row">${infoScores}</div>` : ''}
    </div>
    ${d.address ? `<div class="list-card-detail">${UI.ADDRESS_PREFIX}${escHtml(d.address)}</div>` : ''}
    ${d.additional_info ? `<div class="list-card-detail">${UI.ADDITIONAL_PREFIX}${escHtml(d.additional_info)}</div>` : ''}
    ${push && push.push_message ? `<div class="greet-bubble glass">
      <div class="greet-bubble-head">${UI.GREET_HEAD_STUDENT}</div>
      <div class="greet-bubble-body">${escHtml(push.push_message)}</div>
    </div>` : ''}
    <div class="demand-card-foot">
      <div class="list-card-contact">
        ${push ? `<span class="push-note-text">${UI.PUSH_NOTE_TEXT}</span>` : `<span class="contact-sign-note">${UI.CONTACT_AFTER_SIGN_NOTE}</span>`}
      </div>
      <div class="demand-card-actions">
        ${teacher ? (push ? pushActions : teacherIntentBtn) : ''}${ownerActions}
        ${editable && d.status !== STATUS.REVOKED ? `<button type="button" class="drop-toggle glass glass--solid" id="intent-toggle-${d.id}" onclick="toggleDemandIntents(${d.id})">${UI.INTENTS_TITLE} (${d.intent_count || 0}) <span class="drop-caret">${CARET_SVG}</span><span class="corner-dot${d.pending_intents ? '' : ' hidden'}" id="intent-dot-${d.id}"></span></button>` : ''}
      </div>
    </div>
    ${editable && d.status !== STATUS.REVOKED ? `<div class="intents-box" id="intents-box-${d.id}"><div class="intents-box-inner"></div></div>` : ''}
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
  { empty: mine ? UI.EMPTY_NO_MY_DEMANDS : UI.EMPTY_NO_DEMANDS, peek: () => dhReady(url) });
}

function loadMyDemands()     { return loadDemandList('my-demands-list', { mine: true }); }

// 重开「合同已撤销」的需求：revoked→open 重回广场接收意向（手动触发；后端把关所有者+状态）
function reopenDemand(demandId) {
  confirm({ message: UI.CONFIRM_REOPEN_DEMAND, onConfirm: async () => {
    try {
      const data = await api(`/api/student/demands/${demandId}/reopen`, { method: 'POST', body: {} });
      showToast(data.message || UI.DEMAND_REOPENED_TOAST);
      invalidate('demands');
      loadMyDemands();
    } catch (err) { showToast(err.message); }
  }});
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
    _browsePushes = pushes; _browseNormal = demands; // #158：控件变更本地重渲数据源
    if (state.page === 'browse-demands') setBadge('browse-demands', 0); // 进页即视为已读；await 期间若已切走，不得掐灭轮询刚点亮的新推送红点
    if (seq !== loadSeqs['browse-demands']) return; // 过期响应不渲染
    if (!pushes.length && !demands.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_DEMANDS}</p></div>`; return; }
    initDemandControls(); // #158：排序/筛选下拉选项与标签（幂等；自定义下拉面板由 MutationObserver 自动重建）
    renderBrowseDemands(pushes, demands); // 筛选 + 排序（默认匹配度最高）+ 推送置顶
  } catch (err) {
    if (seq !== loadSeqs['browse-demands']) return; // 过期请求的错误不覆盖新列表
    el.innerHTML = `<div class="empty-state"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// #158（v0.25.66）：需求大厅排序 + 筛选控件（教师看需求默认匹配度最高）
// v0.25.110 误删「匹配度最高」（听岔：用户要删的是教师看教师，不是需求大厅）——v0.25.113 加回。
// 匹配度是「教师↔学生需求」概念，教师看需求（需求大厅）匹配度是核心价值，默认匹配度最高（无档案回落原序）；
// 教师看教师（browse-teachers）的匹配度排序已在 v0.25.112 删除（同行浏览无匹配语境）。
function initDemandControls() {
  const sort = document.getElementById('demand-sort');
  if (sort && !sort.options.length) {
    sort.innerHTML = `<option value="match" selected>${UI.DEMAND_SORT_MATCH}</option>
      <option value="newest">${UI.DEMAND_SORT_NEWEST}</option>
      <option value="budget">${UI.DEMAND_SORT_BUDGET}</option>`;
  }
  const fill = (id, opts) => {
    const el = document.getElementById(id);
    if (!el || el.options.length > 1) return; // 已填充；自定义下拉面板由 initCustomSelects 的 MutationObserver 自动重建
    el.innerHTML = `<option value="">${UI.DEMAND_FILTER_ALL}</option>` + opts.map(o =>
      `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
  };
  fill('demand-filter-subject', SUBJECTS.map(s => ({ value: s.id, label: s.name })));
  fill('demand-filter-grade', STUDENT_GRADES.map(g => ({ value: g.id, label: g.name })));
  fill('demand-filter-method', TEACHING_METHODS.map(m => ({ value: m.id, label: m.name })));
  fill('demand-filter-province', (globalThis.SUFE_REGIONS.provinces || []).map(p => ({ value: p.id, label: p.name })));
  // 标签单源（index.html 静态文本仅 JS 前兜底）
  const lbl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  lbl('demand-filter-subject-label', UI.LABEL_SUBJECT);
  lbl('demand-filter-grade-label', UI.LABEL_GRADE);
  lbl('demand-filter-method-label', UI.LABEL_TEACHING_METHOD_PROFILE);
  lbl('demand-filter-province-label', UI.LABEL_PROVINCE);
}
function toggleDemandFilters() {
  const p = document.getElementById('demand-filter-panel');
  if (p) p.classList.toggle('hidden');
}
function demandSortMode() {
  const el = document.getElementById('demand-sort');
  return el ? el.value : 'match'; // v0.25.113：教师看需求默认匹配度最高（v0.25.110 误删恢复）
}
// 控件变更：本地重渲（取数缓存命中零网络），不重拉 loader
function applyDemandControls() {
  if (state.page !== 'browse-demands') return;
  renderBrowseDemands(_browsePushes, _browseNormal);
}

// 教师需求大厅渲染（loadBrowseDemands 取数后与 applyDemandControls 共用）：
// 推送置顶 + 普通需求筛选（科目/年级/方式/省份）+ 排序（v0.25.113 恢复默认匹配度最高，最新/预算可选）
function renderBrowseDemands(pushes, demands) {
  const el = document.getElementById('demands-list');
  if (!el) return;
  const isGuest = !state.user;
  const myTeacher = (!isGuest && state.user && state.user.role === 'teacher')
    ? state.allTeachers.find(t => t.user_id === state.user.id) : null;
  const pushDemandIds = new Set(pushes.map(p => p.id));
  const pinned = pushes.map(p => renderDemandCard(p, { push: p, teacher: true, myTeacher })).join('');
  // 筛选（单值精确匹配；科目命中任一即可）
  const gv = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const fSubj = gv('demand-filter-subject'), fGrade = gv('demand-filter-grade');
  const fMethod = gv('demand-filter-method'), fProv = gv('demand-filter-province');
  const filterActive = fSubj || fGrade || fMethod || fProv;
  let normalDemands = demands.filter(d => {
    if (pushDemandIds.has(d.id)) return false;
    if (fSubj && !(d.target_subjects || []).includes(fSubj)) return false;
    if (fGrade && d.student_grade !== fGrade) return false;
    if (fMethod && d.teaching_method !== fMethod) return false;
    if (fProv && d.province !== fProv) return false;
    return true;
  });
  // v0.25.8 审计修复：_md 挂需求对象供 renderDemandCard 徽章复用（预计算一次，避免排序后渲染再算一遍）
  const mdOf = {};
  if (myTeacher) for (const d of normalDemands) { const m = matchDegree(myTeacher, d); mdOf[d.id] = m; d._md = m; }
  const mode = demandSortMode();
  if (mode === 'newest') normalDemands.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  else if (mode === 'budget') normalDemands.sort((a, b) => (a.budget_min ?? Infinity) - (b.budget_min ?? Infinity));
  else normalDemands.sort((a, b) => (mdOf[b.id] ?? -1) - (mdOf[a.id] ?? -1)); // 匹配度最高（v0.25.113 恢复；无档案沉底）
  const normal = normalDemands.map(d => renderDemandCard(d, { teacher: true, myTeacher })).join('');
  el.innerHTML = (pinned ? `<div class="section-title spacer-sm">${UI.PUSH_SECTION_TITLE}</div>${pinned}` : '')
    + normal
    + (filterActive && !normalDemands.length ? `<div class="empty-state empty-state--small"><p>${escHtml(UI.DEMAND_FILTER_EMPTY)}</p></div>` : '');
  initReveals(el);
}

// 学生把某条需求主动发给指定教师：弹窗列出自己的需求单选
async function openSendDemandModal(teacherUserId) {
  if (!ensureAuth()) return;
  const t = state.allTeachers.find(x => x.user_id === teacherUserId);
  const tName = t ? t.username : UI.PUSH_TEACHER_FALLBACK;
  // 每次现拉自己的需求：签约可能在其他页发生，已签约需求不能漏进候选——
  // F13（v0.27.0）由裸 api 改走 dhGet forceRefresh：绕过缓存保新鲜（语义不变），
  // 同时共享 datahub 在途去重 + 写缓存与徽标/列表一致（不再重复打网/缓存陈旧）
  let demands = [];
  try { demands = (await dhGet('/api/student/demands?scope=mine', { domain: 'demands', forceRefresh: true })).demands || []; state.myDemands = demands; }
  catch { demands = state.myDemands; }
  demands = demands.filter(d => DISP.demandIsActive(d)); // 需求活跃统一谓词（v0.25.10：==='open'——revoked 未重开需求亦不可推送，此前宽松口径把 revoked 漏进候选成死路按钮）
  const pickHtml = demands.length ? `<div class="push-pick">${demands.map(d => {
    const grade = DISP.studentGradeName(d.student_grade) || '';
    // R2-b：推送选择列表的「最有区分度核心信息」——非学科需求显示项目名，学科需求显示科目名
    const subs = DISP.demandTargetNames(d.target_subjects, d.target_type);
    const prov = DISP.provinceName(d.province);
    const method = DISP.methodName(d.teaching_method);
    return `<label class="push-pick-item glass"><input type="radio" name="push-demand" value="${d.id}">
      <span><span class="push-pick-main">${escHtml(grade)}${subs ? ' · ' + escHtml(subs) : ''}</span>
      <span class="push-pick-sub">${[prov, method].filter(Boolean).map(escHtml).join(' · ')}</span></span></label>`;
  }).join('')}</div>` : `<p class="text-sm text-muted">${state.myDemands.length ? UI.PUSH_NO_AVAILABLE_DEMANDS : UI.EMPTY_NO_MY_DEMANDS_SHORT}</p>`;
  // v0.28.0 M1：推送需求附带打招呼消息——自我介绍+为什么选这位老师（Airbnb 式；可选，maxlength 与后端同源）
  const greetHtml = `<div class="push-greet spacer-md">
      <label class="form-label greet-form-label" for="push-greet">${UI.PUSH_GREET_LABEL}</label>
      <textarea id="push-greet" class="form-input greet-input" rows="3" maxlength="${CONFIG.GREETING_MSG_MAX}"
        placeholder="${escHtml(UI.PUSH_GREET_PLACEHOLDER)}"></textarea>
      <p class="text-xs text-muted spacer-sm">${UI.PUSH_GREET_OPTIONAL}</p>
    </div>`;
  openModal({
    title: `${UI.PUSH_MODAL_TITLE_PREFIX}${escHtml(tName)}`,
    style: `max-width:${CONFIG.MODAL_W_SEND};`,
    closable: false,
    body: `<p class="text-sm text-muted spacer-md">${UI.PUSH_MODAL_HINT}</p>
        ${pickHtml}${greetHtml}`,
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
  const message = (document.getElementById('push-greet')?.value ?? '').trim(); // v0.28.0 M1：学生打招呼消息（可选）
  try {
    const data = await api('/api/demand-pushes', { method: 'POST', body: { teacherUserId, demandId: +sel.value, message } });
    closeModal();
    startPushCooldown(CONFIG.PUSH_COOLDOWN_SEC);
    showToast(data.message || UI.PUSH_SENT_FALLBACK);
  } catch (err) { showToast(err.message); }
}

// 教师处理学生主动推送：确认 = 建会话；拒绝 = 婉拒（学生收通知）
// F12②（v0.27.0 审计补）：乐观——点击即把推送卡动作按钮换成「已处理」占位并移除卡片推送态，
// 成功 loadBrowseDemands 收敛终态，失败恢复动作按钮（audit-flow 驳回/网络错均回滚）。
async function resolvePush(pushId, action) {
  const card = document.querySelector(`.list-card--demand[data-push-id="${pushId}"]`);
  const actionsEl = card && card.querySelector('.demand-card-actions');
  const origActionsHtml = actionsEl ? actionsEl.innerHTML : '';
  const doneTag = `<span class="tag tag-ok glass glass--solid">${action === 'accept' ? UI.PUSH_ACCEPTED_TAG : UI.PUSH_REJECTED_TAG}</span>`;
  if (actionsEl) actionsEl.innerHTML = doneTag; // 乐观：动作按钮即刻变「已处理」占位
  // 注：_browseDemands 不改——loadBrowseDemands 从缓存全量重建（成功路径），失败只还原 DOM 按钮即可
  try {
    await api(`/api/demand-pushes/${pushId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.PUSH_ACCEPTED_TOAST : UI.PUSH_REJECTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则已处理推送卡从缓存滞留
    if (action === 'accept') invalidate('chat'); // accept 建会话：切到 my-chats 立即见新会话
    loadBrowseDemands();
  } catch (err) {
    // 失败回滚：恢复动作按钮（audit-flow 驳回/网络错均可重试）
    if (actionsEl && origActionsHtml) actionsEl.innerHTML = origActionsHtml;
    showToast(err.message);
  }
}

// ============================================================
// 意向（教师提交意向 / 学生处理意向）
// ============================================================
async function submitIntent(demandId) {
  if (!ensureAuth()) return; // 访客浏览需求大厅可看卡片，点意向即走登录通路
  // v0.28.0 M1：由「二次确认」改为「打招呼消息」浮窗（Airbnb 租客对房东式）——
  // 保留需求核心信息上下文，教师附一条友善的自我介绍/为什么想接这单，可留空直接提交
  const d = _browseDemands.find(x => x.id === demandId);
  const demandDesc = d
    ? `${DISP.demandTargetNames(d.target_subjects, d.target_type) || '—'} · ${DISP.demandIdText(d.display_id || d.id)}`
    : '';
  openModal({
    title: UI.INTENT_GREET_TITLE,
    style: `max-width:${CONFIG.MODAL_W_INTENT_CONFIRM};`,
    body: `<p class="text-sm text-muted spacer-md">${UI.INTENT_GREET_DEMAND.replace('{demand}', escHtml(demandDesc))}</p>
        <label class="form-label greet-form-label" for="intent-greet-${demandId}">${UI.INTENT_GREET_LABEL}</label>
        <textarea id="intent-greet-${demandId}" class="form-input greet-input" rows="4" maxlength="${CONFIG.GREETING_MSG_MAX}"
          placeholder="${escHtml(UI.INTENT_GREET_PLACEHOLDER)}"></textarea>
        <p class="text-xs text-muted spacer-sm">${UI.INTENT_GREET_OPTIONAL}</p>`,
    footer: `<button type="button" class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button type="button" class="btn glass glass--pressable" onclick="doSubmitIntent(${demandId})">${UI.BTN_SUBMIT_INTENT}</button>`,
  });
}

// 试课意向实际提交（二次确认通过后）：先关确认浮窗再 POST。
// F12（v0.27.0）乐观反馈：确认后按钮立即置「待处理」态（本地数据 + 就地替换按钮），失败回滚——
// 不等服务端往返，教师提交试课意向的卡顿感消除（audit-flow 驳回/网络错均回滚原按钮）。
async function doSubmitIntent(demandId) {
  // v0.28.0 M1：打招呼消息须在 closeModal 前读取（弹窗关闭即销毁 textarea，closeModal 后读恒空串）
  const message = (document.getElementById(`intent-greet-${demandId}`)?.value ?? '').trim();
  closeModal();
  const d = _browseDemands.find(x => x.id === demandId);
  const origStatus = d ? d.my_intent_status : undefined;
  const pendingHtml = `<button type="button" class="btn btn-soft btn-sm btn-intent-wait glass glass--pressable" disabled data-demand-id="${demandId}">${UI.INTENT_PENDING}</button>`;
  if (d) d.my_intent_status = STATUS.PENDING;
  const cta = document.querySelector(`.btn-intent-cta[data-demand-id="${demandId}"]`);
  const origHtml = cta ? cta.outerHTML : ''; // 先捕获原按钮（常量派生的 HTML，非用户输入）
  if (cta) cta.outerHTML = pendingHtml; // 乐观：按钮立即变「待处理」
  try {
    await api(`/api/demands/${demandId}/intents`, { method: 'POST', body: { message } });
    showToast(UI.INTENT_SUBMITTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则按钮仍显示「提交意向」，操作看似无效
  } catch (err) {
    // 失败回滚：恢复本地状态 + 还原按钮
    if (d) d.my_intent_status = origStatus;
    const wait = document.querySelector(`.btn-intent-wait[data-demand-id="${demandId}"]`);
    if (wait) wait.outerHTML = origHtml;
    if (err.code === 'PROFILE_INCOMPLETE') { showProfileIncompleteModal(); return; } // 按稳定 code 分支，勿比对中文文案
    showToast(err.message);
  }
}

// 档案不完整：拦截提交并引导去补档案（后端同样把关，弹窗只是更友好的引导）
function showProfileIncompleteModal() {
  openModal({
    title: UI.PROFILE_INCOMPLETE_TITLE,
    style: `max-width:${CONFIG.MODAL_W_PROFILE_HINT};`,
    body: `<p class="text-sm text-relaxed text-ink-3">${UI.PROFILE_INCOMPLETE_HINT}</p>`,
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
  // 需求四·4b：用户名+星级包 intent-row-user、状态 tag 独立——移动端整行纵向排布，
  // tag 恒置于用户名下方（不与用户名同行）；桌面保持现状
  const tag = st === STATUS.ACCEPTED ? `<span class="tag tag-ok glass glass--solid">${UI.INTENT_STATUS_ACCEPTED}</span>`
    : st === STATUS.REJECTED ? `<span class="tag tag-danger glass glass--solid">${UI.INTENT_STATUS_REJECTED}</span>` : `<span class="tag tag-warn glass glass--solid">${UI.INTENT_STATUS_PENDING}</span>`;
  const provName = escHtml(DISP.provinceName(t.province)); // 网安审计 N-15：province 未知名回显原 id，防注入
  // v0.25.94（用户反馈「编辑/试课意向颜色不一致、有的有边框有的没有」）：卡片动作按钮统一 .btn-soft
  // 轻量描边族（白调面 + 细边框，与编辑/试课意向/推送动作同口径）——VIEW/AGREE/REJECT 从
  // btn-outline/裸 btn 统一为 btn-soft，弃「同排一个无边框一个带边框」的混搭。
  const viewBtn = `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="openProfilePanel(${t.user_id})">${UI.BTN_VIEW}</button>`;
  const actions = st === STATUS.PENDING
    ? `<button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'accept',${demandId})">${UI.BTN_AGREE}</button>
       <button type="button" class="btn btn-soft btn-xs glass glass--pressable" onclick="resolveIntent(${t.intent_id},'reject',${demandId})">${UI.BTN_REJECT}</button>` : '';
  // R2-5 报价区间（未填显 ? 占位，同旧单值口径）
  const priceLine = DISP.priceRangeText(t.price_min, t.price_max, UI.PRICE_UNIT) || '?';
  // v0.28.0 M1：教师打招呼消息显示在意向卡 meta 下方——完整渲染全文（无省略号），卡片随内容增高
  const greetHtml = t.intent_message ? `<div class="greet-bubble glass greet-bubble--row">
      <div class="greet-bubble-head">${UI.GREET_HEAD_TEACHER}</div>
      <div class="greet-bubble-body">${escHtml(t.intent_message)}</div>
    </div>` : '';
  return `<div class="admin-row glass" data-intent-id="${t.intent_id}">
    <div class="admin-row-main">
      <div class="admin-row-line intent-row-line">
        <span class="intent-row-user"><strong>${DISP.usernameHtml(t.username)}</strong> ${DISP.starsHtml(t.rating)}</span>${tag}
      </div>
      <div class="admin-row-meta">${[provName, priceLine].filter(Boolean).join(' · ')}</div>
      ${greetHtml}
    </div>
    <div class="admin-row-actions">${viewBtn}${actions}</div>
  </div>`;
}

// 学生同意 / 拒绝意向；同意后自动建立会话，可前往「我的会话」
// F12②（v0.27.0 审计补）：乐观——点击即把行状态翻到目标终态（tag 变已同意/已拒绝 + 动作按钮隐藏），
// 成功 refreshIntentsBox 收敛终态，失败恢复 tag/按钮/内存状态（audit-flow 驳回/网络错均回滚）。
async function resolveIntent(intentId, action, demandId) {
  const row = document.querySelector(`.admin-row[data-intent-id="${intentId}"]`);
  const t = (state.intentTeachers || []).find(x => x.intent_id === intentId);
  const origStatus = t ? t.intent_status : STATUS.PENDING;
  const tagEl = row && row.querySelector('.intent-row-line .tag');
  const actionsEl = row && row.querySelector('.admin-row-actions');
  const origTagHtml = tagEl ? tagEl.outerHTML : '';
  const origActionsHtml = actionsEl ? actionsEl.innerHTML : '';
  const newTag = action === 'accept'
    ? `<span class="tag tag-ok glass glass--solid">${UI.INTENT_STATUS_ACCEPTED}</span>`
    : `<span class="tag tag-danger glass glass--solid">${UI.INTENT_STATUS_REJECTED}</span>`;
  if (t) t.intent_status = action === 'accept' ? STATUS.ACCEPTED : STATUS.REJECTED; // 乐观：内存先行（refreshIntentsBox 同源）
  if (tagEl) tagEl.outerHTML = newTag; // 乐观：状态 tag 即刻翻转
  if (actionsEl) actionsEl.innerHTML = ''; // 乐观：动作按钮即刻隐藏
  try {
    await api(`/api/intents/${intentId}/resolve`, { method: 'POST', body: { action } });
    showToast(action === 'accept' ? UI.INTENT_ACCEPTED_TOAST : UI.INTENT_REJECTED_TOAST);
    invalidate('demands'); // v0.23.1 审计 M2：否则意向计数/状态不刷新
    if (action === 'accept') invalidate('chat'); // accept 建会话：切到 my-chats 立即见新会话
    await refreshIntentsBox(demandId);
    loadMyDemands(); // 刷新意向计数（整列重渲染，意向栏回到收起态）
  } catch (err) {
    // 失败回滚：恢复 tag + 动作按钮 + 内存状态
    if (t) t.intent_status = origStatus;
    if (row) {
      const curTag = row.querySelector('.intent-row-line .tag');
      if (curTag && origTagHtml) curTag.outerHTML = origTagHtml;
      const curActions = row.querySelector('.admin-row-actions');
      if (curActions) curActions.innerHTML = origActionsHtml;
    }
    showToast(err.message);
  }
}

// 登出复位：模块级残留清理（会话切换/登出时由认证层 runLogoutResets 统一调用）
registerLogoutReset(() => {
  pushCooldownUntil = 0;
  pushCooldownTimer = null;
  _browseDemands = [];
  _matchDetailOpen = false;
});
