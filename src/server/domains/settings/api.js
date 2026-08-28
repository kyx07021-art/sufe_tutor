/**
 * settings 域路由（S6 定案⑥ + S6-S4）。
 *
 * privacy（GET/POST /api/privacy-settings）已随定案⑥ 删除（新站无访客浏览，
 * 列表门禁 = 登录，privacy 是死能力）。
 *
 * 收敛后的 GET/PUT /api/settings + POST /api/settings/deactivate 由 auth 域
 * （auth/settings.js，..19）注册——其中 PUT /api/settings 的 Branch 4 已处理
 * blockSystemNotifications / notifyBroadcastMuted 布尔写（严格 0/1 归一，写后
 * logEvent action:'user.settings.prefs'）。本域**不再重复注册** PUT /api/settings：
 * S1 并行已注册，重复即路由冲突（裁定留主会话组装，见交付报告）。
 *
 * S6-S4 数据层（dbGetNotifyBroadcastMuted / dbSetNotifyBroadcastMuted）在
 * settings/repo.js；广播类通知渲染按偏好过滤由 S0 的 core/notify.js 读取
 * users.notifyBroadcastMuted 实现（S6-N3 广播归 S0/N3，本基元只保证列存在 + 写端点）。
 */
export const routes = [];
