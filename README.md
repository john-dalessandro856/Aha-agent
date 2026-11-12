# Aha + DPJ Agent

A read-only analysis agent for Bayer Aha and DPJ (OpenProject). It explores
and summarizes product/roadmap data and compares it with Mural and Figma when
asked.

## Local setup

1. `npm install`
2. Aha: complete `agent-sdk mcp oauth aha --dir .` (or use `npm run ask -- --sources aha`,
   which re-auths Aha when those tokens are stale). Leave `AGENT_SOURCES` unset
   for that manual command. Aha is the only system with its own sign-in.
3. DPJ, Mural, and Figma: connect the plugins in Cursor Settings → Tools & MCP.
   The agent uses those same Cursor account connectors (`user-Dpj-openproject`,
   `user-Mural`, `user-Figma`), so there is no API key or extra OAuth. DPJ is
   read-only through that connector.

`ask` opens only the systems you name. Mural and Figma stay closed unless
the question mentions them.

```bash
npm run ask -- --sources aha "Summarize Aha epic VEL-E-3599"
npm run ask -- --sources dpj "Summarize open DPJ work packages in project X"
npm run ask -- --sources aha,dpj "Compare Aha VEL-E-3599 with related DPJ work packages"
npm run ask -- --sources mural "Summarize the Mural board <url>"
agent-sdk serve --dir . --mode single --dev
```

`serve` loads every connection. DPJ, Mural, and Figma are optional there: a
connector that is not connected is skipped instead of failing the turn.
