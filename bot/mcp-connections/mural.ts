import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("mural");

// Required only when this process selected Mural. Otherwise the server is
// not opened, so a missing Mural sign-in cannot abort an Aha or DPJ turn.
export default mode.active
  ? defineConnection({
      description: "Mural boards, read-only.",
      url: "https://mcp-canvas.mural.co/mcp",
      oauth: true,
      advertiseTools: true,
      optional: mode.optional,
      effects: "read",
    })
  : inactiveSource("mural");
