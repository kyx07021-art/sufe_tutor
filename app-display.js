/**
 * 统一显示层（纯函数）——消灭散落在各模块的重复展示逻辑
 *
 * 加载序：constants.js → region-data.js → app-display.js → 共享层/领域层/壳（见 index.html）
 * 依赖 globalThis.APP_CONSTANTS（SUBJECTS/GENDERS/TEACHER_GRADES/TEACHING_METHODS/UI）
 * 与 globalThis.SUFE_REGIONS——两者均在本文件之前加载；函数内取用（不在顶层解构，防加载序脆弱）。
 *
 * 约定：全部纯函数、无副作用，返回字符串或基本类型；不改 DOM、不发请求。
 * 挂载风格同 region-data.js：IIFE + globalThis 赋值，浏览器经典脚本与 worker 两用。
 */
(function () {
  // HTML 转义（与 app-ui.js escHtml 同语义：&<>"' 五字符），本文件自持，不依赖 app-ui
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function C() { return globalThis.APP_CONSTANTS || {}; }
  function UI() { return C().UI || {}; }

  // 枚举查名通用件：list 里找 id 命中项取 name，查无返 fallback
  function enumName(list, id, fallback) {
    const hit = (list || []).find(x => x.id === id);
    return hit ? hit.name : fallback;
  }

  const D = {
    // 科目名：SUBJECTS 命中优先；查无兜底 region-data subjectNames（浙江技术等小众选科——不在全局
    // SUBJECTS 池但教师/学生科目池会按省份注入）；再无返 sid 本身
    subjectName(sid) {
      const hit = enumName(C().SUBJECTS, sid, null);
      if (hit !== null) return hit;
      const R = globalThis.SUFE_REGIONS;
      return (R && R.subjectNames && R.subjectNames[sid]) || sid;
    },
    // 性别显示单点：不愿透露（undeclared）与历史 ''/nonbinary 一律视同未填 → 不展示文字
    // （资料卡/详情/筛选 .filter(Boolean) 自然省略该行）；仅明确男/女才出字。
    genderName(id) {
      if (!id || id === 'undeclared' || id === 'nonbinary') return '';
      return enumName(C().GENDERS, id, '');
    },
    // R2-11 需求侧学生性别展示：与教师侧同一口径（'' = 不愿透露 默认、'undeclared'/'nonbinary' 历史值）
    demandStudentGenderName(id) {
      return D.genderName(id);
    },
    teacherGradeName(id) { return enumName(C().TEACHER_GRADES, id, ''); },
    methodName(id) { return enumName(C().TEACHING_METHODS, id, ''); },
    personalityTagName(id) { return enumName(C().PERSONALITY_TAGS, id, ''); }, // R2-3 性格关键词名
    nonacademicProjectName(id) { return enumName(C().NONACADEMIC_PROJECTS, id, ''); }, // R2-4 非学科项目名
    // R2-12 毕业年份展示：非空年份 → 「xxx年」，null/空 → ''（资料卡条目动态加载渲染层判断，单点映射防内联拼接）
    graduationYearText(year) {
      return (year != null && year !== '') ? `${year}${(C().UI || {}).GRAD_YEAR_SUFFIX || '年'}` : '';
    },

    // R2-b 需求目标名按类型分流单点映射（需求卡/推送列表/管理端统计/合同流共用，消灭散落三元）：
    //   academic → SUBJECTS 科目名；nonacademic → NONACADEMIC_PROJECTS 项目名；未知 id 查无返 ''
    demandTargetName(id, type) {
      return type === (C().DEMAND_TYPES || {}).NONACADEMIC ? D.nonacademicProjectName(id) : D.subjectName(id);
    },
    demandTargetNameList(ids, type) {
      return (ids || []).map(id => D.demandTargetName(id, type)).filter(Boolean);
    },
    demandTargetNames(ids, type) {
      return D.demandTargetNameList(ids, type).join('、');
    },

    // R2-5 报价区间展示（教师卡/资料卡/意向行复用）：min==max 折叠为单值（存量单报价迁移与固定价
    // 都显示「150元/h」而非「150~150元/h」）；只有 min → min元/h起；只有 max → 至max元/h；都没值 → ''
    priceRangeText(min, max, unitSuffix) {
      const unit = unitSuffix || '';
      const hasMin = min != null && min !== '';
      const hasMax = max != null && max !== '';
      if (hasMin && hasMax) return min === max ? `${min}${unit}` : `${min}~${max}${unit}`;
      if (hasMin) return `${min}${unit}起`;
      if (hasMax) return `至${max}${unit}`;
      return '';
    },

    // 省名：包掉全站防御式 `typeof SUFE_REGIONS !== 'undefined'` 探测
    provinceName(code) {
      const R = globalThis.SUFE_REGIONS;
      return (R && code) ? R.provinceName(code) : '';
    },

    // 角色显示名：student/teacher/admin → UI 文案（包掉散落三元）
    roleLabel(role) {
      const u = UI();
      return role === 'student' ? u.ROLE_STUDENT : role === 'teacher' ? u.ROLE_TEACHER : u.ADMIN_BADGE;
    },

    // 星级：5 颗星 span.star.filled，rating 缺省按 4
    starsHtml(rating) {
      const r = rating || 4;
      let html = '<span class="stars">';
      for (let i = 1; i <= 5; i++) {
        html += `<span class="star ${i <= Math.round(r) ? 'filled' : ''}">★</span>`;
      }
      return html + '</span>';
    },
    // 评分文本：缺省按 4，一位小数（消灭散落的 ||4）
    ratingText(rating) {
      return (rating || 4).toFixed(1);
    },

    // 需求「活跃」统一谓词（用户反馈 2026-08-08）：业务逻辑判断需求可否操作（主动推送/收意向/发起签约）
    // 一律走这里，取代散落的状态字面量比较。active == status==='open'——contracted（已签约成交）与
    // revoked（已撤销未重开）均非活跃。需求对象（服务端 mapDemandRow 出口）或纯 status 值都可传入。
    demandIsActive(d) {
      const status = typeof d === 'string' ? d : (d && d.status);
      return status === (C().STATUS || {}).OPEN;
    },

    // 需求下拉选项文本（需求四·第2/3条：发起签约 / 起草合同下拉单源复用）：
    //   #编号 · 目标名（科目/非学科项目） · 预算区间
    //   预算仅当 min/max 任一 > 0 时展示（默认 0 的需求不凑数）；纯函数返回明文，转义由调用方 escHtml
    demandOptionText(d) {
      const u = UI();
      const id = String(d.display_id || d.id).padStart((C().CONFIG || {}).DISPLAY_ID_PAD || 4, '0');
      const name = D.demandTargetNames(d.target_subjects, d.target_type) || '—';
      const hasBudget = (d.budget_min > 0) || (d.budget_max > 0);
      const price = hasBudget ? D.priceRangeText(d.budget_min, d.budget_max, u.PRICE_UNIT) : '';
      return ['#' + id, name, price].filter(Boolean).join(' · ');
    },

    // 需求 current_scores 单项展示：
    //   等第制（cs.grade 或 cs.mode==='grade'）→ "科目: 等第"（无 grade 返 ''）
    //   分数制 → "科目: 分数分/满分分制"；空值返 ''
    demandScoreCell(cs) {
      const u = UI();
      const n = D.subjectName(cs.subject);
      if (cs.grade || cs.mode === 'grade') return cs.grade ? `${n}: ${cs.grade}` : '';
      if (cs.score !== '' && cs.score != null) return `${n}: ${cs.score}${u.SCORE_UNIT}/${cs.scale}${u.SCORE_SCALE_SUFFIX}`;
      return '';
    },

    // 教师高考分单项：不带 scale（满分由省份赋分组件定、行数据本就不存），与教师卡 info2/面板同口径
    gaokaoCell(gs) {
      return gs.score != null ? String(gs.score) : (gs.grade || '');
    },

    // 期望开课时间显示（v0.25.0 结构化时间组件）：库内存 JSON 数组
    // [{type:'week',dow:1..7,start:'HH:MM',end:'HH:MM'}]，解析为「周一 18:00-20:00」逗号列表；
    // 旧数据（纯文本）原样透传。未来扩展 type（如月日 + 时间）时在此按类型分支展开。
    expectedTimeText(raw) {
      if (!raw) return '';
      let arr = null;
      try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch { arr = null; }
      if (!arr) return String(raw); // 非 JSON = 历史纯文本，原样展示
      const days = (globalThis.APP_CONSTANTS && globalThis.APP_CONSTANTS.WEEKDAYS) || [];
      const texts = arr
        .filter(s => s && typeof s === 'object' && s.type === 'week')
        .map(s => {
          const day = (days.find(d => d.id === s.dow) || {}).name || '';
          const range = (typeof s.start === 'string' && typeof s.end === 'string') ? `${s.start}-${s.end}` : '';
          return [day, range].filter(Boolean).join(' ');
        }).filter(Boolean);
      return texts.join('、');
    },

    // 审核状态三色 tag；其他状态返 ''
    reviewStatusTagHtml(status) {
      const u = UI();
      if (status === 'approved') return `<span class="tag tag-ok">${u.STATUS_APPROVED}</span>`;
      if (status === 'rejected') return `<span class="tag tag-danger">${u.STATUS_REJECTED}</span>`;
      if (status === 'pending') return `<span class="tag tag-warn">${u.STATUS_PENDING}</span>`;
      return '';
    },

    // 用户名墓碑渲染：注销用户前缀 → 灰斜体 span，否则普通转义
    usernameHtml(name) {
      const s = String(name || '');
      return s.startsWith(UI().DEACTIVATED_USER_PREFIX)
        ? `<span class="username-deactivated">${esc(s)}</span>` : esc(s);
    },

    // v0.25.42（注销幽灵数据）：对端姓名是否已注销（墓碑前缀命中）
    isDeactivated(name) {
      return String(name || '').startsWith(UI().DEACTIVATED_USER_PREFIX);
    },

    // v0.25.42：涉事双方数据（会话/需求/合同/评价等）的对端姓名旁追加「一方已注销」tag——
    // 对方已注销但数据仍保留的场景，明确告知本端对方账户状态。非注销返 ''
    deactivatedTag(name) {
      return D.isDeactivated(name) ? `<span class="tag-deactivated">${esc(UI().PEER_DEACTIVATED_TAG || '一方已注销')}</span>` : '';
    },

    // #165（v0.25.73）：反馈类型 → 文案（bug/投诉/建议 三分支；单源 constants）
    feedbackKindName(kind) {
      const u = UI();
      if (kind === 'bug') return u.FEEDBACK_TAG_BUG;
      if (kind === 'complaint') return u.FEEDBACK_TAG_COMPLAINT;
      return u.FEEDBACK_TAG_SUGGEST;
    },

    // #165（v0.25.73）：投诉对象 → 文案；非投诉恒 ''（subject 服务端已白名单，前端兜底防脏数据）
    feedbackSubjectName(subject) {
      const u = UI();
      if (subject === 'teacher') return u.FEEDBACK_COMPLAINT_SUBJECT_TEACHER;
      if (subject === 'student') return u.FEEDBACK_COMPLAINT_SUBJECT_STUDENT;
      if (subject === 'platform') return u.FEEDBACK_COMPLAINT_SUBJECT_PLATFORM;
      return '';
    },

    // —— A2 收口（v0.25.78）：跨模块散落的显示映射统一单点 ——

    // 学生年级 id→名：查无返 id 本身（口径统一：id 保底显示，不静默消失）；空 id 返 ''
    studentGradeName(id) {
      if (!id) return '';
      return enumName(C().STUDENT_GRADES, id, String(id));
    },
    // 需求编号文本：统一「UI.DEMAND_PREFIX#四位补零」；无编号返 ''
    demandIdText(displayId) {
      const n = Number(displayId);
      return n ? `${UI().DEMAND_PREFIX}#${String(n).padStart((C().CONFIG || {}).DISPLAY_ID_PAD || 4, '0')}` : '';
    },
    // 需求预算行：任一上下限有值 → 「下限~上限元/h」，双空 → 面议
    demandBudgetText(d) {
      return (d.budget_min || d.budget_max)
        ? `${d.budget_min || UI().BUDGET_NO_LIMIT}~${d.budget_max || UI().BUDGET_NO_LIMIT}${UI().BUDGET_UNIT_SUFFIX}`
        : UI().BUDGET_NEGOTIABLE;
    },
    // 反馈 kind→tag 类：#165 起 bug=危险 / complaint=警示 / 其余(suggestion)=强调
    feedbackKindCls(kind) {
      return kind === 'bug' ? 'tag-danger' : kind === 'complaint' ? 'tag-warn' : 'tag-accent';
    },
    // 合同状态→文案+tag 类：signed=ok / signing=warn / 其余(pending)=accent
    contractStatusMeta(status) {
      const ST = C().STATUS || {};
      if (status === ST.SIGNED) return { text: UI().CONTRACT_STATUS_SIGNED, cls: 'tag-ok' };
      if (status === ST.SIGNING) return { text: UI().CONTRACT_STATUS_SIGNING, cls: 'tag-warn' };
      return { text: UI().CONTRACT_STATUS_PENDING, cls: 'tag-accent' };
    },

    // 行级 diff（v0.24.3 合同改动高亮）：oldText/newText 按行 LCS 分类，
    // 返回 ops：[{ t: 'same'|'del'|'add', text }]。纯函数、零 DOM。
    diffLines(oldText, newText) {
      const splitLines = t => (t == null || t === '') ? [] : String(t).split('\n'); // 空文本 = 0 行（'' split 会给单空行）
      const a = splitLines(oldText);
      const b = splitLines(newText);
      const n = a.length, m = b.length;
      const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const ops = [];
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: 'same', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', text: a[i] }); i++; }
        else { ops.push({ t: 'add', text: b[j] }); j++; }
      }
      while (i < n) { ops.push({ t: 'del', text: a[i] }); i++; }
      while (j < m) { ops.push({ t: 'add', text: b[j] }); j++; }
      return ops;
    },
  };

  globalThis.SUFE_DISPLAY = D;
})();
