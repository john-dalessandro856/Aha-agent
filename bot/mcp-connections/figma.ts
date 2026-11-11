import { defineConnection } from "@grok/agent-sdk/connections";

// Figma rejects direct Agent SDK OAuth (HTTP 403). Bridge the IDE-connected
// Figma connector through the Cursor account MCP path. The identifier from
// serve preflight is `user-Figma` (IDE Tools & MCP → Figma).
export default defineConnection({
  cursorAccount: true,
  servers: ["user-Figma"],
  advertiseTools: true,
  effects: "read",
  optional: true,
});
