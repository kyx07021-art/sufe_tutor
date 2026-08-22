/**
 * router/index.js - app router (memory history + nested shell + role gates)
 * -------------------------------------------------------
 * - Memory history (createMemoryHistory): pure state routing with zero URL
 *   races — no location to sync, no SPA fallback / reload-recovery problem.
 *   ADR 0003 §2.2 settles this for a login-heavy, low-share client; last-page
 *   memory (sessionStorage) recovers the previous view on refresh.
 * - Routes derive from the module page registry:
 *   - public pages (no `roles`) are top-level routes;
 *   - gated pages (have `roles`) are children of an empty-path ShellLayout
 *     route (nested layout shell). `requiresAuth` on the parent lets the
 *     guard treat the whole subtree as protected, and each child carries its
 *     own `roles` for the role gate.
 * - installRouterGuard wires beforeEach (auth + role gate) and afterEach
 *   (last-page memory + leave hooks); see router-guard.js (M2-09).
 */
import { createRouter, createMemoryHistory } from 'vue-router'
import ShellLayout from '@/modules/shell/ShellLayout.vue'
import { pages } from '@/modules/shell/page-registry.js'
import { installRouterGuard } from '@/modules/shell/router-guard.js'

const publicPages = pages.filter((p) => !p.roles)
const gatedPages = pages.filter((p) => p.roles)

const routes = [
  ...publicPages.map((p) => ({
    path: p.path,
    name: p.name,
    component: p.component,
    meta: { ...(p.meta || {}) },
  })),
  {
    path: '/',
    component: ShellLayout,
    meta: { requiresAuth: true },
    children: gatedPages.map((p) => ({
      path: p.path,
      name: p.name,
      component: p.component,
      meta: { ...(p.meta || {}), roles: p.roles },
    })),
  },
]

export const router = createRouter({ history: createMemoryHistory(), routes })

installRouterGuard(router)
