import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("figma");

// Figma rejects direct Agent SDK OAuth (HTTP 403). Bridge the IDE-connected
// Figma connector through the Cursor account MCP path. The identifier from
// serve preflight is `user-Figma` (IDE Tools & MCP → Figma).
export default mode.active
  ? defineConnection({
      description: "Figma files via the Cursor account connector, read-only.",
      cursorAccount: true,
      servers: ["user-Figma"],
      advertiseTools: true,
      effects: "read",
      optional: mode.optional,
    })
  : inactiveSource("figma");
