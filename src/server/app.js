/**
 * 架构 v2 声明式路由表（每个 domain 自持 routes，app.js 只做拼接）。
 * 特殊路由（通知）属于 core 或根基础设施，保留在本文件。
 */
import { routes as authRoutes } from './domains/auth/api.js';
import { settingsRoutes } from './domains/auth/settings.js';
import { verifyRoutes } from './domains/auth/verify.js';
import { routes as teacherRoutes } from './domains/teacher/api.js';
import { routes as demandRoutes } from './domains/demand/api.js';
import { routes as chatRoutes } from './domains/chat/api.js';
import { routes as contractRoutes } from './domains/contract/api.js';
import { routes as awardsRoutes } from './domains/awards/api.js';
import { routes as postsRoutes } from './domains/posts/api.js';
import { routes as complaintsRoutes } from './domains/complaints/api.js';
import { routes as reviewsRoutes } from './domains/reviews/api.js';
import { routes as adminRoutes } from './domains/admin/api.js';
import { parseIdParam } from './core/util.js';
import {
  handleGetNotifications, handleMarkNotificationRead, handleMarkAllNotificationsRead,
  handleAdminDeleteNotification,
} from './core/notify.js';
const S = (method, path, handler) => ({ method, path, handler });

// core 通知 + 根基础设施的特殊路由（不进任何 domain 的 routes）
const specialRoutes = [
  S('GET', '/api/notifications', c => handleGetNotifications(c.db, c.req)),
  S('POST', '/api/notifications/read-all', c => handleMarkAllNotificationsRead(c.db, c.req)),
  S('POST', '/api/notifications/:id/read', c => handleMarkNotificationRead(c.db, parseIdParam(c.params.id), c.req)),
  S('DELETE', '/api/admin/notifications/:id', c => handleAdminDeleteNotification(c.db, parseIdParam(c.params.id), c.req)),
];

export const routes = [
  ...authRoutes,
  ...settingsRoutes,
  ...verifyRoutes,
  ...teacherRoutes,
  ...demandRoutes,
  ...chatRoutes,
  ...contractRoutes,
  ...awardsRoutes,
  ...postsRoutes,
  ...complaintsRoutes,
  ...reviewsRoutes,
  ...adminRoutes,
  ...specialRoutes,
];
