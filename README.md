# Aha + DPJ Agent

A read-only analysis agent for Bayer Aha and DPJ (OpenProject). It explores
and summarizes product/roadmap data and can compare with Mural when asked.
Figma stays on the IDE Figma plugin — not an agent MCP connection.

## Local setup

1. `npm install`
2. Install the DPJ and Mural plugins in Cursor for agent sources
   (`user-Dpj-openproject`, `user-Mural`). Install the Figma plugin for
   IDE-chat Figma work only. DPJ is read-only through the agent connector.

There is no separate sign-in step. When a question needs a source whose
sign-in no longer works, `ask` opens that source's sign-in page in your
browser and continues once you finish. Working sign-ins are reused
silently.

```bash
npm run connect -- --status   # report Aha/DPJ/Mural sign-ins, open nothing
npm run connect -- mural      # sign one source in now
```

`ask` opens only the systems you name. Mural stays closed unless the
question mentions it. Do not pass `figma` to `--sources`.

```bash
npm run ask -- --sources aha "Summarize Aha epic VEL-E-3599"
npm run ask -- --sources dpj "Summarize open DPJ work packages in project X"
npm run ask -- --sources aha,dpj "Compare Aha VEL-E-3599 with related DPJ work packages"
npm run ask -- --sources mural "Summarize the Mural board <url>"
agent-sdk serve --dir . --mode single --dev
```

`serve` loads every agent connection. DPJ and Mural are optional there: a
connector that is not connected is skipped instead of failing the turn.
