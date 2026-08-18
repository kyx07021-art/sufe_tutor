import { JSDOM } from 'jsdom';
import { CONFIG } from '../src/shared/config.js';
import { state } from '../src/client/core/state.js';
import authFeature from '../src/client/features/auth/index.js';
import * as auth from '../src/client/features/auth/actions.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
authFeature.onLoad();
console.log('after onLoad:', globalThis.localStorage.getItem(CONFIG.DEVICE_ID_KEY));
globalThis.localStorage.setItem(CONFIG.DEVICE_ID_KEY, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
console.log('after seed:', globalThis.localStorage.getItem(CONFIG.DEVICE_ID_KEY));
