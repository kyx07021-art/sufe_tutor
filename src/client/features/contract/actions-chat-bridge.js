/**
 * Contract -> chat bridge: avoids static feature imports.
 * chat feature registers its chatConvById implementation when it loads.
 */
let chatConvById = () => null;
export function setChatConvById(fn) { if (typeof fn === 'function') chatConvById = fn; }
export { chatConvById };
