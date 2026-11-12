#!/usr/bin/env node
// Usage: npm run ask -- [--sources aha,dpj,mural,figma] "question" ["follow-up" ...]
// Runs one local agent session and prints only the final reply.
//
// Each name is an independent MCP connection. This script sets AGENT_SOURCES
// so the process does not open, or request OAuth for, a system the question
// did not select. Aha is the only host OAuth connection: its access tokens
// last ~2h and refresh often fails, so re-auth Aha before the turn only when
// Aha is selected and the last successful OAuth is older than that. DPJ,
// Mural, and Figma ride Cursor account connectors (the IDE's sign-in).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@grok", "agent-sdk", "dist", "bin", "agent-serve.js");
const SOURCE_NAMES = ["aha", "dpj", "mural", "figma"];
const OAUTH_SOURCES = new Set(["aha"]);

/** Aha MCP access tokens advertise expires_in=7200. Re-auth a few minutes early. */
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const ACCESS_TTL_SKEW_MS = 5 * 60 * 1000;

const argv = process.argv.slice(2);

// Bayer's TLS inspection proxy re-signs HTTPS; Node must trust the Windows store
// or every call to bayer.aha.io fails with SELF_SIGNED_CERT_IN_CHAIN.
const nodeOptions = process.env.NODE_OPTIONS ?? "";
const baseEnv = {
  ...process.env,
  NODE_OPTIONS: nodeOptions.includes("--use-system-ca") ? nodeOptions : `${nodeOptions} --use-system-ca`.trim(),
};

function configDir() {
  return (
    process.env.AGENT_SERVE_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "agent-serve")
  );
}

function stampPath() {
  return join(configDir(), "aha-oauth-refreshed-at");
}

function mcpAuthPath() {
  return join(configDir(), "mcp-auth.json");
}

function hasTokens(name) {
  try {
    const raw = JSON.parse(readFileSync(mcpAuthPath(), "utf8"));
    const tokens = raw?.[name]?.tokens;
    return typeof tokens?.access_token === "string" && tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

/** ms since last known-good Aha OAuth (stamp, else mcp-auth.json mtime). */
function tokenAgeMs() {
  const stamp = stampPath();
  if (existsSync(stamp)) {
    try {
      const t = Date.parse(readFileSync(stamp, "utf8").trim());
      if (Number.isFinite(t)) return Date.now() - t;
    } catch {
      // fall through to mcp-auth mtime
    }
  }
  try {
    return Date.now() - statSync(mcpAuthPath()).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function writeOauthStamp() {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(stampPath(), `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
}

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

function runCli(args, { inherit = false, sources } = {}) {
  const env = { ...baseEnv };
  if (sources === undefined) delete env.AGENT_SOURCES;
  else env.AGENT_SOURCES = sources.join(",");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!inherit) {
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const ACCOUNT_CONNECTORS = { dpj: "user-Dpj-openproject", mural: "user-Mural", figma: "user-Figma" };

function nonOauthHint(source) {
  const connector = ACCOUNT_CONNECTORS[source];
  if (connector === undefined) return `${source} is not an OAuth connection.`;
  return `${source} uses the Cursor account connector ${connector}, not agent-sdk OAuth. Connect it in Cursor Settings → Tools & MCP (or https://cursor.com/dashboard/integrations).`;
}

async function ensureOauth(source, reason) {
  if (!OAUTH_SOURCES.has(source)) {
    console.error(`${source}: ${reason}. ${nonOauthHint(source)}`);
    process.exit(1);
  }
  console.error(`${source} OAuth: ${reason}. Opening authorization (browser) before the ask…`);
  const result = await runCli(["mcp", "oauth", source, "--dir", root], { inherit: true });
  if (result.code !== 0) {
    console.error(`${source} OAuth failed (exit ${result.code}). Complete the browser sign-in and retry.`);
    process.exit(result.code || 1);
  }
  if (source === "aha") writeOauthStamp();
}

function reconnectSource(stderr) {
  const match = /Reconnect ([A-Za-z0-9_-]+)/i.exec(stderr ?? "");
  if (!match) return null;
  const name = match[1].toLowerCase();
  return SOURCE_NAMES.includes(name) ? name : null;
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
  return t;
}

async function runAsk(messages, sources) {
  const args = ["run", "--dir", root, "--no-stream", "--json"];
  for (const m of messages) args.push("--message", m);
  return runCli(args, { sources });
}

async function preflight(sources) {
  if (sources.includes("aha")) {
    const age = tokenAgeMs();
    const staleAfter = ACCESS_TTL_MS - ACCESS_TTL_SKEW_MS;
    if (!hasTokens("aha")) {
      await ensureOauth("aha", "no local Aha tokens found");
    } else if (age >= staleAfter) {
      const hours = (age / 3_600_000).toFixed(1);
      await ensureOauth("aha", `last auth was ~${hours}h ago (Aha access tokens last ~2h)`);
    }
  }
}

async function main() {
  const { messages, sources, explicit } = parseInvocation(argv);
  console.error(`sources: ${sources.join(", ")} (${explicit ? "explicit" : "inferred"})`);
  await preflight(sources);

  let result = await runAsk(messages, sources);
  let parsed = parseRunOutput(result.stdout, result.code, result.stderr);
  const denied = reconnectSource(result.stderr);
  if (denied !== null && sources.includes(denied) && OAUTH_SOURCES.has(denied)) {
    await ensureOauth(denied, "ask failed because this connection needs authorization");
    result = await runAsk(messages, sources);
    parsed = parseRunOutput(result.stdout, result.code, result.stderr);
  } else if (denied !== null && sources.includes(denied)) {
    console.error(nonOauthHint(denied));
  }

  const trajectory = printTrajectory(parsed);
  if (sources.includes("aha") && (trajectory.toolCallCount ?? 0) > 0 && !reconnectSource(result.stderr)) {
    writeOauthStamp();
  }
  process.exit(parsed.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
