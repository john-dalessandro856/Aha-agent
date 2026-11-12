// Which MCP connections this process may contact.
//
// `ask` sets AGENT_SOURCES (comma-separated: aha, dpj, mural, figma).
// An unset value means serve / eval / a direct `agent-sdk run`: every
// connection stays available, but Mural, Figma, and DPJ are optional so a
// missing token cannot abort an Aha turn.
//
// A name left out of AGENT_SOURCES is not advertised and does not open
// that server. `mcp oauth aha` must run with AGENT_SOURCES unset so the
// connection file still exports the real server. DPJ, Mural, and Figma
// use Cursor account connectors and have no host OAuth.

export const SOURCE_NAMES = ["aha", "dpj", "mural", "figma"] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];

const OPTIONAL_WHEN_ALL: ReadonlySet<SourceName> = new Set(["dpj", "mural", "figma"]);

export type SourceMode =
  | { active: true; optional: boolean }
  | { active: false };

export function sourceMode(name: SourceName): SourceMode {
  const raw = process.env.AGENT_SOURCES?.trim();
  if (raw === undefined || raw === "" || raw === "all" || raw === "*") {
    return { active: true, optional: OPTIONAL_WHEN_ALL.has(name) };
  }
  const selected = new Set(
    raw
      .split(/[,+\s]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => (SOURCE_NAMES as readonly string[]).includes(part)),
  );
  if (!selected.has(name)) return { active: false };
  return { active: true, optional: false };
}
