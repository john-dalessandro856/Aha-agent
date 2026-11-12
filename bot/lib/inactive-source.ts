import { defineConnection } from "@grok/agent-sdk/connections";
import { join } from "node:path";

const script = join(import.meta.dirname, "empty-mcp.mjs");

// Stand-in for a connection this process did not select. Advertised so the
// real server is not attached, and it lists no tools, so the model cannot
// call that system. Nothing leaves this machine.
export function inactiveSource(name: string) {
  return defineConnection({
    description: `${name} was not selected for this process.`,
    command: process.execPath,
    args: [script, name],
    advertiseTools: true,
    optional: true,
  });
}
