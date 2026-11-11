import { defineConnection } from "@grok/agent-sdk/connections";

// Bayer DPJ (OpenProject). Auth is a personal API token with MCP scope —
// same value as OPENPROJECT_API_KEY used by the Bayer openproject plugin.
// Do not set effects: "read"; create/update tools must stay available.
export default defineConnection({
  url: "https://dpj.int.bayer.com/mcp",
  headers: {
    Authorization: "Bearer ${OPENPROJECT_API_KEY}",
    Accept: "application/json, text/event-stream",
  },
  advertiseTools: true,
  optional: true,
});
