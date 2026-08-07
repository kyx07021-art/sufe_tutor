/**
 * 统一显示层（纯函数）——消灭散落在各模块的重复展示逻辑
 *
 * 加载序：constants.js → region-data.js → app-display.js → app.js → ...（见 index.html）
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
    // 科目名：查无返 sid 本身（对齐 app.js 旧 `SUBJECTS.find(...)?.name || id` 口径）
    subjectName(sid) {
      return enumName(C().SUBJECTS, sid, sid);
    },
    // 科目名数组 join '、'（空数组 join 天然返 ''）
    subjectNames(ids) {
      return (ids || []).map(id => D.subjectName(id)).join('、');
    },
    genderName(id) { return enumName(C().GENDERS, id, ''); },
    teacherGradeName(id) { return enumName(C().TEACHER_GRADES, id, ''); },
    methodName(id) { return enumName(C().TEACHING_METHODS, id, ''); },

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

    // 星级：5 颗星 span.star.filled，rating 缺省按 4（搬自 app.js renderStars，输出逐字一致）
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

    // 需求 current_scores 单项展示（对齐 app.js renderDemandCard scoreItems 口径）：
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

    // 审核状态三色 tag；其他状态返 ''
    reviewStatusTagHtml(status) {
      const u = UI();
      if (status === 'approved') return `<span class="tag tag-ok">${u.STATUS_APPROVED}</span>`;
      if (status === 'rejected') return `<span class="tag tag-danger">${u.STATUS_REJECTED}</span>`;
      if (status === 'pending') return `<span class="tag tag-warn">${u.STATUS_PENDING}</span>`;
      return '';
    },

    // 用户名墓碑渲染：注销用户前缀 → 灰斜体 span，否则普通转义（搬自 app.js renderUsername）
    usernameHtml(name) {
      const s = String(name || '');
      return s.startsWith(UI().DEACTIVATED_USER_PREFIX)
        ? `<span class="username-deactivated">${esc(s)}</span>` : esc(s);
    },
  };

  globalThis.SUFE_DISPLAY = D;
})();
