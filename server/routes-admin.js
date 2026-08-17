// v2 shim（V-1-4c）：实体按域拆分迁移，本文件仅保留旧路径 re-export 出口。
//   admin/api.js        —— 邀请码/统计/用户/需求/消息/日志/广播/密钥轮换/统一内容审核
//   reviews/api.js      —— 评价审核
//   complaints/api.js   —— 反馈工单
//   teacher/api.js      —— 教师认证审核
export {
  handleGenInvite, handleListInvites, handleRevokeInvite, handleAdminStats, handleAdminTraffic,
  handleAdminUsers, handleBanUser, handleAdminDemands, handleAdminDeleteDemand, handleAdminDeleteMessage,
  handleAdminLogs, handleAdminDecryptLog, handleAdminBroadcast, handleAdminReencrypt, handleAdminDashboard,
} from '../src/server/domains/admin/api.js';
export { handleAdminReviews, handleReviewAction, handleAdminDeleteReview } from '../src/server/domains/reviews/api.js';
export { handleCreateFeedback, handleMyFeedbacks, handleAdminFeedbacks, handleResolveFeedback } from '../src/server/domains/complaints/api.js';
export { handleListVerifications, handleVerificationAction, handleVerifyTeacher } from '../src/server/domains/teacher/api.js';
