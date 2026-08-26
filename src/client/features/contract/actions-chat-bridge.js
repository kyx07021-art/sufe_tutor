// ZD-5 (2026-08-26 dormancy): contract flow sleeps - functions here are kept (dormant, not deleted; my-contracts page unregistered, no UI trigger), restore = sync route contract / text keys.
/**
 * Contract -> chat bridge: avoids static feature imports.
 * chat feature registers its chatConvById implementation when it loads.
 */
let chatConvById = () => null;
export function setChatConvById(fn) { if (typeof fn === 'function') chatConvById = fn; }
export { chatConvById };
