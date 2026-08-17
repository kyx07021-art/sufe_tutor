/**
 * 声明式路由匹配器（架构 v2 唯一实现）。
 * 路由声明：{ method, path, handler }；path 支持 ':param' 段（匹配一段非空路径）。
 * 先匹配静态路径，再匹配动态路径；未命中返回 404 响应。
 */
import { error } from './core/util.js';

function compile(path) {
  if (!path.includes(':')) return { kind: 'exact', path };
  const names = [];
  const re = new RegExp('^' + path.split('/').map(seg => {
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/') + '$');
  return { kind: 'param', re, names, path };
}

export function createRouter(routes) {
  const compiled = routes.map(r => ({ ...r, c: compile(r.path) }));
  return async ctx => {
    const { method, p } = ctx;
    for (const r of compiled) {
      if (r.method !== method) continue;
      if (r.c.kind === 'exact') {
        if (r.c.path === p) return await r.handler({ ...ctx });
      } else {
        const m = p.match(r.c.re);
        if (!m) continue;
        const params = {};
        r.c.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        return await r.handler({ ...ctx, params });
      }
    }
    return error('Not Found', 404, 'ROUTE_NOT_FOUND');
  };
}
