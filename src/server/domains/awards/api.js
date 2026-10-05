/**
 * awards 域路由（S6-A5 下线态）：awards 在新站不上线（不保留向后兼容），
 * 全部 handler（handleCreateAward/handleGetAwards/handleDeleteAward/handleAdminAwards/
 * handleAdminAwardProof/handleAdminAwardAction）与路由随之下线删除。
 *
 * 保留文件与 routes 导出——src/server/app.js 以 `import { routes as awardsRoutes }`
 * 拼接进声明式路由表，空数组即不注册任何 awards 路由。
 */
export const routes = [];
