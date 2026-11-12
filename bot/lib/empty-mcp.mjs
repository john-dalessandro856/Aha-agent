// Stdio MCP server with no tools. `ask` points unselected connections here
// so the process never opens Aha, DPJ, Mural, or Figma for a system the
// question did not select. Speaks newline-delimited JSON-RPC, same framing
// as @modelcontextprotocol/sdk stdio.
import { createInterface } from "node:readline";

const name = process.argv[2] ?? "inactive";
const input = createInterface({ input: process.stdin, terminal: false });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: `${name}-not-loaded`, version: "0.0.0" },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
    return;
  }

  if (message.method === "ping") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  send({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  });
});
