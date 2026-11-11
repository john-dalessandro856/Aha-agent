# Aha-agent

Agent SDK project (`@grok/agent-sdk`). This file is
for coding agents editing the project. The served agent's prompt is
`bot/instructions.md`.

## Loop

```bash
agent-sdk validate --dir .
agent-sdk info --dir . --json
agent-sdk run --dir . --message "..."
agent-sdk eval --dir .
npm run check
```

Run the CLI under Node, never Bun.

## Answering Aha / Mural / Figma questions from this chat

When the user asks about Aha records (reference numbers like `VEL-E-3599`,
`GPG-E-128`, workspaces, epics, features), Mural boards, Figma files, or a
comparison across those systems, query through the served agent. The Aha,
Mural, and Figma MCP tools are wired to the bot, not to this IDE chat, so do
not look for them in your own tool list, `.cursor/mcp.json`, or other config.

```bash
npm run ask -- "<the user's request, with any scope they gave>"
```

- Stdout is the agent's final reply. Stderr has the session id and trace path.
- `ask` re-auths Aha before the turn when local tokens are missing or older
  than ~2 hours (Aha access tokens expire then; refresh often fails). If the
  browser OAuth prompt appears, finish it; do not dry-run around it. Outside
  `ask`, run `agent-sdk mcp oauth aha --dir .` only on an auth error — skip
  `--dry-run` for that recovery path.
- First-time Mural access (or after token loss):
  `agent-sdk mcp oauth mural --dir .`. Skip `--dry-run`. Finish the browser
  sign-in.
- Figma: Figma rejects direct Agent SDK OAuth (HTTP 403). Enable the Figma
  IDE plugin and Connect it in Cursor Settings → Tools & MCP. The agent
  bridges that connector as `user-Figma` via
  `defineConnection({ cursorAccount: true, servers: ["user-Figma"] })`.
  If serve logs `HTTP 429` rate limiting on `user-Figma`, wait and retry.
- The script sets `--use-system-ca`. Without it Node fails on Bayer's TLS
  proxy (`fetch failed` / `SELF_SIGNED_CERT_IN_CHAIN`).
- Multi-step analysis can take several minutes. Allow up to 15 minutes before
  backgrounding.
- Relay the reply to the user. Keep the reference numbers, mural URLs, and
  Figma URLs it cites.

## Layout

- `bot/instructions.md` is the always-on prompt. Keep it short.
- `bot/tools/<name>.ts` is one tool per file. The filename is the tool name.
- `bot/lib/` is shared code. Never discovered.
- `evals/` is filesystem evals (`evals/evals.config.ts` required).
  Not `bot/evals/`. That path is ignored.

## Do not

- Grow host TypeScript for formatting, classification, or reply composition.
  That stays in instructions/skills. Host code owns auth, idempotency,
  evidence seeding, and side-effect gates.
- Add npm deps on a first cut. Stick to what `@grok/agent-sdk` already ships.
- Point `serve` at a parent folder during bring-up. It mounts every sibling.

## Pointers

- Package loop: `node_modules/@grok/agent-sdk/AGENTS.md`
- Skills: `node_modules/@grok/agent-sdk/skills/` (`create-agent`, `deploy`, `evals`, `hillclimb`, `debug`)
- Docs: `npx @grok/agent-sdk docs`
- LLM docs index: `node_modules/@grok/agent-sdk/dist/docs/llms.txt`
