import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    egressDomains: [
      "bayer.aha.io",
      "mcp-canvas.mural.co",
      "app.mural.co",
      "mcp.figma.com",
      "www.figma.com",
      "api.figma.com",
    ],
  },
});
