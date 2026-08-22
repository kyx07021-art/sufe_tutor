/**
 * pages.js - M4 C2 chat module page registration (consumed by the M2-08 route registry)
 * -----------------------------------------------------------------
 * - shell/page-registry.js's import.meta.glob auto-collects every module's pages.js.
 * - Page definition: { path, name, roles?, component, meta? }; roles present = role gate.
 * - C2 chat page is shared by student/teacher (logged-in), path /chat.
 */
import { ChatPage } from './index.js'
import { ROLES } from '@/modules/shell/auth-store.js'
import { CHAT_COPY } from '@/constants/m-chat.js'

export const pages = [
  {
    path: '/chat',
    name: 'chat',
    roles: [ROLES.STUDENT, ROLES.TEACHER],
    component: ChatPage,
    meta: { tab: true, title: CHAT_COPY.PAGE_TITLE },
  },
]
