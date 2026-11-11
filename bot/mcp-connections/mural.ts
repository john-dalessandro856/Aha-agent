import { defineConnection } from "@grok/agent-sdk/connections";

export default defineConnection({
  url: "https://mcp-canvas.mural.co/mcp",
  oauth: true,
  advertiseTools: true,
  effects: "read",
});
