import { defineConnection } from "@grok/agent-sdk/connections";

export default defineConnection({
  url: "https://bayer.aha.io/api/v1/mcp",
  oauth: true,
  advertiseTools: true,
  effects: "read",
});
