/**
 * v2 api core: single fetch wrapper + batch reads + XHR upload with progress.
 * Network errors and 401 dead-session handling mirror v1 app-api semantics.
 */
import { CONFIG } from '../../shared/config.js';
import { state, clearSession, runLogoutResets } from './state.js';
import { TEXT } from '../constants/text.js';

let lastHandled401Token = null;
export let sessionBootValidating = false;
export function setSessionBootValidating(v) { sessionBootValidating = !!v; }

let ensureAuthFn = null;
export function setEnsureAuth(fn) { ensureAuthFn = typeof fn === 'function' ? fn : null; }

function handleDeadToken(sentToken) {
  if (sentToken && sentToken === lastHandled401Token) return;
  if (sentToken) lastHandled401Token = sentToken;
  if (sentToken && state.authToken === sentToken) {
    const role = state.user ? state.user.role : '';
    state.authToken = null; state.user = null;
    clearSession(role);
    runLogoutResets();
  }
  if (state.view === 'client' && ensureAuthFn && !sessionBootValidating) ensureAuthFn();
}

async function doRequest(endpoint, config, sentToken) {
  const controller = new AbortController();
  config.signal = controller.signal;
  const timeoutErr = new Error(TEXT.NETWORK_ERROR);
  timeoutErr.code = 'NETWORK_ERROR'; timeoutErr.isTimeout = true;
  let timer = null, res = null;
  try {
    const data = await Promise.race([
      (async () => { res = await fetch(endpoint, config); return await res.json(); })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(timeoutErr); }, CONFIG.API_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status === 401) handleDeadToken(sentToken);
      const e = new Error(data.error || TEXT.ERROR_REQUEST_FAILED);
      e.code = data.code; throw e;
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err === timeoutErr || (err && err.code !== undefined)) throw err;
    const e = new Error(TEXT.NETWORK_ERROR);
    e.code = 'NETWORK_ERROR'; throw e;
  }
}

export async function api(endpoint, options = {}) {
  const sentToken = state.authToken;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.authToken) headers['X-Auth-Token'] = state.authToken;
  const config = { ...options, headers };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);
  const retries = !config.method || config.method === 'GET' ? CONFIG.GET_RETRY : 0;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, CONFIG.GET_RETRY_BACKOFF_MS));
    try { return await doRequest(endpoint, config, sentToken); }
    catch (err) {
      lastErr = err;
      if (!(err && err.code === 'NETWORK_ERROR') || (err && err.isTimeout)) break;
      if (retries === 0) break;
    }
  }
  throw lastErr;
}

export async function apiBatch(gets) {
  if (!gets || !gets.length) return new Map();
  const sentToken = state.authToken;
  const data = await api('/api/batch', { method: 'POST', body: { gets } });
  const map = new Map();
  for (const r of (data.results || [])) {
    map.set(r.path, { status: r.status, data: r.data });
    if (r.status === 401) handleDeadToken(sentToken);
  }
  return map;
}

/**
 * XHR upload channel (chat uploads/complaint attachments reuse this single network path).
 * Accepts data URL payload and returns parsed JSON response. Abortable + progress callback.
 */
export function apiUpload({ kind, fileData, fileName, thumb }, onProgress, onXhr) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (state.authToken) xhr.setRequestHeader('X-Auth-Token', state.authToken);
    xhr.responseType = 'json';
    xhr.upload.onprogress = e => {
      if (typeof onProgress === 'function') onProgress(e.lengthComputable ? e.loaded / e.total : null);
    };
    if (typeof onXhr === 'function') onXhr(xhr);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(xhr.response || JSON.parse(xhr.responseText || '{}')); }
        catch { resolve({}); }
      } else {
        const body = (() => { try { return xhr.response || JSON.parse(xhr.responseText || '{}'); } catch { return {}; } })();
        if (xhr.status === 401) handleDeadToken(state.authToken);
        const e = new Error(body.error || TEXT.ERROR_REQUEST_FAILED);
        e.code = body.code; reject(e);
      }
    };
    xhr.onerror = () => reject(new Error(TEXT.NETWORK_ERROR));
    xhr.onabort = () => { const e = new Error(TEXT.NETWORK_ERROR); e.code = 'ABORT'; reject(e); };
    xhr.send(JSON.stringify({ kind, fileData, fileName, thumb }));
  });
}
