/**
 * 上财家教信息共享平台 - Cloudflare Pages Worker 入口
 * 本文件只做三件事：CORS 预检、路由分发、静态文件回退
 * 全部业务逻辑在 server/*.js 模块中（core 工具 / db 数据层 / routes-* 路由）
 *
 * 绑定: env.DB = D1 数据库
 * 安全: server/ 与 docs/ 目录随静态资源上传但在此统一 404，防源码公开访问
 */
import { initDb } from './server/db.js';
import { json, error } from './server/core.js';
import { handleRegister, handleLogin } from './server/routes-auth.js';
import { handleGetProfile, handleSaveProfile, handleGetTeachers } from './server/routes-teacher.js';
import {
  handleCreateDemand, handleGetDemands, handleUpdateDemand, handleDeleteDemand,
  handleCreateIntent, handleGetIntents,
} from './server/routes-demands.js';
import { handleCreateReview, handleGetReviews } from './server/routes-reviews.js';
import {
  handleAdminCheck, handleGenInvite, handleAdminInvites, handleAdminStats,
  handleAdminReviews, handleReviewAction, handleAdminUsers, handleBanUser,
  handleAdminDeleteDemand, handleAdminDeleteReview,
} from './server/routes-admin.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 非 API 请求 → 静态文件（源码目录 server/、docs/ 一律 404）
    if (!p.startsWith('/api/')) {
      if (p.startsWith('/server/') || p.startsWith('/docs/')) {
        return new Response('Not Found', { status: 404 });
      }
      return env.ASSETS.fetch(request);
    }

    // 首次请求时初始化数据库
    if (!env._dbInited) {
      await initDb(env.DB);
      env._dbInited = true;
    }

    const db = env.DB;
    let body = {};
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') {
      try { body = await request.json(); } catch { body = {}; }
    }

    try {
      // 认证
      if (p === '/api/auth/register' && request.method === 'POST') return await handleRegister(db, body);
      if (p === '/api/auth/login' && request.method === 'POST') return await handleLogin(db, body);

      // 管理员
      if (p === '/api/admin/check' && request.method === 'GET') return await handleAdminCheck(db, url);
      if (p === '/api/admin/invite' && request.method === 'POST') return await handleGenInvite(db, body);
      if (p === '/api/admin/invites' && request.method === 'GET') return await handleAdminInvites(db, url);
      if (p === '/api/admin/stats' && request.method === 'GET') return await handleAdminStats(db, url);
      if (p === '/api/admin/reviews' && request.method === 'GET') return await handleAdminReviews(db, url);
      if (p.match(/^\/api\/admin\/reviews\/(\d+)\/approve$/) && request.method === 'POST') {
        const id = parseInt(p.match(/\/(\d+)\//)[1]);
        return await handleReviewAction(db, id, 'approve', body);
      }
      if (p.match(/^\/api\/admin\/reviews\/(\d+)\/reject$/) && request.method === 'POST') {
        const id = parseInt(p.match(/\/(\d+)\//)[1]);
        return await handleReviewAction(db, id, 'reject', body);
      }
      if (p === '/api/admin/users' && request.method === 'GET') return await handleAdminUsers(db, url);
      const userBan = p.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
      if (userBan && request.method === 'POST') return await handleBanUser(db, parseInt(userBan[1]), body);
      const adminDemand = p.match(/^\/api\/admin\/demands\/(\d+)$/);
      if (adminDemand && request.method === 'DELETE') return await handleAdminDeleteDemand(db, parseInt(adminDemand[1]), body);
      const adminReviewById = p.match(/^\/api\/admin\/reviews\/(\d+)$/);
      if (adminReviewById && request.method === 'DELETE') return await handleAdminDeleteReview(db, parseInt(adminReviewById[1]), body);

      // 教师
      if (p === '/api/teacher/profile' && request.method === 'GET') return await handleGetProfile(db, url);
      if (p === '/api/teacher/profile' && request.method === 'POST') return await handleSaveProfile(db, body);
      if (p === '/api/teachers' && request.method === 'GET') return await handleGetTeachers(db);

      // 学生需求
      if (p === '/api/student/demands' && request.method === 'POST') return await handleCreateDemand(db, body);
      if (p === '/api/student/demands' && request.method === 'GET') return await handleGetDemands(db, url);
      const demandById = p.match(/^\/api\/student\/demands\/(\d+)$/);
      if (demandById && request.method === 'PUT') return await handleUpdateDemand(db, parseInt(demandById[1]), body);
      if (demandById && request.method === 'DELETE') return await handleDeleteDemand(db, parseInt(demandById[1]), body);

      // 需求意向
      const intentMatch = p.match(/^\/api\/demands\/(\d+)\/intents$/);
      if (intentMatch && request.method === 'POST') return await handleCreateIntent(db, parseInt(intentMatch[1]), body);
      if (intentMatch && request.method === 'GET') return await handleGetIntents(db, parseInt(intentMatch[1]));

      // 评价
      if (p === '/api/reviews' && request.method === 'POST') return await handleCreateReview(db, body);
      if (p === '/api/reviews' && request.method === 'GET') return await handleGetReviews(db, url);

      // 健康检查
      if (p === '/api/health') return json({ status: 'ok', timestamp: new Date().toISOString() });

      return error('Not Found', 404);
    } catch (err) {
      console.error('API Error:', err);
      return error('服务器内部错误: ' + err.message, 500);
    }
  },
};
