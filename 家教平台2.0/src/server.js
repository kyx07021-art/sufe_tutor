import { init, HttpError } from "./db.js";
import { routes as auth, seedAdmins } from "./auth.js";
import { PRODUCT } from "./shared.js";
import { routes as teachers } from "./domains/teachers.js";
import { routes as demands } from "./domains/demands.js";
import { routes as chat } from "./domains/chat.js";
import { routes as feedback } from "./domains/feedback.js";
import { routes as community } from "./domains/community.js";
import { routes as admin } from "./domains/admin.js";

const routes = [
  ...auth,
  ...teachers,
  ...demands,
  ...chat,
  ...feedback,
  ...community,
  ...admin,
];
let startup;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      startup ||= init(env.DB).then(() => seedAdmins(env.DB, env));
      await startup;
      if (url.pathname === "/api/health")
        return Response.json({
          ready: true,
          version: PRODUCT.version,
          commit: typeof BUILD_COMMIT === "undefined" ? "local" : BUILD_COMMIT,
          product: PRODUCT.name,
        });
      for (const [method, path, handler] of routes) {
        const names = [...path.matchAll(/:([^/]+)/g)].map((x) => x[1]);
        const match = url.pathname.match(
          new RegExp("^" + path.replace(/:[^/]+/g, "([^/]+)") + "$"),
        );
        if (method !== request.method || !match) continue;
        const params = Object.fromEntries(
          names.map((name, i) => [name, decodeURIComponent(match[i + 1])]),
        );
        const body = ["POST", "PUT", "PATCH"].includes(method)
          ? await request.json()
          : {};
        return Response.json(
          await handler({ db: env.DB, request, url, body, params, env }),
        );
      }
      throw new HttpError(404, "NOT_FOUND", "页面或接口不存在");
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      return Response.json(
        {
          error: {
            code: error.code || "SERVER_ERROR",
            message:
              error instanceof HttpError ? error.message : "服务暂不可用",
          },
        },
        { status: error.status || 500 },
      );
    }
  },
};
