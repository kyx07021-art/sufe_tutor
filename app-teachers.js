// ============================================================
// app-teachers.js — 教师领域（教师浏览/筛选 + 个人信息右栏 + 评价）
// ============================================================
// 模块职责：
//   1) 教师浏览与筛选：loadTeachers / renderTeachers / renderTeacherCard /
//      toggleFilters / applyFilters —— 错落两栏卡 + 星级/成绩行 + 方形发送需求按钮。
//   2) 全站统一个人信息右栏（取代旧教师详情弹窗）：openProfilePanel /
//      closeProfilePanel / profilePanelShowing / renderProfilePanel /
//      renderProfileInfoCard / renderProfileReviewsCard / viewTeacherCredential。
//   3) 评价：openReviewModal / setReviewStars / submitReview /
//      confirmDeleteReview / adminReviewAction。
//
// 加载序要求：本文件必须加载于共享层之后（app-state.js → app-api.js →
// app-anim.js → app-ui.js → app-display.js，运行时再叠加 app-shell/app-auth）。
// 共享层已暴露的全局（state/UI/SUBJECTS/DISP/api/escHtml/loaderHtml/openModal/
// DISP.starsHtml/…）一律直接引用，绝不在此重复定义；renderUsername/renderStars
// 兼容别名已删，本文件统一写 DISP.usernameHtml / DISP.starsHtml。
//
// 个人信息栏「开闭状态管理与动画彻底解耦」（CLAUDE.md 前端渲染/动画铁律）：
//   JS 只切 body.profile-panel-open / .profile-panel-closing 类 + animationend 收尾，
//   动画、原子隐藏、时序全由 CSS 呈现层负责，JS 零内联样式操作；panelSeq 作废在途异步。
//
// 依赖的共享全局：
//   state、UI、SUBJECTS、DISP、invalidate()、registerLogoutReset()（app-state.js）
//   api()（app-api.js）；showToast()、initReveals()（app-anim.js）
//   escHtml()、fmtDateTime()、loaderHtml()、renderAvatarHtml()、openModal()、
//   closeModal()、openImageViewer()、confirm()（app-ui.js，v0.25.10 合并原 confirmDanger）
//   DISP.starsHtml / usernameHtml / subjectName / roleLabel / provinceName /
//   genderName / teacherGradeName / gaokaoCell / ratingText / reviewStatusTagHtml（app-display.js）
//   loadInto()（app-shell）；renderPushBtn()（app-demands）、loadAdminReviews()（app-admin）
//   需求五：matchDegree/matchDims/matchRowsHtml/matchLevel（app-demands，本文件之后即加载）——
//   学生端教师匹配度与教师端需求匹配度共用同一五维算法与明细卡开关（_matchDetailOpen/closeMatchDetail）
// ============================================================

// ============================================================
// 浏览教师
// ============================================================
async function loadTeachers() {
  // Populate subject filter
  const subjectFilter = document.getElementById('filter-subject');
  if (subjectFilter.options.length <= 1) {
    SUBJECTS.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; subjectFilter.appendChild(o); });
  }

  await loadInto('teachers-list', async () => {
    const data = await dhGet('/api/teachers', { domain: 'teachers' }); // v0.23.0 静默数据层
    state.allTeachers = data.teachers || []; // 先回写再判空渲染
    // 需求五·item5/6：学生看教师列表 → 对全部「活跃未匹配需求」逐一算匹配度、取最高值，默认按匹配度从高到低排序；
    // 教师看教师 / 访客 → 不参与匹配度（保持服务端原序）
    await attachStudentMatch(state.allTeachers);
    sortTeachersByMatch(state.allTeachers);
    return state.allTeachers;
  }, teachers => teachers.map(renderTeacherCard).join(''),
    { empty: UI.EMPTY_NO_TEACHERS, peek: () => dhReady('/api/teachers') });
}

function renderTeachers(teachers) {
  const el = document.getElementById('teachers-list');
  if (!teachers.length) { el.innerHTML = `<div class="empty-state"><p>${UI.EMPTY_NO_TEACHERS}</p></div>`; return; }
  sortTeachersByMatch(teachers); // 筛选后仍按匹配度排（匹配度数据随教师对象保留在 _matchForStudent）
  el.innerHTML = teachers.map(renderTeacherCard).join('');
  initReveals(el);
}

// 需求五·item5：学生端教师匹配度。对该学生所有 status='open'（活跃未匹配）需求逐条算 matchDegree，
// 取最高值作卡片徽章，并把逐需求明细（按匹配度降序）挂到教师行 _matchForStudent 供明细卡渲染。
// 非学生 / 无开放需求 → 不挂（卡上不显示匹配度、不参与排序）。
async function attachStudentMatch(teachers) {
  if (!state.user || state.user.role !== 'student') return;
  for (const t of teachers) delete t._matchForStudent; // v0.25.8 审计修复：先清旧匹配——开放需求归零/更换后不残留过期徽章与过期排序（缓存对象同引用复用）
  let demands = [];
  try { demands = (await dhGet('/api/student/demands?scope=mine', { domain: 'demands' })).demands || []; }
  catch { demands = []; }
  const open = demands.filter(d => DISP.demandIsActive(d)); // 需求活跃统一谓词（用户反馈 2026-08-08：==='open'，contracted/revoked 均非活跃）
  if (!open.length) return;
  for (const t of teachers) {
    const items = open
      .map(d => ({ d, md: matchDegree(t, d) }))
      .filter(x => x.md != null)
      .sort((a, b) => b.md - a.md);
    if (items.length) t._matchForStudent = { md: items[0].md, items };
  }
}

// 需求五·item6：学生看教师列表按「最高匹配度」从高到低排；无匹配度数据（教师看教师/访客/无开放需求）保持原序不排。
function sortTeachersByMatch(teachers) {
  if (!teachers.length) return;
  if (!teachers.some(t => t._matchForStudent)) return; // 无学生匹配语境：不排序（教师看教师走服务端原序）
  teachers.sort((a, b) => {
    const am = a._matchForStudent ? a._matchForStudent.md : -1;
    const bm = b._matchForStudent ? b._matchForStudent.md : -1;
    return bm - am;
  });
}

// 错落两栏卡：左 头像+用户名(可点查看详情)+星级；右 信息行1(黑稍大)+信息行2(成绩灰可换行)+方形发送需求按钮；简介独占底部一行
function renderTeacherCard(t) {
  const isStudent = state.user && state.user.role === 'student';
  const grade = DISP.teacherGradeName(t.grade) || t.grade || '';
  const gender = DISP.genderName(t.gender);
  const provName = DISP.provinceName(t.province);
  const info1 = [provName, t.school, grade].filter(Boolean).join(' · '); // 粗体行：地区·学校·年级
  const scoreLine = (t.gaokao_scores || []).map(gs => `${DISP.subjectName(gs.subject)}${DISP.gaokaoCell(gs)}`).filter(Boolean).join(' · ');
  // R2-5/R2-1/R2-2：报价区间 / 可授课时间段 / 授课方式 各一行（未填不显）
  const priceLine = DISP.priceRangeText(t.price_min, t.price_max, UI.PRICE_UNIT);
  const methodLine = DISP.methodName(t.teaching_method);
  const timeLine = DISP.expectedTimeText(t.time_slots);
  // 需求五·item5：学生端教师卡匹配度徽章（最高匹配值，三色按 matchLevel）——点击呼出逐需求明细
  const matchBtn = t._matchForStudent
    ? `<button type="button" class="tag-match match-btn match-btn--${matchLevel(t._matchForStudent.md)} glass glass--pressable" data-id="${t.user_id}" onclick="showTeacherMatchDetail(this)" title="${UI.TAG_MATCH_TITLE}">${UI.TAG_MATCH}${t._matchForStudent.md}%${UI.TAG_MATCH_HINT}</button>`
    : '';
  return `<div class="list-card list-card--teacher glass">
      ${renderAvatarHtml(t.avatar, t.username, 'tc-avatar', t.user_id)}
      <div class="tc-identity">
        <span class="tc-username" role="button" tabindex="0" aria-label="${UI.A11Y_VIEW_PROFILE}" onclick="openProfilePanel(${t.user_id})">${DISP.usernameHtml(t.username)}${t.verified ? ` <span class="glass glass--solid" title="${UI.VERIFIED_TITLE}">${UI.VERIFIED_BADGE}</span>` : ''}</span>
        <span class="tc-rating">${DISP.starsHtml(t.rating)}<b>${DISP.ratingText(t.rating)}</b></span>
        ${matchBtn ? `<span class="tc-match">${matchBtn}</span>` : ''}
        ${t.intro ? `<span class="tc-intro">${escHtml(t.intro)}</span>` : ''}
      </div>
      <div class="tc-right">
        ${info1 ? `<div class="tc-info1">${escHtml(info1)}</div>` : ''}
        ${gender ? `<div class="tc-info2">${UI.LABEL_GENDER}：${escHtml(gender)}</div>` : ''}
        ${methodLine ? `<div class="tc-info2">${UI.LABEL_TEACHING_METHOD_PROFILE}：${escHtml(methodLine)}</div>` : ''}
        ${priceLine ? `<div class="tc-info2">${UI.LABEL_PRICE}：${escHtml(priceLine)}</div>` : ''}
        ${timeLine ? `<div class="tc-info2">${UI.LABEL_TIME_SLOTS}：${escHtml(timeLine)}</div>` : ''}
        ${scoreLine ? `<div class="tc-info2">${escHtml(scoreLine)}</div>` : ''}
        <div class="tc-actions">
          ${isStudent ? renderPushBtn(t) : ''}
        </div>
      </div>
    </div>`;
}

// v0.19.46 参数化：教师块默认参数不变；通知页筛选面板同组件复用（index.html 传 id）
function toggleFilters(id = 'teacher-filters', btnId = 'filter-toggle-btn') {
  const open = document.getElementById(id).classList.toggle('open'); // grid-rows 展开动效
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('open', open); // v 形箭头翻转
}

function applyFilters() {
  const gender = document.getElementById('filter-gender').value;
  const subject = document.getElementById('filter-subject').value;
  const maxPrice = +document.getElementById('filter-price').value || Infinity;
  const minRating = +document.getElementById('filter-rating').value || 0;

  const filtered = state.allTeachers.filter(t => {
    if (gender && t.gender !== gender) return false;
    if (subject && !(t.subjects||[]).includes(subject)) return false;
    if (t.price_min != null && t.price_min > maxPrice) return false; // R2-5 按最低报价过滤（未填报价不限价）
    if ((t.rating||4) < minRating) return false;
    return true;
  });
  renderTeachers(filtered);
}

// 需求五·item5：学生端教师匹配度明细卡（同一时刻至多一张，与教师端明细共用 _matchDetailOpen/closeMatchDetail）。
// 逐需求列出五维明细，从高到低排；每条开头粗体【需求#xxxx · 主要信息】匹配度：xx%」。
function showTeacherMatchDetail(btn) {
  const t = state.allTeachers.find(x => x.user_id === +btn.dataset.id);
  if (!t || !t._matchForStudent) return;
  if (_matchDetailOpen) { closeMatchDetail(); return; }
  btn.insertAdjacentHTML('afterend', studentMatchDetailHtml(t));
  const card = btn.nextElementSibling;
  if (!card || !card.classList.contains('match-detail')) return;
  document.body.appendChild(card); // 挂 body：与教师端同因（.list-card backdrop-filter 会困住 fixed 后代）
  const r = btn.getBoundingClientRect();
  card.style.left = `${r.left}px`;
  card.style.top = `${r.bottom + CONFIG.MAX_MATCH_DETAIL_OFFSET}px`;
  // 条目区高度上限单源 CONFIG.MATCH_DETAIL_MAX_HEIGHT（几何锚定同 MAX_MATCH_DETAIL_OFFSET 的 JS 内联先例）
  const list = card.querySelector('.match-t-list');
  if (list) list.style.maxHeight = `${CONFIG.MATCH_DETAIL_MAX_HEIGHT}px`;
  _matchDetailOpen = true;
}

function studentMatchDetailHtml(t) {
  const m = t._matchForStudent;
  const note = matchNoteHtml(); // 权重插值单点（app-demands.js，与教师端明细卡共用）
  const entries = m.items.map(({ d, md }) => {
    // 头行格式（需求五·item5 钉死）：【需求#xxxx · <·号分隔的主要信息> 匹配度：xx%】——粗体一整行
    const head = `<div class="match-t-head"><b class="match-t-head-main">${UI.MATCH_T_BRACKET_L}${UI.MATCH_T_DEMAND_PREFIX}${escHtml(DISP.demandOptionText(d))} ${UI.MATCH_T_PCT}${md}%${UI.MATCH_T_BRACKET_R}</b></div>`;
    return `<div class="match-t-item glass glass--solid">${head}${matchRowsHtml(matchDims(t, d))}</div>`;
  }).join('');
  return `<div class="match-detail match-detail--teacher glass glass--float" role="dialog" aria-label="${UI.MATCH_T_TITLE}">
    <div class="match-detail-head"><span class="match-detail-pct">${m.md}%</span><span class="match-detail-title">${UI.MATCH_T_TITLE}</span></div>
    <p class="match-detail-sub">${UI.MATCH_TEACHER_DETAIL_SUB}</p>
    <div class="match-t-list">${entries}</div>
    <p class="match-note">${note}</p>
  </div>`;
}

// ============================================================
// 个人信息右栏 — 取代旧教师详情弹窗的全站统一个人信息入口：
//   桌面端：屏幕右侧 25vw 右栏（内容长可滚动）；移动端：定宽浮层 + 背景变暗。
//   卡片①头像/用户名/角色（已签约显示绿色标记）；卡片②教师资料（账簿式：
//   title 左对齐、信息自固定 px 处起，逐项成行）；卡片③评价（按钮三态：
//   未签约灰禁 / 已签约写评价 / 已评价改评价）。教师卡片②③仅教师账户有。
//   入口：全站头像（账户设置预览除外）/ 会话窗右上角人头肩线框 / 原教师详情按钮。
//   开闭状态管理（0.20.8 解耦重写）：JS 只切 body.profile-panel-open 类 + 作废在途异步；
//   动画、原子隐藏、时序全由 CSS 呈现层负责，JS 不写任何内联样式。
//   病灶回顾：0.20.5~0.20.7 曾在 close 里写 p.style.visibility='hidden'（JS 直接篡改绘制状态
//   与 CSS transition 耦合）→ 动画被瞬间压死 =「收回去瞬间消失」；0.20.7 又误删 backdrop-filter
//   治耦合，观感崩。本轮把状态与动画彻底分离，两者不再互相干涉。
// ============================================================
let profilePanelSeq = 0;      // 面板序号：异步回来时序号不符即丢弃（防换人/关闭后串号）
let profilePanelUserId = null;

function findCachedTeacher(userId) {
  return state.allTeachers.find(x => x.user_id === userId)
      || state.adminTeachers.find(x => x.user_id === userId)
      || state.intentTeachers.find(x => x.user_id === userId) || null;
}

// v0.23.1 审计 M6：探测刷新替换缓存数组后重挂 state.allTeachers——openProfilePanel/
// findCachedTeacher 等跨功能读取依赖镜像，不重挂则展示旧价格/旧认证（自愈但误导）
if (typeof dhOnDomainRefresh === 'function') {
  dhOnDomainRefresh('teachers', () => {
    const c = dhPeek('/api/teachers');
    if (c && c.teachers) state.allTeachers = c.teachers;
  });
}

async function openProfilePanel(userId) {
  const seq = ++profilePanelSeq;
  profilePanelUserId = userId;
  document.body.classList.remove('profile-panel-closing'); // 取消在途关闭动画（快速重开）
  document.body.classList.add('profile-panel-open'); // 唯一状态写入；动画/可见性交 CSS
  const titleEl = document.getElementById('profile-panel-title');
  if (titleEl) titleEl.textContent = UI.PROFILE_PANEL_TITLE; // 标题归口 constants（静态文本仅 JS 前兜底）
  const body = document.getElementById('profile-panel-body');
  body.innerHTML = `<div class="profile-loading">${loaderHtml()}</div>`;
  try {
    // ① 基础名片：公开接口（用户名/角色/头像，墓碑用户名原样返回）
    const base = (await api(`/api/users/${userId}`)).user;
    if (seq !== profilePanelSeq) return;
    const isTeacher = base.role === 'teacher';
    // ② 教师档案：优先页内缓存，未命中现拉一次教师列表（公开接口，访客可用）
    let t = null;
    if (isTeacher) {
      t = findCachedTeacher(userId);
      if (!t) {
        try { state.allTeachers = (await dhGet('/api/teachers', { domain: 'teachers' })).teachers || []; } catch { /* 无档案或网络抖动：卡片②空态 */ }
        if (seq !== profilePanelSeq) return;
        t = findCachedTeacher(userId);
      }
    }
    // ③ 签约状态 + 评价（评价仅教师有；管理员看全状态管理视图）
    let signed = false, reviewsData = null;
    if (state.user) {
      if (!state.myContracts.length) {
        try { state.myContracts = (await dhGet('/api/contracts/my', { domain: 'contracts' })).contracts || []; } catch { /* 静默 */ }
      }
      signed = state.myContracts.some(c => c.status === 'signed' && (c.student_user_id === userId || c.teacher_user_id === userId));
    }
    if (isTeacher) {
      const isAdminViewer = state.user && state.user.role === 'admin';
      try {
        reviewsData = isAdminViewer
          ? { admin: true, reviews: (await api(`/api/admin/reviews?teacherUserId=${userId}`)).reviews || [] }
          : await api(`/api/reviews?teacherUserId=${userId}`);
      } catch { reviewsData = { reviews: [] }; }
      if (seq !== profilePanelSeq) return;
    }
    state.myReviewOnModal = (reviewsData && reviewsData.mine) || null;
    // ④ 私密字段（真实姓名/学信网截图/联系方式）：列表接口永不下发，仅本人或双向匹配后定点取回并入缓存行
    // （取过一次打标记，不重复请求；签约时后端追加返回联系方式，兑现「签约后展示」）
    if (isTeacher && t && (t.matched || (state.user && state.user.id === t.user_id)) && !t._matchedDetailLoaded) {
      try {
        const pd = await api(`/api/teacher/profile?userId=${userId}`);
        if (seq !== profilePanelSeq) return;
        if (pd.profile) Object.assign(t, { real_name: pd.profile.real_name || '', credential_image: pd.profile.credential_image || '', wechat: pd.profile.wechat || '', email: pd.profile.email || '' }); // 签约后后端追加返回联系方式，此处一并并入缓存行
      } catch { /* 未匹配后端 403：按不可见处理 */ }
      t._matchedDetailLoaded = true;
    }
    body.innerHTML = renderProfilePanel(base, t, signed, reviewsData);
  } catch (err) {
    if (seq !== profilePanelSeq) return;
    body.innerHTML = `<div class="profile-loading"><p>${UI.ERROR_LOAD_PREFIX}${escHtml(err.message)}</p></div>`;
  }
}

// 个人信息栏关闭（0.20.9）：JS 只做状态管理——加 closing 类触发 CSS 滑出动画（纯 transform，
// 与 modal 同构，用户端不冻结），动画结束（animationend）后移除类回 base（屏外 + 原子隐藏）。
// 状态层与呈现层仅通过「类 + 动画事件」通信，JS 零样式操作。防竞态：seq 作废在途异步；
// userId 置空防「就地刷新重开」；finish 用 seqAt 快照防重开后旧收尾误清。
function closeProfilePanel() {
  const seqAt = ++profilePanelSeq;
  profilePanelUserId = null;
  const bodyCls = document.body.classList;
  const pnl = document.getElementById('profile-panel');
  bodyCls.add('profile-panel-closing');
  const finish = () => {
    if (seqAt !== profilePanelSeq) return; // 期间重新打开/再关闭：新流程自管类
    bodyCls.remove('profile-panel-closing');
    bodyCls.remove('profile-panel-open');
    if (pnl) pnl.removeEventListener('animationend', finish);
  };
  if (pnl) {
    pnl.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 600); // 兜底：动画未触发/被中断也必收尾
  }
}

// 关闭按钮 + 遮罩：程序化绑定（不写内联 onclick）
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('profile-panel-close');
  if (btn) btn.addEventListener('click', closeProfilePanel);
  const bd = document.getElementById('profile-panel-backdrop');
  if (bd) bd.addEventListener('click', closeProfilePanel);
});

// 面板是否正打开且展示某用户（评价提交后据此就地刷新）
function profilePanelShowing(userId) {
  return document.body.classList.contains('profile-panel-open') && profilePanelUserId === userId;
}

function renderProfilePanel(base, t, signed, reviewsData) {
  const roleLabel = DISP.roleLabel(base.role);
  const cardId = `<div class="profile-card profile-card--id glass">
      <div class="profile-id-top">
        ${renderAvatarHtml(base.avatar, base.username, 'profile-avatar')}
        ${signed ? `<span class="profile-signed-tag glass glass--solid">${UI.PROFILE_SIGNED_TAG}</span>` : ''}
      </div>
      <div class="profile-id-name">${DISP.usernameHtml(base.username)}</div>
      <div class="profile-id-role">${roleLabel}</div>
    </div>`;
  return cardId
    + (base.role === 'teacher' ? renderProfileInfoCard(t, signed) : '')
    + (base.role === 'teacher' && reviewsData ? renderProfileReviewsCard(reviewsData, t, signed) : '');
}

// 卡片②：教师资料账簿行 —— title 最左、信息自固定 px（CSS profile-row grid）处统一开始，逐项成行
// 信息卡「硬展示」：所有字段行常驻——有值显值，无值显占位（未填写 / 建立会话后展示 / 签约后展示），
// 学生据此一眼判断教师资料完善度与信息的可见门槛（占位文案统一灰显）
//
// R2-6 数据驱动重构：行序列收敛到有序配置数组 PROFILE_CARD_ITEMS，renderProfileInfoCard 只做遍历。
// 每个 item.render(h) 返回：''（该 key 不展示时跳过）| { v, muted }（单行，label 取 item.label）
// | { rows: [{ k, v, muted }, ...] }（多行，如高考成绩逐科成行）。可见性门槛（contact/credential/
// real_name）保留在各 item 的 render 内。未来加资料项只往数组 append，实现与数据分离。
//
// ============================================================
// 需求六·item1/2 教师资料卡试验 —— 试验改写流程（复用指南，照此顺序可复刻整套流程）
//   A. 去分隔线：删除 glass.css `.profile-row { border-top: 1px solid var(--g-line-row) }`（G22 单源行），
//      style.css 的 `.profile-card > .profile-row:first-child` 兜底规则（原为压首行双线）一并删。
//   B. 条目小 title 纵向居中 → 向上对齐：.profile-row 加 `align-items: start`（对齐头部而非垂直居中）。
//   C. 条目间多拉空隙：间距值进 CONFIG.PROFILE_ROW_GAP（22px），由 index.html 注入 --profile-row-gap，
//      .profile-row 用 `calc(var(--profile-row-gap) / 2) 0` 作纵向 padding（去线后需更大空隙保可读）。
//   D. 加大 title 分组：条目各加 group 字段（'top'=独立评分行；'basic'/'academic'/'nonacademic'/'private'），
//      渲染层按 PROFILE_CARD_GROUPS_ORDER 聚合，每组前渲一个 .profile-group-title 大 title（占满横向空位）。
//      个人简介（intro）从卡底挪入「基本资料」组（需求六·item2 明示）。分组 title 文案单源 constants.js UI。
//   E. 私密资料项（真实姓名/学信网截图/联系方式）提示方式统一为「两行式」：黑字值 + 灰字小提示
//      （.profile-row-note）左侧展示，见各 item.render 与 item 3 注释。
//   回滚：仅需还原上述 A~E 的 CSS 规则与 PROFILE_CARD_ITEMS 数组顺序/渲染函数。
// ============================================================
const PROFILE_CARD_GROUPS_ORDER = ['top', 'basic', 'academic', 'nonacademic', 'private'];
const PROFILE_GROUP_TITLE = {
  basic: UI.PROFILE_SECTION_BASIC, academic: UI.PROFILE_SECTION_ACADEMIC,
  nonacademic: UI.PROFILE_SECTION_NONACADEMIC, private: UI.PROFILE_SECTION_PRIVATE,
};
// 私密资料项的两行式灰字小提示（item 3：黑字 title + 灰字小提示左侧展示）
const profileNote = text => `<span class="profile-row-note">${escHtml(text)}</span>`;

const PROFILE_CARD_ITEMS = [
  // —— 独立评分行（无分组 title，恒顶置） ——
  { key: 'rating', group: 'top', label: UI.LABEL_RATING, render: h => ({ v: `<span class="profile-rating">${DISP.starsHtml(h.t.rating)}<b>${DISP.ratingText(h.t.rating)}</b></span>` }) },
  // —— 基本资料：地区/年级/学校/性别/地址/授课方式/可授课时间段/性格关键词/个人简介（简介挪上边） ——
  { key: 'region', group: 'basic', label: UI.SECTION_REGION, render: h => h.plain(DISP.provinceName(h.t.province)) },
  { key: 'grade', group: 'basic', label: UI.LABEL_GRADE, render: h => h.plain(DISP.teacherGradeName(h.t.grade)) },
  { key: 'school', group: 'basic', label: UI.LABEL_SCHOOL, render: h => h.plain(h.t.school) },
  { key: 'gender', group: 'basic', label: UI.LABEL_GENDER, render: h => h.plain(DISP.genderName(h.t.gender)) },
  { key: 'address', group: 'basic', label: UI.LABEL_ADDRESS, render: h => h.plain(h.t.address) }, // 授课区域（保留既有行）
  // R2-2 授课方式
  { key: 'teachingMethod', group: 'basic', label: UI.LABEL_TEACHING_METHOD_PROFILE, render: h => h.plain(DISP.methodName(h.t.teaching_method)) },
  // R2-1 可授课时间段（结构化 JSON → DISP.expectedTimeText 解析展示）
  { key: 'timeSlots', group: 'basic', label: UI.LABEL_TIME_SLOTS, render: h => {
    const v = DISP.expectedTimeText(h.t.time_slots);
    return v ? h.cell(v) : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  // R2-3 性格关键词（pill tag 复用 .profile-tag）
  { key: 'personality', group: 'basic', label: UI.LABEL_PERSONALITY_TAGS, render: h => {
    const tags = (h.t.personality_tags || []).map(id => {
      const name = DISP.personalityTagName(id);
      return name ? `<span class="profile-tag glass glass--solid">${escHtml(name)}</span>` : '';
    }).join('');
    return tags ? { v: tags } : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  { key: 'intro', group: 'basic', label: UI.LABEL_INTRO, render: h => h.plain(h.t.intro) },
  // —— 学科类资料：擅长科目/毕业年份/高考成绩/报价 ——
  { key: 'subjects', group: 'academic', label: UI.SECTION_SUBJECTS, render: h => {
    const tags = (h.t.subjects || []).map(sid => {
      const name = DISP.subjectName(sid);
      return name ? `<span class="profile-tag glass glass--solid">${escHtml(name)}</span>` : '';
    }).join('');
    return tags ? { v: tags } : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  // R2-12 毕业年份（有值才展示，无值整行跳过；决定该教师高考赋分按哪套政策，故紧随高考成绩前）
  { key: 'graduationYear', group: 'academic', label: UI.LABEL_GRADUATION_YEAR, render: h => h.t.graduation_year != null ? h.cell(DISP.graduationYearText(h.t.graduation_year)) : '' },
  { key: 'gaokao', group: 'academic', label: UI.LABEL_GAOKAO_SCORES, render: h => {
    // 分数不带 scale：满分由省份赋分组件决定、行数据里本就不存（与教师卡 scoreLine 同口径）
    const rows = (h.t.gaokao_scores || []).map(gs => {
      const v = DISP.gaokaoCell(gs);
      return v ? { k: escHtml(DISP.subjectName(gs.subject)), v: escHtml(v) } : null;
    }).filter(Boolean);
    return rows.length ? { rows } : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  // R2-5 报价区间（未填显占位，与教师卡 priceRangeText 同口径）
  { key: 'price', group: 'academic', label: UI.LABEL_PRICE, render: h => {
    const v = DISP.priceRangeText(h.t.price_min, h.t.price_max, UI.PRICE_UNIT);
    return v ? h.cell(v) : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  // —— 非学科类资料：擅长非学科项目（项目名 + 对应报价区间） ——
  { key: 'nonacademic', group: 'nonacademic', label: UI.LABEL_NONACADEMIC_PROJECTS, render: h => {
    const projects = h.t.nonacademic_projects || [];
    if (!projects.length) return h.empty(UI.PROFILE_FIELD_EMPTY);
    const priceBy = {};
    (h.t.nonacademic_prices || []).forEach(item => { if (item && item.project) priceBy[item.project] = item; });
    const chips = projects.map(pid => {
      const name = DISP.nonacademicProjectName(pid);
      if (!name) return '';
      const range = priceBy[pid] ? DISP.priceRangeText(priceBy[pid].price_min, priceBy[pid].price_max, UI.PRICE_UNIT) : '';
      return `<span class="profile-tag glass glass--solid">${escHtml(name)}${range ? ` ${escHtml(range)}` : ''}</span>`;
    }).filter(Boolean).join('');
    return chips ? { v: chips } : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  // —— 私密资料：真实姓名/学信网截图/联系方式（item 3：均用两行式——锁定态显灰字提示，解锁态显黑字值） ——
  { key: 'realName', group: 'private', label: UI.LABEL_REAL_NAME, render: h => {
    if (!h.t.matched) return { v: profileNote(UI.PROFILE_FIELD_AFTER_MATCH), muted: true }; // 建立会话后展示（灰字提示）
    return h.plain(h.t.real_name);
  }},
  { key: 'credential', group: 'private', label: UI.LABEL_CREDENTIAL, render: h => {
    if (!h.t.matched) return { v: profileNote(UI.PROFILE_FIELD_AFTER_MATCH), muted: true };
    return h.t.credential_image
      ? { v: `<button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="viewTeacherCredential(${h.t.user_id})">${UI.CREDENTIAL_VIEW}</button>` }
      : h.empty(UI.PROFILE_FIELD_EMPTY);
  }},
  { key: 'contact', group: 'private', label: UI.LABEL_CONTACT, render: h => {
    // 联系方式：本人或已签约（且已取回值）→ 实际值（黑字）+「签约后展示联系方式」灰字小提示；已取回但未填 → 未填写；否则 → 仅灰字提示
    const value = [h.t.wechat ? `${UI.CONTACT_PANEL_WECHAT_PREFIX}${escHtml(h.t.wechat)}` : '', h.t.email ? `${UI.CONTACT_PANEL_EMAIL_PREFIX}${escHtml(h.t.email)}` : ''].filter(Boolean).join(' · ');
    if ((h.isSelf || h.signed) && value) return { v: value + profileNote(UI.CONTACT_AFTER_SIGN_NOTE) };
    if (h.isSelf || h.signed) return h.empty(UI.PROFILE_FIELD_EMPTY);
    return { v: profileNote(UI.CONTACT_AFTER_SIGN_NOTE), muted: true };
  }},
];

function renderProfileInfoCard(t, signed) {
  if (!t) return `<div class="profile-card glass"><p class="profile-empty">${UI.PROFILE_EMPTY_TEACHER}</p></div>`;
  const isSelf = state.user && state.user.id === t.user_id;
  const row = (k, cell) => `<div class="profile-row"><span class="profile-row-k">${k}</span><span class="profile-row-v${cell.muted ? ' profile-row-v--muted' : ''}">${cell.v}</span></div>`;
  const cell = v => ({ v: escHtml(v) });
  const empty = label => ({ v: escHtml(label), muted: true });
  const plain = v => v ? cell(v) : empty(UI.PROFILE_FIELD_EMPTY); // 常规字段：空 → 未填写
  const h = { t, isSelf, signed, cell, empty, plain };
  // 需求六·item2：按分组渲染——'top'（评分）直接行，其余组先渲大 title 再渲条目。
  // 顺序与 title 单源 PROFILE_CARD_GROUPS_ORDER / PROFILE_GROUP_TITLE；条目只声明 group，加条目/加组不动渲染层。
  const byGroup = {};
  for (const item of PROFILE_CARD_ITEMS) { const g = item.group || 'basic'; (byGroup[g] = byGroup[g] || []).push(item); }
  let rowsHtml = '';
  for (const g of PROFILE_CARD_GROUPS_ORDER) {
    const items = byGroup[g];
    if (!items || !items.length) continue;
    if (g !== 'top') rowsHtml += `<div class="profile-group-title">${escHtml(PROFILE_GROUP_TITLE[g])}</div>`;
    for (const item of items) {
      const r = item.render(h);
      if (!r) continue;
      if (r.rows) { for (const rd of r.rows) rowsHtml += row(rd.k ?? item.label, { v: rd.v, muted: rd.muted }); }
      else rowsHtml += row(item.label, { v: r.v, muted: r.muted });
    }
  }
  return `<div class="profile-card glass">${rowsHtml}</div>`;
}

// 卡片③：评价列表 + 评价按钮三态（学生视角：未签约灰禁 / 签约可写 / 已评价可改）
function renderProfileReviewsCard(reviewsData, t, signed) {
  const reviews = reviewsData.reviews || [];
  const mine = reviewsData.mine || null;
  const isStudentViewer = state.user && state.user.role === 'student';
  const statusTag = r => DISP.reviewStatusTagHtml(r.status);
  const list = reviews.length ? reviews.map(r => `<div class="review-item">
      <div class="review-header">
        <span class="review-author">${DISP.usernameHtml(r.reviewer_name || '')} ${DISP.starsHtml(r.rating)} ${reviewsData.admin ? statusTag(r) : ''}</span>
        <span class="review-date">${fmtDateTime(r.created_at)}</span>
      </div>
      <div class="review-text">${escHtml(r.comment)}</div>
      ${reviewsData.admin ? `<div class="review-admin-actions">
        ${r.status === 'pending' ? `<button type="button" class="btn btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'approve',1)">${UI.BTN_APPROVE}</button>
        <button type="button" class="btn btn-outline btn-xs glass glass--pressable" onclick="adminReviewAction(${r.id},'reject',1)">${UI.BTN_REJECT}</button>` : ''}
        <button type="button" class="btn btn-xs glass glass--pressable" onclick="confirmDeleteReview(${r.id},1)">${UI.BTN_DELETE_REVIEW}</button>
      </div>` : ''}
    </div>`).join('') : `<p class="profile-empty">${UI.EMPTY_NO_REVIEWS}</p>`;
  let action = '';
  if (!reviewsData.admin && isStudentViewer) {
    action = mine ? `
      <div class="review-mine-note">${UI.MY_REVIEW_PREFIX}${mine.status === 'approved' ? UI.STATUS_APPROVED : mine.status === 'rejected' ? UI.REVIEW_REJECTED_HINT : UI.REVIEW_STATUS_AUDITING}</div>
      <button type="button" class="btn btn-outline btn-sm profile-review-btn glass glass--pressable" onclick="openReviewModal(${t.user_id}, null, ${mine.id})">${UI.BTN_EDIT_REVIEW}</button>`
      : signed ? `
      <button type="button" class="btn btn-sm profile-review-btn glass glass--pressable" onclick="openReviewModal(${t.user_id})">${UI.BTN_WRITE_REVIEW}</button>`
      : `
      <button type="button" class="btn btn-outline btn-sm profile-review-btn glass glass--pressable" disabled>${UI.BTN_WRITE_REVIEW}</button>
      <p class="profile-review-hint">${UI.REVIEW_LOCKED_HINT}</p>`;
  }
  return `<div class="profile-card glass">
    <div class="profile-card-title">${UI.SECTION_REVIEWS} (${reviews.length})</div>
    ${list}${action}
  </div>`;
}

// 个人信息面板查看对方学信网截图（数据已按双向匹配门槛取回缓存于教师行）
function viewTeacherCredential(userId) {
  const t = findCachedTeacher(userId);
  if (t && t.credential_image) openImageViewer(t.credential_image);
}

// ============================================================
// 评价 Modal
// ============================================================
// 评价弹窗：editId 有值 = 修改自己的既有评价（自 state.myReviewOnModal 回填）
function openReviewModal(teacherUserId, teacherName, editId) {
  teacherName = teacherName ?? (state.allTeachers.find(x => x.user_id === teacherUserId)?.username || '');
  const existing = editId ? state.myReviewOnModal : null;
  openModal({
    title: existing ? UI.BTN_EDIT_REVIEW : UI.REVIEW_MODAL_TITLE_PREFIX + escHtml(teacherName),
    body: `<div id="review-alert"></div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_RATING} <span class="req">*</span></label>
          <div class="star-rating-input" id="review-stars">
            ${[1,2,3,4,5].map(i=>`<button class="star-btn" data-val="${i}" onclick="setReviewStars(${i})" type="button">★</button>`).join('')}
          </div>
          <input type="hidden" id="review-rating" value="${existing ? existing.rating : 0}">
        </div>
        <div class="form-group">
          <label class="form-label">${UI.LABEL_REVIEW_CONTENT} <span class="req">*</span></label>
          <textarea class="form-input" id="review-comment" rows="4" placeholder="${UI.REVIEW_COMMENT_PLACEHOLDER}">${existing ? escHtml(existing.comment) : ''}</textarea>
        </div>`,
    footer: `<button class="btn btn-outline glass glass--pressable" onclick="closeModal()">${UI.BTN_CANCEL}</button>
          <button class="btn glass glass--pressable" onclick="submitReview(${teacherUserId}, ${existing ? existing.id : 0})">${existing ? UI.BTN_SAVE_DEMAND : UI.BTN_SUBMIT_REVIEW}</button>`,
  });
  if (existing) setReviewStars(existing.rating); // 星星高亮回填
}

function setReviewStars(val) {
  document.getElementById('review-rating').value = val;
  document.querySelectorAll('#review-stars .star-btn').forEach(btn => {
    btn.classList.toggle('active', +btn.dataset.val <= val);
  });
}

let reviewSubmitBusy = false; // 评价提交防双发（双击连发两条待审评价）

// reviewId 有值 = PUT 修改既有评价（重回审核）；否则 POST 新评价（签约门槛由后端把关）
async function submitReview(teacherUserId, reviewId) {
  const rating = +document.getElementById('review-rating').value;
  const comment = document.getElementById('review-comment').value.trim();
  const alertEl = document.getElementById('review-alert');

  if (!rating) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_SELECT_RATING}</div>`; return; }
  if (comment.length < 2) { alertEl.innerHTML = `<div class="alert alert-error glass">${UI.VALIDATE_COMMENT_TOO_SHORT}</div>`; return; }
  if (reviewSubmitBusy) return;
  reviewSubmitBusy = true;

  try {
    const data = reviewId
      ? await api(`/api/reviews/${reviewId}`, { method: 'PUT', body: { rating, comment } })
      : await api('/api/reviews', { method: 'POST', body: { teacherUserId, rating, comment } });
    closeModal();
    showToast(data.message || UI.SUCCESS_REVIEW_SUBMITTED);
    if (profilePanelShowing(teacherUserId)) openProfilePanel(teacherUserId); // 面板正展示该教师 → 评价卡片就地刷新（写/改后状态同步）
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error glass">${escHtml(err.message)}</div>`;
  } finally {
    reviewSubmitBusy = false;
  }
}

function confirmDeleteReview(reviewId, fromModal) {
  confirm({ title: UI.BTN_DELETE_REVIEW, message: UI.CONFIRM_DELETE_REVIEW, onConfirm: () => adminReviewAction(reviewId, 'delete', fromModal) });
}

// action: approve / reject / delete；fromModal: 是否从教师详情弹窗内触发（决定刷新哪里）
async function adminReviewAction(reviewId, action, fromModal) {
  try {
    if (action === 'delete') {
      await api(`/api/admin/reviews/${reviewId}`, { method: 'DELETE' });
      showToast(UI.REVIEW_DELETED);
    } else {
      await api(`/api/admin/reviews/${reviewId}/${action}`, { method: 'POST' });
      showToast(action === 'approve' ? UI.SUCCESS_APPROVED : UI.SUCCESS_REJECTED);
    }
    closeModal();
    invalidate('admin'); // v0.23.1 审计 M5：评价审核改管理端评价列表 + 教师评分（teachers）
    invalidate('teachers');
    if (fromModal && profilePanelUserId) {
      openProfilePanel(profilePanelUserId); // 个人信息面板内就地刷新（内部 seq 守卫丢弃在途旧响应）
    } else if (state.page === 'admin-reviews') {
      loadAdminReviews();
    }
  } catch (err) {
    showToast(err.message);
  }
}

// 模块级状态登出复位：profilePanelUserId 置空 + 评价弹窗回填态清空。
// 注意不 reset profilePanelSeq —— closeProfilePanel 靠它作废旧在途异步，登出流程会调 closeProfilePanel。
registerLogoutReset(() => { profilePanelUserId = null; state.myReviewOnModal = null; });
