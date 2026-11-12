import { defineConnection } from "@grok/agent-sdk/connections";
import { inactiveSource } from "../lib/inactive-source";
import { sourceMode } from "../lib/sources";

const mode = sourceMode("aha");

export default mode.active
  ? defineConnection({
      description: "Aha (bayer.aha.io), read-only.",
      url: "https://bayer.aha.io/api/v1/mcp",
      oauth: true,
      advertiseTools: true,
      optional: mode.optional,
      effects: "read",
    })
  : inactiveSource("aha");
