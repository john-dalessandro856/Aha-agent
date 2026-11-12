import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("mural");

// Mural through the Cursor account connector (Cursor Settings → Tools & MCP),
// not host OAuth. Connect it there once; the agent never opens a Mural
// browser flow.
export default mode.active
  ? defineConnection({
      description: "Mural boards via the Cursor account connector, read-only.",
      cursorAccount: true,
      servers: ["user-Mural"],
      advertiseTools: true,
      optional: mode.optional,
      effects: "read",
    })
  : inactiveSource("mural");
