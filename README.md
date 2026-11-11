# Aha + DPJ Agent

An analysis agent for Bayer Aha and DPJ (OpenProject). It explores and
summarizes product/roadmap data, compares with Mural and Figma when asked, and
can create or update DPJ work packages.

## Local setup

1. `npm install`
2. Aha: complete `agent-sdk mcp oauth aha --dir .` (or use `npm run ask`, which
   re-auths when tokens are stale).
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

```bash
npm run ask -- "Summarize open DPJ work packages in project X"
npm run ask -- "Compare Aha VEL-E-3599 with related DPJ work packages"
agent-sdk serve --dir . --mode single --dev
```
