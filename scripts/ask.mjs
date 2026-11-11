#!/usr/bin/env node
// Usage: npm run ask -- "question" ["follow-up" ...]
// Runs one local agent session against Aha and prints only the final reply.
// Aha access tokens last ~2h; refresh often fails, so re-auth before the turn
// when the last successful OAuth is older than that (instead of failing mid-turn).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@grok", "agent-sdk", "dist", "bin", "agent-serve.js");
const messages = process.argv.slice(2).filter((m) => m.trim() !== "");

/** Aha MCP access tokens advertise expires_in=7200. Re-auth a few minutes early. */
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const ACCESS_TTL_SKEW_MS = 5 * 60 * 1000;

if (messages.length === 0) {
  console.error('Usage: npm run ask -- "your question about Aha or DPJ records"');
  process.exit(2);
}

// Bayer's TLS inspection proxy re-signs HTTPS; Node must trust the Windows store
// or every call to bayer.aha.io fails with SELF_SIGNED_CERT_IN_CHAIN.
const nodeOptions = process.env.NODE_OPTIONS ?? "";
const env = {
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

function hasAhaTokens() {
  try {
    const raw = JSON.parse(readFileSync(mcpAuthPath(), "utf8"));
    const tokens = raw?.aha?.tokens;
    return typeof tokens?.access_token === "string" && tokens.access_token.length > 0;
  } catch {
    return false;
  }
}

/** ms since last known-good OAuth (stamp, else mcp-auth.json mtime). */
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

function runCli(args, { inherit = false } = {}) {
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

async function ensureOauth(reason) {
  console.error(`Aha OAuth: ${reason}. Opening authorization (browser) before the ask…`);
  const result = await runCli(["mcp", "oauth", "aha", "--dir", root], { inherit: true });
  if (result.code !== 0) {
    console.error(`Aha OAuth failed (exit ${result.code}). Complete the browser sign-in and retry.`);
    process.exit(result.code || 1);
  }
  writeOauthStamp();
}

function looksLikeAuthDeny(stderr, trajectory) {
  if (/awaiting MCP auth|MCP auth deny|Reconnect aha|needs authorization/i.test(stderr)) {
    return true;
  }
  const t = trajectory ?? {};
  return (t.toolCallCount ?? 0) === 0 && !(t.finalText ?? "").trim();
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

async function runAsk() {
  const args = ["run", "--dir", root, "--no-stream", "--json"];
  for (const m of messages) args.push("--message", m);
  return runCli(args);
}

async function main() {
  const age = tokenAgeMs();
  const staleAfter = ACCESS_TTL_MS - ACCESS_TTL_SKEW_MS;
  if (!hasAhaTokens()) {
    await ensureOauth("no local Aha tokens found");
  } else if (age >= staleAfter) {
    const hours = (age / 3_600_000).toFixed(1);
    await ensureOauth(`last auth was ~${hours}h ago (Aha access tokens last ~2h)`);
  }

  let result = await runAsk();
  let parsed = parseRunOutput(result.stdout, result.code, result.stderr);
  let trajectory = parsed.trajectory ?? {};

  if (looksLikeAuthDeny(result.stderr, trajectory)) {
    await ensureOauth("ask failed with MCP auth deny / empty turn; re-authorizing");
    result = await runAsk();
    parsed = parseRunOutput(result.stdout, result.code, result.stderr);
    trajectory = parsed.trajectory ?? {};
  }

  printTrajectory(parsed);
  if (!looksLikeAuthDeny(result.stderr, trajectory) && (trajectory.toolCallCount ?? 0) > 0) {
    writeOauthStamp();
  }
  process.exit(parsed.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
