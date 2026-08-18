/**
 * v2 tour scripts (port of v1 app-onboard.js TOUR_SCRIPTS).
 *
 * Each module is introduced by >=3 interactive steps (walk deep, not shallow).
 * v2 selector mapping (v1 -> v2):
 *   #demands-list       -> #browse-demands-list
 *   #teachers-list      -> #browse-teachers-list
 *   #conv-list/#chat-pane -> #my-chats-list/#chat-frame
 *   #filter-subject     -> REMOVED (v2 teacher filter panel is empty; teacher-parity batch pending)
 *   .profile-panel-close -> closeModal (v2 profile opens as a modal)
 *   edit-profile module -> REMOVED (v2 has no edit-profile page; chsi steps removed with it)
 *   admin awards/content -> REMOVED (v2 admin-stats is the only admin page; JSON-dump stub pending admin parity)
 * Comment/selector sources are registered pages + renderers, never arbitrary input.
 */
import { TEXT } from './text.js';
import { _tourDemoChatEnsure, _tourDemoContractEnsure } from './engine.js';

// ---- demand hall (teacher view) ----
const tourStepBrowseDemands = () => ({ module: 'browse-demands', target: { page: 'browse-demands' }, text: TEXT.TOUR_STEP_BROWSE_DEMANDS });
const tourStepDemandList = () => ({ module: 'browse-demands', target: { sel: '#browse-demands-list' }, text: TEXT.TOUR_STEP_DEMAND_LIST });
const tourStepDemandCard = (module = 'browse-demands') => ({ module, target: { sel: module === 'my-demands' ? '#my-demands-list .list-card--demand' : '#browse-demands-list .list-card--demand' }, text: TEXT.TOUR_STEP_DEMAND_CARD });
// Card click opens the detail modal — add a detail step + close step so the detail
// page never sits under the dim layer.
const tourStepDemandDetail = (module = 'browse-demands') => ({ module, target: { sel: '.modal .demand-detail' }, text: TEXT.TOUR_STEP_DEMAND_DETAIL });
const tourStepDemandDetailClose = (module = 'browse-demands') => ({ module, target: { closeModal: true }, text: TEXT.TOUR_STEP_DEMAND_DETAIL_CLOSE });
// Intent submit is a real POST — intercept, only explain.
const tourStepDemandIntentBtn = () => ({ module: 'browse-demands', target: { sel: '#browse-demands-list .btn-intent-cta' }, text: TEXT.TOUR_STEP_DEMAND_INTENT_BTN, pass: false });
const tourStepDemandIdTag = () => ({ module: 'browse-demands', target: { sel: '#browse-demands-list .demand-id-tag' }, text: TEXT.TOUR_STEP_DEMAND_ID_TAG });

// ---- browse teachers (teacher peers / student plaza) ----
const tourStepBrowseTeachers = () => ({ module: 'browse-teachers', target: { page: 'browse-teachers' }, text: TEXT.TOUR_STEP_BROWSE_TEACHERS });
const tourStepBrowseTeachersPeer = () => ({ module: 'browse-teachers', target: { page: 'browse-teachers' }, text: TEXT.TOUR_STEP_BROWSE_TEACHERS_PEER });
const tourStepTeachersList = () => ({ module: 'browse-teachers', target: { sel: '#browse-teachers-list' }, text: TEXT.TOUR_STEP_TEACHERS_LIST });
const tourStepFilterToggle = () => ({ module: 'browse-teachers', target: { sel: '#filter-toggle-btn' }, text: TEXT.TOUR_STEP_FILTER_TOGGLE });
// Clickability lives on the whole card (data-action teacher.openProfile) — highlight the card.
const tourStepTeacherUsername = () => ({ module: 'browse-teachers', target: { sel: '#browse-teachers-list .list-card--teacher' }, text: TEXT.TOUR_STEP_TEACHER_USERNAME });
// v2 profile opens as a modal — close via the engine's closeModal step.
const tourStepProfileClose = () => ({ module: 'browse-teachers', target: { closeModal: true }, text: TEXT.TOUR_STEP_PROFILE_CLOSE });
const tourStepTeacherPushBtn = () => ({ module: 'browse-teachers', target: { sel: '#browse-teachers-list .tc-push-btn' }, text: TEXT.TOUR_STEP_TEACHER_PUSH_BTN });
const tourStepPushModal = () => ({ module: 'browse-teachers', target: { closeModal: true }, text: TEXT.TOUR_STEP_PUSH_MODAL });

// ---- resource share (teacher) ----
const tourStepResourceShare = () => ({ module: 'resource-share', target: { page: 'resource-share' }, text: TEXT.TOUR_STEP_RESOURCE_SHARE });
const tourStepPostsList = () => ({ module: 'resource-share', target: { sel: '#posts-list' }, text: TEXT.TOUR_STEP_POSTS_LIST });
const tourStepPostsSearch = () => ({ module: 'resource-share', target: { sel: '#posts-search' }, text: TEXT.TOUR_STEP_POSTS_SEARCH });
const tourStepPostsSort = () => ({ module: 'resource-share', target: { sel: '#posts-sort' }, text: TEXT.TOUR_STEP_POSTS_SORT });
const tourStepPostsCreate = () => ({ module: 'resource-share', target: { sel: '#posts-content .posts-create-btn' }, text: TEXT.TOUR_STEP_POSTS_CREATE });
const tourStepPostsModal = () => ({ module: 'resource-share', target: { closeModal: true }, text: TEXT.TOUR_STEP_POSTS_MODAL });

// ---- my chats ----
// Demo conversation: fresh accounts have none, so the tour injects one while active
// (removed on cleanup). The injection is lazy/polling — the page switch must happen
// first (conv list renders after loadConversations resolves).
const tourStepMyChats = () => { _tourDemoChatEnsure(); return { module: 'my-chats', target: { page: 'my-chats' }, text: TEXT.TOUR_STEP_MY_CHATS }; };
const tourStepConvItem = () => () => { _tourDemoChatEnsure(); return { module: 'my-chats', target: { sel: '#my-chats-list .conv-item' }, text: TEXT.TOUR_STEP_CONV_ITEM }; };
const tourStepChatMessages = () => ({ module: 'my-chats', target: { sel: '#chat-messages' }, text: TEXT.TOUR_STEP_CHAT_MESSAGES });
const tourStepChatSend = () => ({ module: 'my-chats', target: { sel: '#chat-send-btn' }, text: TEXT.TOUR_STEP_CHAT_SEND });
const tourStepChatPlus = () => ({ module: 'my-chats', target: { sel: '.chat-plus-btn' }, text: TEXT.TOUR_STEP_CHAT_PLUS });
// The + pop items would fire real requests / file pickers — intercept every one.
const tourStepChatPlusItem = (i, text) => ({ module: 'my-chats', target: { sel: `.chat-plus-pop .chat-pop-item:nth-child(${i})` }, text, pass: false });
const tourStepChatPlusImage = () => tourStepChatPlusItem(1, TEXT.TOUR_STEP_CHAT_PLUS_IMAGE);
const tourStepChatPlusFile = () => tourStepChatPlusItem(2, TEXT.TOUR_STEP_CHAT_PLUS_FILE);
const tourStepChatPlusSigning = () => tourStepChatPlusItem(3, TEXT.TOUR_STEP_CHAT_PLUS_SIGNING);
const tourStepChatPlusDraft = () => tourStepChatPlusItem(4, TEXT.TOUR_STEP_CHAT_PLUS_DRAFT);

// ---- my contracts ----
// Demo contract: same idea — inject one to introduce the contract card while active.
const tourStepMyContracts = () => ({ module: 'my-contracts', target: { page: 'my-contracts' }, text: TEXT.TOUR_STEP_MY_CONTRACTS });
const tourStepContractsList = () => ({ module: 'my-contracts', target: { sel: '#my-contracts-list' }, text: TEXT.TOUR_STEP_CONTRACTS_LIST });
const tourStepContractCard = () => () => { _tourDemoContractEnsure(); return { module: 'my-contracts', target: { sel: '#my-contracts-list .list-card' }, text: TEXT.TOUR_STEP_CONTRACT_CARD }; };
const tourStepContractActions = () => ({ module: 'my-contracts', target: { sel: '#my-contracts-list .contract-actions' }, text: TEXT.TOUR_STEP_CONTRACT_ACTIONS });

// ---- notifications ----
const tourStepNotifications = () => ({ module: 'notifications', target: { page: 'notifications' }, text: TEXT.TOUR_STEP_NOTIFICATIONS });
const tourStepNotifList = () => ({ module: 'notifications', target: { sel: '#notifications-content' }, text: TEXT.TOUR_STEP_NOTIF_LIST });
const tourStepNotifItem = () => ({ module: 'notifications', target: { sel: '.notif-item' }, text: TEXT.TOUR_STEP_NOTIF_ITEM });
// Notif block is a real preference + request — intercept.
const tourStepNotifBlock = () => ({ module: 'notifications', target: { sel: '#btn-notif-block' }, text: TEXT.TOUR_STEP_NOTIF_BLOCK, pass: false });

// ---- settings ----
const tourStepAccountSettings = () => ({ module: 'account-settings', target: { page: 'account-settings' }, text: TEXT.TOUR_STEP_ACCOUNT_SETTINGS });
const tourStepSettingsAccount = () => ({ module: 'account-settings', target: { sel: '.settings-row--avatar' }, text: TEXT.TOUR_STEP_SETTINGS_ACCOUNT });
const tourStepSettingsTheme = () => ({ module: 'account-settings', target: { sel: '.theme-opt' }, text: TEXT.TOUR_STEP_SETTINGS_THEME });
const tourStepSettingsUiScale = () => ({ module: 'account-settings', target: { sel: '.ui-scale-slider' }, text: TEXT.TOUR_STEP_SETTINGS_UI_SCALE });
const tourStepSettingsLogout = () => ({ module: 'account-settings', target: { sel: '.settings-logout' }, text: TEXT.TOUR_STEP_SETTINGS_LOGOUT });
const tourStepSettingsLogoutModal = () => ({ module: 'account-settings', target: { closeModal: true }, text: TEXT.TOUR_STEP_SETTINGS_LOGOUT_MODAL });

// ---- about ----
const tourStepAbout = () => ({ module: 'about', target: { page: 'about' }, text: TEXT.TOUR_STEP_ABOUT });
const tourStepAboutWho = () => ({ module: 'about', target: { sel: '.about-card' }, text: TEXT.TOUR_STEP_ABOUT_WHO });
const tourStepAboutFlow = () => ({ module: 'about', target: { sel: '.about-flow' }, text: TEXT.TOUR_STEP_ABOUT_FLOW });
const tourStepAboutSecurity = () => ({ module: 'about', target: { sel: '.about-security-list' }, text: TEXT.TOUR_STEP_ABOUT_SECURITY });
const tourStepAboutFeedback = () => ({ module: 'about', target: { sel: '.about-feedback-btns' }, text: TEXT.TOUR_STEP_ABOUT_FEEDBACK });

// ---- my demands (student) ----
const tourStepMyDemands = () => ({ module: 'my-demands', target: { page: 'my-demands' }, text: TEXT.TOUR_STEP_MY_DEMANDS });
const tourStepMyDemandsList = () => ({ module: 'my-demands', target: { sel: '#my-demands-list' }, text: TEXT.TOUR_STEP_MY_DEMANDS_LIST });
const tourStepIntentToggle = () => ({ module: 'my-demands', target: { sel: '#my-demands-list .btn-intent-toggle' }, text: TEXT.TOUR_STEP_INTENT_TOGGLE });
const tourStepNewDemandBtn = () => ({ module: 'my-demands', target: { sel: '#btn-new-demand' }, text: TEXT.TOUR_STEP_NEW_DEMAND_BTN });
const tourStepDemandWizard = () => ({ module: 'my-demands', target: { sel: '#demand-form .dw-step' }, text: TEXT.TOUR_STEP_DEMAND_WIZARD });
const tourStepNewDemandModal = () => ({ module: 'my-demands', target: { closeModal: true }, text: TEXT.TOUR_STEP_NEW_DEMAND_MODAL });

// ---- final steps (module 'end', not counted) ----
const tourStepGuestLogin = () => ({ module: 'end', target: { self: true }, text: TEXT.TOUR_STEP_GUEST_LOGIN });
const tourStepUserBar = () => ({ module: 'end', target: { self: true }, text: TEXT.TOUR_STEP_USER_BAR });

// ---- admin (v2: single admin-stats page, JSON-dump stub until admin parity) ----
const tourStepAdminStats = () => ({ module: 'admin-stats', target: { page: 'admin-stats' }, text: TEXT.TOUR_STEP_ADMIN_STATS });
const tourStepAdminData = () => ({ module: 'admin-stats', target: { sel: '#admin-stats-box' }, text: TEXT.TOUR_STEP_ADMIN_DATA });
const tourStepAdminEnd = () => ({ module: 'end', target: { self: true }, text: TEXT.TOUR_STEP_ADMIN_END });

export const TOUR_SCRIPTS = {
  // Admin: moderation console (single page in v2)
  admin: () => [
    tourStepAdminStats(),
    tourStepAdminData(),
    tourStepAdminEnd(),
  ],
  // Teacher before login: accessible areas (demand hall / teacher peers / resource
  // share / about) + final step to login
  teacherGuest: () => [
    tourStepBrowseDemands(),
    tourStepDemandList(),
    tourStepDemandCard(),
    tourStepDemandDetail(),
    tourStepDemandDetailClose(),
    tourStepDemandIdTag(),
    tourStepBrowseTeachersPeer(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepResourceShare(),
    tourStepPostsList(),
    tourStepPostsSearch(),
    tourStepPostsSort(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepGuestLogin(),
  ],
  // Student before login: teacher plaza / about + final step to login
  studentGuest: () => [
    tourStepBrowseTeachers(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepGuestLogin(),
  ],
  // Teacher logged in: every module, walked deep + final user bar
  teacherUser: () => [
    tourStepBrowseDemands(),
    tourStepDemandList(),
    tourStepDemandCard(),
    tourStepDemandDetail(),
    tourStepDemandDetailClose(),
    tourStepDemandIntentBtn(),
    tourStepDemandIdTag(),
    tourStepBrowseTeachersPeer(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepResourceShare(),
    tourStepPostsList(),
    tourStepPostsSearch(),
    tourStepPostsSort(),
    tourStepPostsCreate(),
    tourStepPostsModal(),
    tourStepMyChats(),
    tourStepConvItem(),
    tourStepChatMessages(),
    tourStepChatSend(),
    tourStepChatPlus(),
    tourStepChatPlusImage(),
    tourStepChatPlusFile(),
    tourStepChatPlusSigning(),
    tourStepChatPlusDraft(),
    tourStepMyContracts(),
    tourStepContractsList(),
    tourStepContractCard(),
    tourStepContractActions(),
    tourStepNotifications(),
    tourStepNotifList(),
    tourStepNotifItem(),
    tourStepNotifBlock(),
    tourStepAccountSettings(),
    tourStepSettingsAccount(),
    tourStepSettingsTheme(),
    tourStepSettingsUiScale(),
    tourStepSettingsLogout(),
    tourStepSettingsLogoutModal(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepUserBar(),
  ],
  // Student logged in: my demands (walk the create form) -> teacher plaza (push) ->
  // remaining modules + final user bar
  studentUser: () => [
    tourStepMyDemands(),
    tourStepMyDemandsList(),
    tourStepDemandCard('my-demands'),
    tourStepDemandDetail('my-demands'),
    tourStepDemandDetailClose('my-demands'),
    tourStepIntentToggle(),
    tourStepNewDemandBtn(),
    tourStepDemandWizard(),
    tourStepNewDemandModal(),
    tourStepBrowseTeachers(),
    tourStepTeachersList(),
    tourStepFilterToggle(),
    tourStepTeacherUsername(),
    tourStepProfileClose(),
    tourStepTeacherPushBtn(),
    tourStepPushModal(),
    tourStepMyChats(),
    tourStepConvItem(),
    tourStepChatMessages(),
    tourStepChatSend(),
    tourStepChatPlus(),
    tourStepChatPlusImage(),
    tourStepChatPlusFile(),
    tourStepChatPlusSigning(),
    tourStepChatPlusDraft(),
    tourStepMyContracts(),
    tourStepContractsList(),
    tourStepContractCard(),
    tourStepContractActions(),
    tourStepNotifications(),
    tourStepNotifList(),
    tourStepNotifItem(),
    tourStepNotifBlock(),
    tourStepAccountSettings(),
    tourStepSettingsAccount(),
    tourStepSettingsTheme(),
    tourStepSettingsUiScale(),
    tourStepSettingsLogout(),
    tourStepSettingsLogoutModal(),
    tourStepAbout(),
    tourStepAboutWho(),
    tourStepAboutFlow(),
    tourStepAboutSecurity(),
    tourStepAboutFeedback(),
    tourStepUserBar(),
  ],
};
