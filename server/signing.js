// v2 shim：initSigningTable 迁入 chat/schema.js；签约 handler 迁入 contract/api.js
export { initSigningTable } from '../src/server/domains/chat/schema.js';
export { handleCreateSigning, handleRespondSigning } from '../src/server/domains/contract/api.js';
