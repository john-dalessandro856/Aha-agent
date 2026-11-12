# Aha + DPJ Agent

An analysis agent for Bayer Aha and DPJ (OpenProject). It explores and
summarizes product/roadmap data, compares with Mural and Figma when asked, and
can create or update DPJ work packages.

## Local setup

1. `npm install`
2. Aha: complete `agent-sdk mcp oauth aha --dir .` (or use `npm run ask -- --sources aha`,
   which re-auths Aha when those tokens are stale). Leave `AGENT_SOURCES` unset
   for that manual command.
3. DPJ: set a personal API token:

   ```bash
   # .env.local (gitignored) or your shell profile
   OPENPROJECT_URL=https://dpj.int.bayer.com
   OPENPROJECT_API_KEY=your-token
   ```

   Create the token in DPJ → Avatar → Account settings → Access tokens → API.
4. Optional IDE plugin: enable the Bayer marketplace **DPJ (aka OpenProject)**
   / `openproject` plugin and configure the same `OPENPROJECT_API_KEY` so this
   Cursor chat can use DPJ MCP directly. The served agent uses
   `bot/mcp-connections/dpj.ts` instead.

`ask` opens only the systems you name. Mural and Figma stay closed unless
the question mentions them, so a missing Mural sign-in does not block Aha.

```bash
npm run ask -- --sources aha "Summarize Aha epic VEL-E-3599"
npm run ask -- --sources dpj "Summarize open DPJ work packages in project X"
npm run ask -- --sources aha,dpj "Compare Aha VEL-E-3599 with related DPJ work packages"
npm run ask -- --sources mural "Summarize the Mural board <url>"
agent-sdk serve --dir . --mode single --dev
```

`serve` still loads every connection. Mural, Figma, and DPJ are optional
there: a missing token is skipped instead of failing the turn. Authorize
Mural only when you need it: `agent-sdk mcp oauth mural --dir .` (with
`AGENT_SOURCES` unset).
