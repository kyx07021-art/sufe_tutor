/**
 * CSS contract test shared reads (post V-2-5b restructure).
 * Load order = index.html link order:
 *   STYLE_CSS  = original style.css all bytes (tokens/base/features-per-domain/responsive concatenated in load order)
 *   CHAT_CSS / POSTS_CSS / REGION_CSS = original style-chat/posts/region.css (moved into features/)
 *   GLASS_CSS  = glass.css (glass engine kept whole)
 */
import { readFileSync } from 'node:fs';

const read = f => readFileSync(f, 'utf8');

export const STYLE_CSS = [
  'tokens.css', 'base.css',
  'features/complaints.css', 'features/browse.css', 'features/admin.css', 'features/teacher.css',
  'features/notif.css', 'features/chart.css', 'features/demand.css', 'responsive.css',
].map(read).join('\n');
export const CHAT_CSS = read('features/chat.css');
export const POSTS_CSS = read('features/posts.css');
export const REGION_CSS = read('features/region.css');
export const GLASS_CSS = read('glass.css');
