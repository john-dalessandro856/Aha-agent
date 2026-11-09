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

## Answering Aha questions from this chat

When the user asks about Aha records (reference numbers like `VEL-E-3599`,
`GPG-E-128`, workspaces, epics, features), query through the served agent.
The Aha MCP tools are wired to the bot, not to this IDE chat, so do not look
for them in your own tool list, `.cursor/mcp.json`, or other config.

```bash
npm run ask -- "<the user's request, with any scope they gave>"
```

- Stdout is the agent's final reply. Stderr has the session id and trace path.
- Aha OAuth is already done on this machine. Do not run `agent-sdk login` or
  `agent-sdk mcp oauth` unless the command reports an auth error.
- The script sets `--use-system-ca`. Without it Node fails on Bayer's TLS
  proxy (`fetch failed` / `SELF_SIGNED_CERT_IN_CHAIN`).
- Multi-step analysis can take several minutes. Allow up to 15 minutes before
  backgrounding.
- Relay the reply to the user. Keep the reference numbers it cites.

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
