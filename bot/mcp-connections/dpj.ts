import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("dpj");

// Bayer DPJ (OpenProject) through the Cursor account connector that backs
// the IDE plugin (Cursor Settings → Tools & MCP). Same sign-in as the IDE;
// no OPENPROJECT_API_KEY on this host. The connector is read-only.
export default mode.active
  ? defineConnection({
      description: "DPJ (OpenProject) via the Cursor account connector, read-only.",
      cursorAccount: true,
      servers: ["user-Dpj-openproject"],
      advertiseTools: true,
      optional: mode.optional,
    })
  : inactiveSource("dpj");
