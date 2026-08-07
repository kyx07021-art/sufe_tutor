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
    // 科目名数组 join '、'（空数组 join 天然返 ''）
    subjectNames(ids) {
      return (ids || []).map(id => D.subjectName(id)).join('、');
    },
    genderName(id) { return enumName(C().GENDERS, id, ''); },
    // R2-11 需求侧学生性别展示：'' = 不愿透露（默认）与历史 'nonbinary'（需求表单已无此选项）一律视同未填、
    // 不展示文字（卡上 .filter(Boolean) 自然省略）；教师侧性别 GENDERS 沿用不变，仍走 genderName
    demandStudentGenderName(id) {
      return (id === 'nonbinary' || !id) ? '' : D.genderName(id);
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

    // 需求下拉选项文本（需求四·第2/3条：发起签约 / 起草合同下拉单源复用）：
    //   #编号 · 目标名（科目/非学科项目） · 预算区间
    //   预算仅当 min/max 任一 > 0 时展示（默认 0 的需求不凑数）；纯函数返回明文，转义由调用方 escHtml
    demandOptionText(d) {
      const u = UI();
      const id = String(d.display_id || d.id).padStart(4, '0');
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
