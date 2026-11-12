import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("dpj");

// Bayer DPJ (OpenProject). Auth is a personal API token with MCP scope —
// same value as OPENPROJECT_API_KEY used by the Bayer openproject plugin.
// Do not set effects: "read"; create/update tools must stay available.
export default mode.active
  ? defineConnection({
      description: "DPJ (OpenProject) at dpj.int.bayer.com.",
      url: "https://dpj.int.bayer.com/mcp",
      headers: {
        Authorization: "Bearer ${OPENPROJECT_API_KEY}",
        Accept: "application/json, text/event-stream",
      },
      advertiseTools: true,
      optional: mode.optional,
    })
  : inactiveSource("dpj");
