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

## Answering Aha / DPJ / Mural / Figma questions from this chat

Call only the systems the question names. Aha, DPJ, Mural, and Figma are
independent. Do not authorize or query one to unblock another.

| Question needs | Call |
| --- | --- |
| Aha records (`VEL-E-3599`, workspaces, epics, features) | `npm run ask -- --sources aha "<question>"` |
| DPJ / OpenProject reads | The IDE OpenProject plugin in this chat. Do not start `ask` for a read. |
| DPJ writes (create, update, relate, comment, close) | The `dpj-write-records` skill (`.cursor/skills/dpj-write-records/`). Dry-run until `--apply`. |
| Mural only | The IDE Mural plugin in this chat. |
| Figma only | The IDE Figma plugin in this chat. Do not run `agent-sdk mcp oauth` for Figma. |
| A comparison that includes Aha | `npm run ask -- --sources aha,dpj` (add `mural` or `figma` only when that comparison includes them) |

`ask` sets `AGENT_SOURCES` for that process. Connections left out are not
opened. Omit `--sources` and the script infers them from the question; Mural
and Figma are included only when the question names them. With no signal it
uses Aha only.

The agent has its own sign-in for Aha only. DPJ, Mural, and Figma use the
Cursor account connectors that back the IDE plugins, so they share the
IDE's sign-in:

| Source | Agent connection | Auth |
| --- | --- | --- |
| Aha | `bayer.aha.io` MCP | Host OAuth (`agent-sdk mcp oauth aha`) |
| DPJ | `user-Dpj-openproject` | Cursor account, read-only |
| Mural | `user-Mural` | Cursor account |
| Figma | `user-Figma` | Cursor account |

- Stdout is the agent's final reply. Stderr has the sources, session id, and
  trace path.
- `ask` re-auths Aha only when Aha is selected and local tokens are missing
  or older than ~2 hours (Aha access tokens expire then; refresh often
  fails). If the browser OAuth prompt appears, finish it; do not dry-run
  around it. Outside `ask`, run `agent-sdk mcp oauth aha` only after an Aha
  auth error — skip `--dry-run`. Run that command with `AGENT_SOURCES`
  unset.
- Never run `agent-sdk mcp oauth` for DPJ, Mural, or Figma. When serve shows
  one of their connectors as "Connect" or failing, connect it in Cursor
  Settings → Tools & MCP or https://cursor.com/dashboard/integrations.
- The agent cannot write to DPJ. DPJ writes go through the
  `dpj-write-records` skill in this chat.
- If serve logs `HTTP 429` on `user-Figma`, Figma is rate limiting the
  account. Wait and retry.
- The script sets `--use-system-ca`. Without it Node fails on Bayer's TLS
  proxy (`fetch failed` / `SELF_SIGNED_CERT_IN_CHAIN`). Put the same flag
  on a manual `mcp oauth` command.
- Multi-step analysis can take several minutes. Allow up to 15 minutes
  before backgrounding.
- Relay the reply to the user. Keep the Aha references, DPJ work package
  IDs, mural URLs, and Figma URLs it cites.

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
