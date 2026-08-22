/**
 * 数据访问层兼容出口（V-1-4 起仅 re-export）。
 * 业务数据 SQL 已按域迁至 src/server/domains/<域>/repo.js；初始化/迁移在 src/server/core/db.js
 * 纯编排 + 各域 schema.js；路由 handler 在各域 api.js。本文件只保留旧 import 路径兼容。
 */

// JSON 列反序列化单点（V-1-3 提取；旧 import 路径经 db.js 出口）
import { safeJsonArray, safeJsonObject } from '../src/server/core/json.js';
// 认证域数据层（V-1-4 提取；旧 import 路径经 db.js 出口）
import {
  dbFindUserByUsername, dbUserLookupStmt, dbUsernameExistsStmt, dbUserPhoneHashStmt, dbUserEmailHashStmt,
  dbGetUserById, dbCreateUser, dbDeleteUser, dbDeactivateUser, dbRecomputeTeacherRating, dbPurgeUserOwnedData,
  dbUpdateUserAvatar, dbSetUserBanned, dbFindValidInviteCode, dbUseInviteCode, dbCreateInviteCode,
  dbGetTeacherName,
} from '../src/server/domains/auth/repo.js';

export {
  safeJsonArray, safeJsonObject,
  dbFindUserByUsername, dbUserLookupStmt, dbUsernameExistsStmt, dbUserPhoneHashStmt, dbUserEmailHashStmt,
  dbGetUserById, dbCreateUser, dbDeleteUser, dbDeactivateUser, dbRecomputeTeacherRating, dbPurgeUserOwnedData,
  dbUpdateUserAvatar, dbSetUserBanned, dbFindValidInviteCode, dbUseInviteCode, dbCreateInviteCode,
  dbGetTeacherName,
};

import {
  dbGetTeacherProfile, dbIsMatched, dbUpsertTeacherProfile, dbGetTeachers, dbSetTeacherVerified,
  dbGetTeacherVerification, dbUpsertTeacherVerification, dbClearChsiFromProfile, dbApplyChsiToProfile,
  dbListTeacherVerifications, dbGetTeacherVerificationById,
} from '../src/server/domains/teacher/repo.js';

export {
  dbGetTeacherProfile, dbIsMatched, dbUpsertTeacherProfile, dbGetTeachers, dbSetTeacherVerified,
  dbGetTeacherVerification, dbUpsertTeacherVerification, dbClearChsiFromProfile, dbApplyChsiToProfile,
  dbListTeacherVerifications, dbGetTeacherVerificationById,
};

import {
  dbCreateDemand, dbGetDemands, dbGetDemandsByUser, dbGetDemandById, dbUpdateDemand, dbDeleteDemand,
  dbAdminForceDeleteDemand, dbSetDemandStatus,
} from '../src/server/domains/demand/repo.js'; // S2：intents/pushes removed; dbReopenDemand/dbReleaseDemandAfterRevoke 随 contracted/revoked 状态删除

export {
  dbCreateDemand, dbGetDemands, dbGetDemandsByUser, dbGetDemandById, dbUpdateDemand, dbDeleteDemand,
  dbAdminForceDeleteDemand, dbSetDemandStatus,
};

import {
  dbUpsertConversation, dbGetConversationById, dbGetConversationWithNames,
  dbGetMyConversations, dbGetMyRelations, dbMarkConversationRead, dbGetMessages, dbPrepareMessageInsert, dbCreateMessage,
  dbGetMessageById, dbGetMessageAttachment, dbDeleteMessage,
  dbCloseConversationCascade, dbGetConversationByTuple, dbDeleteConversation,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload, dbPrepareUploadDelete,
  dbGetMessagesByClientKeys,
} from '../src/server/domains/chat/repo.js';

export {
  dbUpsertConversation, dbGetConversationById, dbGetConversationWithNames,
  dbGetMyConversations, dbGetMyRelations, dbMarkConversationRead, dbGetMessages, dbPrepareMessageInsert, dbCreateMessage,
  dbGetMessageById, dbGetMessageAttachment, dbDeleteMessage,
  dbCloseConversationCascade, dbGetConversationByTuple, dbDeleteConversation,
  dbPurgeStaleUploads, dbCountUploads, dbCreateUpload, dbGetUpload, dbGetUploads, dbDeleteUpload, dbPrepareUploadDelete,
  dbGetMessagesByClientKeys,
};

import { dbGetContractById, dbGetMyContracts, dbGetAllContractsAdmin, dbDeleteContract, dbCreateContract, dbSetContractMd } from '../src/server/domains/contract/repo.js';
export { dbGetContractById, dbGetMyContracts, dbGetAllContractsAdmin, dbDeleteContract, dbCreateContract, dbSetContractMd };

// S6: settings/repo.js no longer exports privacy-settings functions (domain rewritten to
// notify-broadcast-muted only, which has no shim consumer) — dead import removed.

import { dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair, dbUpdateReview, dbGetReviewsAdmin, dbDeleteReview, dbUpdateReviewStatus, dbGetReviewById } from '../src/server/domains/reviews/repo.js';
export { dbCreateReview, dbGetApprovedReviews, dbGetReviewByPair, dbUpdateReview, dbGetReviewsAdmin, dbDeleteReview, dbUpdateReviewStatus, dbGetReviewById };

import { dbListPosts, dbListMyFavoritePosts, dbCreatePostFavorite, dbDeletePostFavorite, dbCreatePost, dbGetPostById, dbGetPostLikeToggleRead, dbGetPostFavoriteToggleRead, dbTogglePostLike, dbDeletePost } from '../src/server/domains/posts/repo.js';
import { dbCreateFeedback, dbGetFeedbacksByUser, dbGetFeedbacksAdmin, dbGetFeedbackById, dbResolveFeedback, dbCreateComplaint, dbCountComplaintsToday, dbGetComplaintsByUser, dbGetComplaintsAdmin, dbGetComplaintById, dbResolveComplaint, dbSearchUsersByRole, dbRecentInteractions, dbSearchPosts } from '../src/server/domains/complaints/repo.js';
export { dbListPosts, dbListMyFavoritePosts, dbCreatePostFavorite, dbDeletePostFavorite, dbCreatePost, dbGetPostById, dbGetPostLikeToggleRead, dbGetPostFavoriteToggleRead, dbTogglePostLike, dbDeletePost, dbCreateFeedback, dbGetFeedbacksByUser, dbGetFeedbacksAdmin, dbGetFeedbackById, dbResolveFeedback, dbCreateComplaint, dbCountComplaintsToday, dbGetComplaintsByUser, dbGetComplaintsAdmin, dbGetComplaintById, dbResolveComplaint, dbSearchUsersByRole, dbRecentInteractions, dbSearchPosts };

import { dbGetUserStats, dbGetCountWhere, dbGetCount, dbGetReviewStats, dbGetInviteStats, dbListInviteCodes, dbRevokeInviteCode, dbGetRecentUsers, dbGetRecentDemands, dbGetStudentUsersAdmin, dbGetAllContentAdmin, dbDeleteFeedback, dbDeleteComplaint, dbAdminSearchUsers } from '../src/server/domains/admin/repo.js';
export { dbGetUserStats, dbGetCountWhere, dbGetCount, dbGetReviewStats, dbGetInviteStats, dbListInviteCodes, dbRevokeInviteCode, dbGetRecentUsers, dbGetRecentDemands, dbGetStudentUsersAdmin, dbGetAllContentAdmin, dbDeleteFeedback, dbDeleteComplaint, dbAdminSearchUsers };

// v2 shim：迁移/初始化已迁至 src/server/core/db.js；本文件保留数据层 re-export 出口
import { SCHEMA_VERSION, initDb } from '../src/server/core/db.js';
export { SCHEMA_VERSION, initDb };
