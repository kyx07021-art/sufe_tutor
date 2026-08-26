// ZD-5（2026-08-26 休眠）：签约/合同全链路休眠——本文件函数保留（休眠非删除，my-contracts 页不注册、无 UI 触发点），恢复时同步路由契约/text 键。
/**
 * Contract -> chat bridge: avoids static feature imports.
 * chat feature registers its chatConvById implementation when it loads.
 */
let chatConvById = () => null;
export function setChatConvById(fn) { if (typeof fn === 'function') chatConvById = fn; }
export { chatConvById };
