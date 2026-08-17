/**
 * JSON 列反序列化单点（mapper 唯一出口）。
 */
export function safeJsonArray(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export function safeJsonObject(text, fallback = {}) {
  if (!text) return fallback;
  if (typeof text === 'object' && !Array.isArray(text)) return text;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }
  catch { return fallback; }
}
