/**
 * 架构 v2 声明式路由表（迁移期：handler 仍指向 server/routes-*，域化在 V-1-4 完成）
 */
import { handleRegister, handleLogin, handleCheckUsername, handleAuthMe, handleSaveAvatar, handleDeactivateAccount, handleGetUserPublic, handleListSessions, handleRevokeSession, handleLogout, handleReAuth, handleOtpRequest, handleBindPhone, handleBindEmail, handleUsernameStatus, handleChangeUsername, handleLoginWithCode, handleGetMyCreds, handleCheckInvite } from '../../server/routes-auth.js';
import { handleGetProfile, handleSaveProfile, handleGetTeachers, handleVerifyChsi, handleChsiStatus, handleVerifyAdmission } from '../../server/routes-teacher.js';
import { handleGetPrivacySettings, handleSetPrivacySettings } from '../../server/routes-settings.js';
import {
  handleCreateDemand, handleGetDemands, handleUpdateDemand, handleDeleteDemand, handleReopenDemand,
  handleCreateIntent, handleGetIntents, handleResolveIntent,
  handlePushDemand, handleGetTeacherPushes, handleResolvePush,
} from '../../server/routes-demands.js';
import { handleGetNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead, handleAdminDeleteNotification } from '../../server/notify.js';
import { handleCaptchaVerify } from '../../server/human-check.js';
import {
  handleCreateContract, handleGetMyContracts,
  handleSignContract, handleModifyContract, handleCancelContract,
  handleAdminListContracts, handleAdminRemoveContract, handleVerifyContract, handleRevokeContract,
} from '../../server/contract.js';
import { handleGetConversations, handleGetMessages, handleSendMessage, handleMarkRead, handleGetAttachment, handleGetConversationBindableDemands, handleCreateUpload, handleDeleteUpload } from '../../server/routes-chat.js';
import { handleCreateReview, handleGetReviews, handleUpdateReview } from '../../server/routes-reviews.js';
import {
  handleGenInvite, handleListInvites, handleRevokeInvite, handleAdminStats, handleAdminTraffic,
  handleListVerifications, handleVerificationAction,
  handleAdminReviews, handleReviewAction, handleAdminUsers, handleBanUser,
  handleAdminDemands, handleAdminDeleteDemand, handleAdminDeleteReview, handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast,
  handleCreateFeedback, handleAdminFeedbacks, handleMyFeedbacks, handleResolveFeedback, handleAdminDeleteMessage, handleVerifyTeacher,
  handleAdminReencrypt, handleAdminDashboard,
} from '../../server/routes-admin.js';
import { handleListPosts, handleCreatePost, handleToggleLike, handleDeletePost, handleMyFavorites, handleToggleFavorite } from '../../server/routes-posts.js';
import {
  handleCreateComplaint, handleMyComplaints, handleComplaintCandidates, handleComplaintRecent,
  handleAdminComplaints, handleResolveComplaint, handleComplaintAttachment,
} from '../../server/routes-complaints.js';
import { handleGetDataVersion } from '../../server/version.js';
import { handleCreateSigning, handleRespondSigning } from '../../server/signing.js';
import { handleCreateAward, handleGetAwards, handleDeleteAward, handleAdminAwards, handleAdminAwardAction, handleAdminAwardProof } from '../../server/awards.js';
import { handleAdminContent, handleContentAction } from '../../server/routes-audit.js';

const n = v => parseInt(v, 10);
const S = (method, path, handler) => ({ method, path, handler });

export const routes = [
  // 认证 / 账户
  S('POST', '/api/auth/register', c => handleRegister(c.db, c.body, c.req)),
  S('POST', '/api/auth/login', c => handleLogin(c.db, c.body, c.req)),
  S('GET', '/api/auth/check', c => handleCheckUsername(c.db, c.url)),
  S('GET', '/api/auth/me', c => handleAuthMe(c.db, c.req)),
  S('POST', '/api/auth/re-auth', c => handleReAuth(c.db, c.body, c.req)),
  S('POST', '/api/auth/otp/request', c => handleOtpRequest(c.db, c.body, c.req)),
  S('POST', '/api/auth/phone/bind', c => handleBindPhone(c.db, c.body, c.req)),
  S('POST', '/api/auth/email/bind', c => handleBindEmail(c.db, c.body, c.req)),
  S('POST', '/api/auth/login/code', c => handleLoginWithCode(c.db, c.body, c.req)),
  S('POST', '/api/user/username', c => handleChangeUsername(c.db, c.body, c.req)),
  S('GET', '/api/user/username/status', c => handleUsernameStatus(c.db, c.req)),
  S('GET', '/api/user/creds', c => handleGetMyCreds(c.db, c.req)),
  S('POST', '/api/auth/check-invite', c => handleCheckInvite(c.db, c.body)),
  S('POST', '/api/auth/logout', c => handleLogout(c.db, c.req)),
  S('GET', '/api/auth/sessions', c => handleListSessions(c.db, c.req)),
  S('POST', '/api/auth/sessions/revoke', c => handleRevokeSession(c.db, c.body, c.req)),
  S('POST', '/api/user/avatar', c => handleSaveAvatar(c.db, c.body, c.req)),
  S('POST', '/api/user/deactivate', c => handleDeactivateAccount(c.db, c.body, c.req)),
  S('GET', '/api/users/:id', c => handleGetUserPublic(c.db, n(c.params.id))),

  // 管理员
  S('POST', '/api/admin/invite', c => handleGenInvite(c.db, c.body, c.req)),
  S('GET', '/api/admin/invites', c => handleListInvites(c.db, c.req)),
  S('DELETE', '/api/admin/invites/:code', c => handleRevokeInvite(c.db, c.params.code, c.req)),
  S('GET', '/api/admin/verifications', c => handleListVerifications(c.db, c.url, c.req)),
  S('POST', '/api/admin/verifications/:id/action', c => handleVerificationAction(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/stats', c => handleAdminStats(c.db, c.url, c.req)),
  S('GET', '/api/admin/dashboard', c => handleAdminDashboard(c.db, c.url, c.req)),
  S('GET', '/api/admin/traffic', c => handleAdminTraffic(c.db, c.url, c.req)),
  S('GET', '/api/admin/reviews', c => handleAdminReviews(c.db, c.url, c.req)),
  S('GET', '/api/admin/logs', c => handleAdminLogs(c.db, c.url, c.req)),
  S('GET', '/api/admin/logs/:id/decrypt', c => handleAdminDecryptLog(c.db, n(c.params.id), c.req)),
  S('POST', '/api/admin/reviews/:id/approve', c => handleReviewAction(c.db, n(c.params.id), 'approve', c.body, c.req)),
  S('POST', '/api/admin/reviews/:id/reject', c => handleReviewAction(c.db, n(c.params.id), 'reject', c.body, c.req)),
  S('GET', '/api/admin/users', c => handleAdminUsers(c.db, c.url, c.req)),
  S('GET', '/api/admin/demands', c => handleAdminDemands(c.db, c.url, c.req)),
  S('GET', '/api/admin/contracts', c => handleAdminListContracts(c.db, c.url, c.req)),
  S('DELETE', '/api/admin/contracts/:id', c => handleAdminRemoveContract(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/feedbacks', c => handleAdminFeedbacks(c.db, c.url, c.req)),
  S('POST', '/api/feedbacks', c => handleCreateFeedback(c.db, c.body, c.req)),
  S('GET', '/api/feedbacks/mine', c => handleMyFeedbacks(c.db, c.req)),
  S('POST', '/api/feedbacks/:id/resolve', c => handleResolveFeedback(c.db, n(c.params.id), c.body, c.req)),

  // 投诉
  S('POST', '/api/complaints', c => handleCreateComplaint(c.db, c.body, c.req)),
  S('GET', '/api/complaints/mine', c => handleMyComplaints(c.db, c.req)),
  S('GET', '/api/complaints/candidates', c => handleComplaintCandidates(c.db, c.url, c.req)),
  S('GET', '/api/complaints/recent', c => handleComplaintRecent(c.db, c.url, c.req)),
  S('GET', '/api/complaints', c => handleAdminComplaints(c.db, c.url, c.req)),
  S('POST', '/api/complaints/:id/resolve', c => handleResolveComplaint(c.db, n(c.params.id), c.req)),
  S('GET', '/api/complaints/:id/attachment', c => handleComplaintAttachment(c.db, n(c.params.id), c.url, c.req)),
  S('POST', '/api/admin/users/:id/ban', c => handleBanUser(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/admin/teachers/:id/verify', c => handleVerifyTeacher(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/admin/demands/:id', c => handleAdminDeleteDemand(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/admin/reviews/:id', c => handleAdminDeleteReview(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/admin/messages/:id', c => handleAdminDeleteMessage(c.db, n(c.params.id), c.body, c.req)),

  // 教师 / 隐私设置
  S('GET', '/api/privacy-settings', c => handleGetPrivacySettings(c.db, c.req)),
  S('POST', '/api/privacy-settings', c => handleSetPrivacySettings(c.db, c.body, c.req)),
  S('GET', '/api/teacher/profile', c => handleGetProfile(c.db, c.url, c.req)),
  S('POST', '/api/teacher/profile', c => handleSaveProfile(c.db, c.body, c.req)),
  S('POST', '/api/teacher/verify-chsi', c => handleVerifyChsi(c.db, c.body, c.req)),
  S('POST', '/api/teacher/verify-admission', c => handleVerifyAdmission(c.db, c.body, c.req)),
  S('GET', '/api/teacher/verify-status', c => handleChsiStatus(c.db, c.req)),
  S('GET', '/api/teachers', c => handleGetTeachers(c.db, c.req)),

  // 学生需求
  S('POST', '/api/student/demands', c => handleCreateDemand(c.db, c.body, c.req)),
  S('GET', '/api/student/demands', c => handleGetDemands(c.db, c.url, c.req)),
  S('PUT', '/api/student/demands/:id', c => handleUpdateDemand(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/student/demands/:id', c => handleDeleteDemand(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/student/demands/:id/reopen', c => handleReopenDemand(c.db, n(c.params.id), c.body, c.req)),

  // 意向 / 推送
  S('POST', '/api/demands/:id/intents', c => handleCreateIntent(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/demands/:id/intents', c => handleGetIntents(c.db, n(c.params.id), c.req)),
  S('POST', '/api/intents/:id/resolve', c => handleResolveIntent(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/demand-pushes', c => handlePushDemand(c.db, c.body, c.req)),
  S('GET', '/api/demand-pushes', c => handleGetTeacherPushes(c.db, c.url, c.req)),
  S('POST', '/api/demand-pushes/:id/resolve', c => handleResolvePush(c.db, n(c.params.id), c.body, c.req)),

  // 通知
  S('GET', '/api/notifications', c => handleGetNotifications(c.db, c.req)),
  S('POST', '/api/notifications/read-all', c => handleMarkAllNotificationsRead(c.db, c.req)),
  S('POST', '/api/notifications/:id/read', c => handleMarkNotificationRead(c.db, n(c.params.id), c.req)),
  S('POST', '/api/notifications/broadcast', c => handleAdminBroadcast(c.db, c.body, c.req)),
  S('POST', '/api/admin/reencrypt', c => handleAdminReencrypt(c.db, c.body, c.req, c.env)),
  S('DELETE', '/api/admin/notifications/:id', c => handleAdminDeleteNotification(c.db, n(c.params.id), c.req)),

  // 合同 / 签约
  S('POST', '/api/contracts', c => handleCreateContract(c.db, c.body, c.req)),
  S('GET', '/api/contracts/my', c => handleGetMyContracts(c.db, c.url, c.req)),
  S('POST', '/api/contracts/:id/sign', c => handleSignContract(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/contracts/:id/verify', c => handleVerifyContract(c.db, n(c.params.id), c.req)),
  S('POST', '/api/contracts/:id/revoke', c => handleRevokeContract(c.db, n(c.params.id), c.body, c.req)),
  S('PUT', '/api/contracts/:id', c => handleModifyContract(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/contracts/:id', c => handleCancelContract(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/conversations/:id/signing', c => handleCreateSigning(c.db, { ...c.body, conversationId: n(c.params.id) }, c.req)),
  S('GET', '/api/conversations/:id/bindable-demands', c => handleGetConversationBindableDemands(c.db, n(c.params.id), c.url, c.req)),
  S('POST', '/api/signing-requests/:id/respond', c => handleRespondSigning(c.db, n(c.params.id), c.body, c.req)),

  // 奖项
  S('POST', '/api/teacher/awards', c => handleCreateAward(c.db, c.body, c.req)),
  S('GET', '/api/teacher/awards', c => handleGetAwards(c.db, c.url, c.req)),
  S('DELETE', '/api/teacher/awards/:id', c => handleDeleteAward(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/awards', c => handleAdminAwards(c.db, c.url, c.req)),
  S('GET', '/api/admin/awards/:id/proof', c => handleAdminAwardProof(c.db, n(c.params.id), c.req)),
  S('POST', '/api/admin/awards/:id/action', c => handleAdminAwardAction(c.db, n(c.params.id), c.body, c.req)),

  // 聊天 / 附件
  S('GET', '/api/conversations', c => handleGetConversations(c.db, c.url, c.req)),
  S('POST', '/api/conversations/:id/read', c => handleMarkRead(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/conversations/:id/messages', c => handleGetMessages(c.db, n(c.params.id), c.url, c.req)),
  S('POST', '/api/conversations/:id/messages', c => handleSendMessage(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/conversations/:id/messages/:mid/attachment', c => handleGetAttachment(c.db, n(c.params.id), n(c.params.mid), c.url, c.req)),
  S('POST', '/api/uploads', c => handleCreateUpload(c.db, c.body, c.req)),
  S('DELETE', '/api/uploads/:id', c => handleDeleteUpload(c.db, n(c.params.id), c.body, c.req)),

  // 评价 / 帖子 / 内容审核 / 数据版本 / 验证码
  S('POST', '/api/reviews', c => handleCreateReview(c.db, c.body, c.req)),
  S('GET', '/api/reviews', c => handleGetReviews(c.db, c.url, c.req)),
  S('PUT', '/api/reviews/:id', c => handleUpdateReview(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/posts', c => handleListPosts(c.db, c.url, c.req)),
  S('POST', '/api/posts', c => handleCreatePost(c.db, c.body, c.req)),
  S('GET', '/api/posts/favorites/mine', c => handleMyFavorites(c.db, c.req)),
  S('POST', '/api/posts/:id/favorite', c => handleToggleFavorite(c.db, n(c.params.id), c.body, c.req)),
  S('POST', '/api/posts/:id/like', c => handleToggleLike(c.db, n(c.params.id), c.body, c.req)),
  S('DELETE', '/api/posts/:id', c => handleDeletePost(c.db, n(c.params.id), c.body, c.req)),
  S('GET', '/api/admin/content', c => handleAdminContent(c.db, c.url, c.req)),
  S('POST', '/api/admin/content/:type/:id/action', c => handleContentAction(c.db, c.params.type, n(c.params.id), c.body, c.req)),
  S('GET', '/api/data-version', c => handleGetDataVersion(c.db)),
  S('POST', '/api/captcha/verify', c => handleCaptchaVerify(c.db, c.body, c.req)),
];
