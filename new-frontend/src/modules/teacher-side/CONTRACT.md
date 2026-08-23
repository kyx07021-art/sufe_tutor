# M9 teacher-side module contract (2026-08-22)

> Module lead contract: pins every base unit to an exact file path + exported interface + dependencies.
> **STATUS: all 24 base units DONE (2026-08-22).** smoke-teacher-side.mjs 12/12 green (incl. 7 acceptance
> boundary mutation guards); app build green; production build of the module graph green. Not committed.
> File-level isolation: sub-agents write ONLY their owned files (columns below). No cross-file edits.
> Cross-module shared components land in `src/components/shared/` (M0 thaw: first consumer builds, M7/M8 consume later).

## Data contracts (interfaces.md §19)

- I-34 `GET /api/demands?sort=match|price&order=asc|desc&filters={subjects[],gender,priceMin,priceMax}` login
  → `{ items: [{ id, user_id, subject, targetType, grade, province, teachingMethod, currentScore, currentScoreFull, addressArea, expectedTime, preferredTags, preferredGender, budgetMin, budgetMax, additionalInfo, status, createdAt, studentName, studentAvatar, matchScore, matchCount }], total }`
- I-39 `GET /api/teacher/profile` login+teacher → full own profile (teacher_name/experienceYears/wechat/email/real_name/credential_image/subjects/bio/province/address/priceMin/priceMax/timeSlots/personalityTags/teaching_method/gender/graduation_year)
- I-40 `PUT /api/teacher/profile` login+teacher → **camelCase full field set** (PA-1d-F4): province(required)/teacherName/bio/addressArea/teachingMethod/priceMin/priceMax/experienceYears/gender/graduationYear/timeSlots/personalityTags/subjects[{subject,score}]/philosophy, wrapped `{ profile }`; partial omit = keep old; teacherName editable; experienceYears non-neg int clamp
- I-41 `POST /api/teacher/verify-chsi{code:/^[A-Za-z0-9]{12,16}$/}` → `{ok,status:'pending',provider}` (approved 409)
- I-42 `POST /api/teacher/verify-admission{image:dataURL}` → jpeg/png/webp magic bytes/≤CREDENTIAL_MAX_BYTES/svg reject
- I-43 `GET /api/teacher/verify-status` → `{status:'none'|'pending'|'approved'|'rejected',provider?,verifyType?}` (rejected re-submit ok)
- I-11 avatar = `PUT /api/settings{avatar:dataURL}` (front-end pre-cropped max circle)

## 24 base-unit ownership map (M9.md v3)

| # | name | file (owner) | exported interface |
|---|---|---|---|
| B1-1a | 页面注册 | `B1/pages.js`(ME, part of `pages.js`) | registerPage B1 |
| B1-1b | 网格布局 | `B1/TeacherDemandGrid.vue`(ME) | `<TeacherDemandGrid :items slot#card>` 4col/2col |
| B1-2a | 数据加载+映射 | `B1/demands-model.js`+`demands-service.js`(ME) | mapDemandItem / loadDemands / empty+error |
| B1-2b | 入场动效 | `B1/entry-reveal.js`(SA1) | useEntryReveal(el) |
| B1-3a | 排序选项卡+偏好 | `shared/SortBar.vue`(ME)+`B1/sort-state.js`(SA1) | SortBar props/emits / loadSortState |
| B1-3b | 升降序圆钮+SVG | `shared/OrderToggle.vue`(ME, promoted from SA1) | `<OrderToggle :order>` single source M7/M9 |
| B1-4 | 筛选揭示动效 | `B1/FilterReveal.vue`(SA1) | open/close + card area shift |
| B1-5a | 科目筛选卡 | `B1/FilterSubject.vue`(SA1) | v-model subjects[] |
| B1-5b | 性别筛选卡 | `B1/FilterGender.vue`(SA1) | v-model gender |
| B1-5c | 报价区间筛选卡 | `B1/FilterPrice.vue`(SA1) | v-model priceMin/priceMax |
| B1-5d1 | 命中分组纯函数 | `shared/useMatchGroup.js`(ME) | matchGroup/computeMatchCount/filterItems |
| B1-5d2 | 筛选即时应用+重播 | `B1/TeacherDemandPlaza.vue`(ME) | local re-render + re-anim |
| B1-5d3 | 筛选重置 | `B1/sort-state.js`(SA1) | resetFilters |
| B1-6 | 需求卡片渲染 | `B1/TeacherDemandPlaza.vue` slot (ME) | consumes M8 shared `DemandCard(mode='teacher')` + match badge wrapper |
| B1-7 | 卡片点击→会话 | `B1/card-action.js`(ME) | openConversationFromDemand |
| B2-1a | 页面注册 | `B2/pages.js`(part of `pages.js`) | registerPage B2 |
| B2-1b | 核验门四态 | `B2/VerifyGate.vue`(SA2) | 4-state from I-43 |
| B2-2a | chsi 提交通道 | `B2/VerifyChsi.vue`(SA2) | pre-check+POST |
| B2-2b | 录取通知书上传 | `B2/VerifyAdmission.vue`(SA2) | label-for+type pre-check+POST |
| B2-3 | 详情卡转编辑态 | `B2/ProfileEditCard.vue`(SA3) | I-39 prefilled edit card |
| B2-4 | 科目+成绩/奖项/理念 | `B2/SubjectEditor.vue`(SA3) | complex structured editor |
| B2-5 | 保存写路径 | `B2/profile-service.js`(SA3) | collect/validate/POST/read-back/invalidate |
| B2-6 | 头像上传裁切 | `B2/AvatarEditor.vue`(SA3)+`shared/useAvatarCrop.js`(ME) | confirm modal + crop + I-11 |
| B3-1 | 资料广场占位 | `B3/ResourcePlaza.vue`(ME) | placeholder gray text |

Owners: ME = module lead, SA1/SA2/SA3 = parallel sub-agents. Sub-agents must not edit files outside their ownership.
All rows are DONE; SA3 files (ProfileEditCard/SubjectEditor/profile-service/AvatarEditor) were completed by the
module lead after the SA3 session was interrupted mid-write.

## Cross-module reconciliation notes (report to coordinator)

- `src/components/shared/SortBar.vue` + `useMatchGroup.js` built by M9 as FIRST CONSUMER (M9.md rule 2).
  M7 teacher-square already consumes them (SecondBar.vue imports SortBar; match-dimensions.js uses useMatchGroup);
  interface matches M7's CONTRACT.md exactly (options[{key,label}]/modelValue + select/update:modelValue; and
  `matchGroup(items,filters,dimensions,sortBy)` → `[{count,items}]`). Single source confirmed.
- M8 shared `DemandCard(mode='teacher')` at `src/modules/my-demands/DemandCard.vue` consumed by B1-6 directly;
  matchScore/matchCount badges wrapped at the page slot (M8 card does not render them). Temp `DemandCardTeacher.vue` deleted (W18).
- `useAvatarCrop.js` = M5-09b / M9-B2-6 shared (built by ME); pure geometry node-testable.
- **fetch single point**: all M9 services use `@/core/api.js` `api()` (AUTH_TOKEN_KEY='authToken'). The earlier
  SA2 note about 'auth:token' is obsolete — reconciled.
- Subject list `SUBJECT_OPTIONS` in m-teacher-side.js pending backend SUBJECTS enum (S3/S4) — coordinator to reconcile
  against the single-source subject list when the backend contract lands.
- Save write path (B2-5) invalidate seam: MyInfo.onSave does read-back refresh (F7); the cache-invalidate call is a
  documented TEMPORARY seam pending core/datahub (M2). Coordinator wires `invalidate('teachers')` when datahub lands.

## Acceptance boundary mutation guards (M9.md §2) — where locked
① matchScore sort → demands-model compareBySort + browser match badge '95' assert
② mid-price sort → demands-model midPrice/compareBySort pure asserts (nulls last)
③ matchCount grouping → useMatchGroup pure asserts (groups desc, zero-hit excluded)
④ filter immediate apply + re-anim → browser filter test (4 cards after 数学 select + reset to 8 +
   B1-4 mask tap dismiss); re-anim = deep watch on filters -> replay() (animateKey remount)
⑤ D3 teacher-name → B2 edit-card prefill assert ('王老师')
⑥ save write-path → B2 browser test (validation blocks empty name + empty province; PUT posts
   I-40 camelCase province/teacherName/experienceYears/graduationYear/subjects[{subject,score}],
   no avatar, + read-back GET increments + dhInvalidate('teachers') after save); pure
   normalizeProfile/buildSaveBody unit guards lock the I-39->edit and edit->I-40 mappings
⑦ avatar max-circle geometry → useAvatarCrop pure asserts (800x600 → {cx:400,cy:300,r:300})

## Audit round (2026-08-22) — 3 independent read-only agents, findings closed
- 1101-1 I-40 field names: saveProfile sends the frozen I-40 camelCase field set per
  interfaces.md §19 (PA-1d-F4: province required from region; graduationYear; subjects collapsed
  to { subject, score }); avatar removed from I-40 payload (I-11 separate).
- Contract 6: 6 hardcoded Chinese placeholders -> TEACHER_COPY keys; 4 Chinese comments -> English;
  zero-Chinese lock test added (smoke).
- B1-5d2 re-anim: dead `onFilterChange` removed; deep watch on filters -> replay() (was: list updated
  but animation never replayed).
- B1-4 mask: click-catcher over card area added + tap-dismiss test (was missing from M9.md acceptance).
- matchCount badge semantics: card badge now shows client-computed active-dim hits (consistent with
  group header), hidden when no filters active; server matchCount no longer displayed contradictorily.
- B1-3a preference: sort-state persistence lock test added (localStorage round-trip + corrupt/illegal fallback).
- OrderToggle promoted to `src/components/shared/OrderToggle.vue` (single source M7/M9; M7 re-point pending).
- VerifyAdmission reduced-motion added; VerifyGate unknown-status fallback + service whitelist clamp;
  AvatarEditor watches props.src + modal buttons stack on narrow (375); dead copy keys removed.
- Cross-module notes: F1 RESOLVED (M5 SettingsAvatar now consumes the shared useAvatarCrop ->
  cropAvatar(file, { size: 512 }) same as AvatarEditor, 512x512 square, A1 satisfied; smoke-notifications
  mutation guard locks the crop pipeline). SortBar double-emit (update:modelValue + select) is a COORDINATOR
  item (M7/shared contract).
