// Sign-in for the agent's sources, done only for the sources a turn
// selected and only when the existing sign-in no longer works.
//
// - Aha is host OAuth. A zero-token tool listing lets the SDK reuse or
//   refresh the saved token silently. Only when that fails does the browser
//   open (`agent-sdk mcp oauth aha`).
// - DPJ and Mural are Cursor account connectors. A status read checks
//   them silently. Only a connector that needs authorization gets a
//   minted sign-in URL, opened in the browser, then polled until Cursor
//   stores the token.
// - Figma is not an agent source; use the IDE Figma plugin in chat.
//
// The account calls use @grok/agent-sdk internals (not in its public
// exports). Recheck these imports after an SDK upgrade.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_NAMES = ["aha", "dpj", "mural"];

/** Cursor account connector behind each IDE plugin. Must match bot/mcp-connections. */
export const ACCOUNT_CONNECTORS = {
  dpj: "user-Dpj-openproject",
  mural: "user-Mural",
};

const POLL_START_MS = 3_000;
const POLL_MAX_MS = 15_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function createConnectors({ root, env, log = (line) => console.error(line) }) {
  const cli = join(root, "node_modules", "@grok", "agent-sdk", "dist", "bin", "agent-serve.js");
  const internal = (rel) =>
    import(pathToFileURL(join(root, "node_modules", "@grok", "agent-sdk", "dist", "internal", rel)).href);

  function runCli(args, { sources, inherit = false } = {}) {
    const childEnv = { ...env };
    if (sources === undefined) delete childEnv.AGENT_SOURCES;
    else childEnv.AGENT_SOURCES = sources.join(",");
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], {
        cwd: root,
        env: childEnv,
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

  // ---- Aha (host OAuth) -------------------------------------------------

  /** Lists Aha tools without a model turn. The SDK refreshes the token if it can. */
  async function ahaStatus() {
    const result = await runCli(["tool", "call", "__probe__", "--dir", root, "--json"], { sources: ["aha"] });
    const text = `${result.stdout}\n${result.stderr}`;
    if (/needs authorization|Reconnect aha|mcp oauth aha/i.test(text)) return "needsAuth";
    if (/"error":\s*"unknown_tool"/.test(text)) return "connected";
    return "error";
  }

  async function signInAha() {
    log("Aha: sign-in needed. Opening the Aha sign-in page in your browser…");
    const result = await runCli(["mcp", "oauth", "aha", "--dir", root], { inherit: true });
    if (result.code !== 0) throw new Error("Aha sign-in did not finish. Run `npm run connect -- aha` to try again.");
    log("Aha: signed in ✓");
  }

  // ---- Cursor account connectors ----------------------------------------

  let clientPromise;
  async function accountClient() {
    clientPromise ??= (async () => {
      const [{ resolveApiKey, cursorBackendUrl }, { CursorBackendClient }] = await Promise.all([
        internal("cursor/credentials.js"),
        internal("cursor/backend-client.js"),
      ]);
      const key = await resolveApiKey({});
      if (key === undefined) {
        throw new Error("Not signed in to Cursor. Run `agent-sdk login` once, then retry.");
      }
      return new CursorBackendClient({ backendUrl: key.backendUrl ?? cursorBackendUrl(), apiKey: key.apiKey });
    })();
    return clientPromise;
  }

  async function accountStatus(source) {
    const identifier = ACCOUNT_CONNECTORS[source];
    const client = await accountClient();
    const [server] = await client.listAccountMcpTools([identifier]);
    if (server === undefined) return "missing";
    if (server.status === "connected") return "connected";
    if (server.status === "needsAuth") return "needsAuth";
    return server.status ?? "error";
  }

  async function signInAccount(source) {
    const identifier = ACCOUNT_CONNECTORS[source];
    const client = await accountClient();
    const [{ mcpOauthRedirectUri }, { openBrowser }] = await Promise.all([
      internal("cursor-account-mcp-auth.js"),
      internal("mcp-oauth.js"),
    ]);
    const servers = await client.getAvailableMcpServers();
    const wanted = identifier.toLowerCase();
    const server = servers.find(
      (s) => s.serverIdentifier?.toLowerCase() === wanted || s.name.toLowerCase() === wanted,
    );
    if (server === undefined) {
      throw new Error(`${source}: ${identifier} is not on this Cursor account. Install the ${source} plugin in Cursor first.`);
    }
    const redirectUri = mcpOauthRedirectUri();
    const check = (userInitiated) =>
      client
        .checkHttpMcpStatus({ serverIds: [server.id], oauthRedirectUri: redirectUri, userInitiated })
        .then((statuses) => statuses.find((s) => s.id === server.id));

    const status = await check(true);
    if (status === undefined || !status.requiresAuth) {
      log(`${source}: signed in ✓`);
      return;
    }
    const authUrl = status.authUrl?.trim() ?? "";
    if (authUrl === "") {
      throw new Error(`${source}: Cursor did not return a sign-in page${status.error ? ` (${status.error})` : ""}.`);
    }
    log(`${source}: sign-in needed. Opening the ${source} sign-in page in your browser…`);
    log(`  If it does not open: ${authUrl}`);
    openBrowser(authUrl);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let wait = POLL_START_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 1.5, POLL_MAX_MS);
      try {
        const next = await check(false);
        if (next !== undefined && !next.requiresAuth) {
          log(`${source}: signed in ✓`);
          return;
        }
      } catch {
        // Transient backend errors; keep polling until the deadline.
      }
    }
    throw new Error(`${source}: sign-in was not finished within 5 minutes. Run \`npm run connect -- ${source}\` to try again.`);
  }

  // ---- Shared -----------------------------------------------------------

  async function status(source) {
    return source === "aha" ? ahaStatus() : accountStatus(source);
  }

  /** Silent when the sign-in works; opens the browser only when it does not. */
  async function ensure(source) {
    const state = await status(source);
    if (state === "connected") return;
    if (state === "missing") {
      throw new Error(`${source}: ${ACCOUNT_CONNECTORS[source]} is not on this Cursor account. Install the ${source} plugin in Cursor first.`);
    }
    if (state !== "needsAuth") {
      log(`${source}: status "${state}". Continuing.`);
      return;
    }
    if (source === "aha") await signInAha();
    else await signInAccount(source);
  }

  return { status, ensure, runCli };
}
