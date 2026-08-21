/**
 * contract domain display mappings.
 * Pure functions; text from constants/text.js + shared enums single source only.
 */
import { STATUS } from '../../../shared/enums.js';
import { TEXT } from '../../constants/text.js';

export function contractStatusMeta(ct) {
  const status = typeof ct === 'string' ? ct : (ct && ct.status);
  if (ct && typeof ct === 'object' && ct.revoked) return { text: TEXT.CONTRACT_STATUS_REVOKED, cls: 'tag-danger' };
  if (status === STATUS.SIGNED) return { text: TEXT.CONTRACT_STATUS_SIGNED, cls: 'tag-ok' };
  return { text: TEXT.CONTRACT_STATUS_SIGNING, cls: 'tag-warn' };
}

/**
 * LCS line diff (parity with app-display D.diffLines):
 * returns ops [{t:'same'|'del'|'add', text}].
 */
export function diffLines(oldText, newText) {
  const splitLines = t => (t == null || t === '') ? [] : String(t).split('\n');
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', text: a[i] }); i++; }
    else { ops.push({ t: 'add', text: b[j] }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', text: a[i] }); i++; }
  while (j < m) { ops.push({ t: 'add', text: b[j] }); j++; }
  return ops;
}
