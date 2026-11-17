import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { classifyDeclaredTool, type DeclaredTool } from "../lib/ramirez/capabilities";

export default defineTool({
  description:
    "List the tools each loaded connection declares (names and MCP annotations only) and classify each as a declared read or declared write. Never calls a connector tool and never reads a record.",
  inputSchema: z.object({
    connections: z.array(z.string()).optional().describe("Connection names (aha, dpj, mural). Defaults to every loaded connection."),
  }),
  effect: "read",
  async execute({ connections }, ctx) {
    const loaded = ctx.host.mcp.names();
    const names = connections?.length ? connections.filter((n) => loaded.includes(n)) : loaded;
    const result: Record<string, { state: string; tools: DeclaredTool[]; error?: string }> = {};
    for (const name of names) {
      try {
        const tools = await ctx.host.mcp.listTools(name);
        result[name] = {
          state: tools.length > 0 ? "AVAILABLE" : "NOT_AVAILABLE",
          tools: tools.map((t) => classifyDeclaredTool(t.name, t.annotations as Record<string, unknown> | undefined, t.description)),
        };
      } catch (err) {
        result[name] = { state: "INACCESSIBLE", tools: [], error: err instanceof Error ? err.message.slice(0, 200) : "listing failed" };
      }
    }
    return { mutationMode: "PROPOSAL_ONLY", loadedConnections: loaded, connections: result };
  },
});
