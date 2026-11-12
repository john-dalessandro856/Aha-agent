#!/usr/bin/env node
// Usage: npm run ask -- [--sources aha,dpj,mural,figma] "question" ["follow-up" ...]
// Runs one local agent session and prints only the final reply.
//
// Each name is an independent MCP connection. This script sets AGENT_SOURCES
// so the process opens only the systems the question selected. Before the
// turn it checks just those sign-ins, silently; a browser sign-in page opens
// only for a source whose sign-in no longer works (scripts/lib/connectors.mjs).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectors, SOURCE_NAMES } from "./lib/connectors.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bayer's TLS inspection proxy re-signs HTTPS; Node must trust the Windows store
// or every call to bayer.aha.io fails with SELF_SIGNED_CERT_IN_CHAIN.
const nodeOptions = process.env.NODE_OPTIONS ?? "";
const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions.includes("--use-system-ca") ? nodeOptions : `${nodeOptions} --use-system-ca`.trim(),
};

const connectors = createConnectors({ root, env });

function usage() {
  console.error(
    'Usage: npm run ask -- [--sources aha,dpj,mural,figma] "your question"\n' +
      "Omit --sources to infer them from the question. Mural and Figma are not inferred unless named.",
  );
}

function parseInvocation(args) {
  const messages = [];
  let explicit = false;
  const requested = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sources" || arg === "--source") {
      explicit = true;
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        usage();
        process.exit(2);
      }
      requested.push(...value.split(/[,+]/));
      continue;
    }
    if (arg.startsWith("--sources=")) {
      explicit = true;
      requested.push(...arg.slice("--sources=".length).split(/[,+]/));
      continue;
    }
    messages.push(arg);
  }
  const cleaned = messages.map((m) => m.trim()).filter((m) => m !== "");
  if (cleaned.length === 0) {
    usage();
    process.exit(2);
  }
  const sources = explicit ? normalizeSources(requested) : inferSources(cleaned.join("\n"));
  if (sources.length === 0) {
    console.error(`--sources must list one or more of: ${SOURCE_NAMES.join(", ")}`);
    process.exit(2);
  }
  return { messages: cleaned, sources, explicit };
}

function normalizeSources(parts) {
  const selected = [];
  for (const part of parts) {
    const name = part.trim().toLowerCase();
    if (name === "") continue;
    if (!SOURCE_NAMES.includes(name)) {
      console.error(`Unknown source "${part}". Expected one of: ${SOURCE_NAMES.join(", ")}`);
      process.exit(2);
    }
    if (!selected.includes(name)) selected.push(name);
  }
  return selected;
}

function inferSources(text) {
  const selected = [];
  const add = (name) => {
    if (!selected.includes(name)) selected.push(name);
  };
  if (/\bmural\b|mural\.co/i.test(text)) add("mural");
  if (/\bfigma\b|figma\.com/i.test(text)) add("figma");
  if (/\bdpj\b|\bopenproject\b|work package/i.test(text)) add("dpj");
  if (/\baha\b|bayer\.aha\.io|\b[A-Z]{2,12}-[A-Z]+-\d+\b/.test(text)) add("aha");
  if (selected.length === 0) add("aha");
  return selected;
}

/** The source a turn stopped on for authorization, if any. */
function authBlockedSource(stderr, sources) {
  const patterns = [
    /Reconnect ([A-Za-z0-9_-]+)/i,
    /MCP connection "?([A-Za-z0-9_-]+)"? needs authorization/i,
    /skipping optional MCP connection ([A-Za-z0-9_-]+): authorization required/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(stderr ?? "");
    const name = match?.[1]?.toLowerCase();
    if (name !== undefined && sources.includes(name)) return name;
  }
  return null;
}

function parseRunOutput(stdout, code, stderr) {
  const start = stdout.search(/^\{/m);
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    console.error(`agent-sdk run exited ${code} without a JSON result.\n${stderr}\n${stdout}`);
    process.exit(code || 1);
  }
  if (parsed.error) {
    console.error(
      `agent-sdk error ${parsed.error.code}: ${parsed.error.message}\n${parsed.error.hint ?? ""}`,
    );
    process.exit(code || 1);
  }
  return parsed;
}

function printTrajectory(parsed) {
  const t = parsed.trajectory ?? {};
  for (const turn of t.turns ?? []) {
    if (turn.failed) console.error(`Turn ${turn.turnId} failed: ${turn.error ?? JSON.stringify(turn)}`);
  }
  console.error(`session ${parsed.sessionId}  tools=${t.toolCallCount ?? "?"}  trace ${parsed.trace}`);
  console.log(t.finalText ?? "");
}

async function runAsk(messages, sources) {
  const args = ["run", "--dir", root, "--no-stream", "--json"];
  for (const m of messages) args.push("--message", m);
  return connectors.runCli(args, { sources });
}

async function main() {
  const { messages, sources, explicit } = parseInvocation(process.argv.slice(2));
  console.error(`sources: ${sources.join(", ")} (${explicit ? "explicit" : "inferred"})`);
  for (const source of sources) await connectors.ensure(source);

  let result = await runAsk(messages, sources);
  const blocked = authBlockedSource(result.stderr, sources);
  if (blocked !== null) {
    await connectors.ensure(blocked);
    result = await runAsk(messages, sources);
  }
  const parsed = parseRunOutput(result.stdout, result.code, result.stderr);
  printTrajectory(parsed);
  process.exit(parsed.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
