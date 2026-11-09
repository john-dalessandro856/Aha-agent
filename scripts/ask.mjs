#!/usr/bin/env node
// Usage: npm run ask -- "question" ["follow-up" ...]
// Runs one local agent session against Aha and prints only the final reply.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@grok", "agent-sdk", "dist", "bin", "agent-serve.js");
const messages = process.argv.slice(2).filter((m) => m.trim() !== "");

if (messages.length === 0) {
  console.error('Usage: npm run ask -- "your question about Aha records"');
  process.exit(2);
}

// Bayer's TLS inspection proxy re-signs HTTPS; Node must trust the Windows store
// or every call to bayer.aha.io fails with SELF_SIGNED_CERT_IN_CHAIN.
const nodeOptions = process.env.NODE_OPTIONS ?? "";
const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions.includes("--use-system-ca") ? nodeOptions : `${nodeOptions} --use-system-ca`.trim(),
};

const args = [cli, "run", "--dir", root, "--no-stream", "--json"];
for (const m of messages) args.push("--message", m);

const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => (stdout += d));
child.stderr.on("data", (d) => (stderr += d));

child.on("close", (code) => {
  // The CLI can print log lines before the JSON document on stdout.
  const start = stdout.search(/^\{/m);
  let result;
  try {
    result = JSON.parse(stdout.slice(start));
  } catch {
    console.error(`agent-sdk run exited ${code} without a JSON result.\n${stderr}\n${stdout}`);
    process.exit(code || 1);
  }

  if (result.error) {
    console.error(`agent-sdk error ${result.error.code}: ${result.error.message}\n${result.error.hint ?? ""}`);
    process.exit(code || 1);
  }

  const t = result.trajectory ?? {};
  for (const turn of t.turns ?? []) {
    if (turn.failed) console.error(`Turn ${turn.turnId} failed: ${turn.error ?? JSON.stringify(turn)}`);
  }
  console.error(`session ${result.sessionId}  tools=${t.toolCallCount ?? "?"}  trace ${result.trace}`);
  console.log(t.finalText ?? "");
  process.exit(result.ok ? 0 : 1);
});
