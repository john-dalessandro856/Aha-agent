import type { ConnectorCapability, SystemId } from "./types";

export class MutationBlockedError extends Error {
  constructor(system: string, tool: string) {
    super(`Blocked ${system}.${tool}: Ramirez runs in PROPOSAL_ONLY mode and calls only allowlisted read tools.`);
    this.name = "MutationBlockedError";
  }
}

/**
 * The only connector tools Ramirez code may call. Every entry is a read in
 * the connector's own schema or in observed use. Anything else is refused
 * before a request leaves the host.
 */
export const READ_TOOL_ALLOWLIST: Record<"aha" | "dpj" | "mural", readonly string[]> = {
  aha: ["read_records", "search_records"],
  dpj: ["search_work_packages"],
  mural: ["search_murals", "get_mural_info", "get_canvas_overview", "get_document_tree", "list_widgets"],
};

export function assertReadTool(system: "aha" | "dpj" | "mural", tool: string): void {
  const base = tool.replace(/^user-[A-Za-z0-9]+-[A-Za-z0-9]+-/, "");
  if (!READ_TOOL_ALLOWLIST[system].includes(base)) throw new MutationBlockedError(system, tool);
}

export type DeclaredTool = {
  name: string;
  declared: "DECLARED_READ" | "DECLARED_WRITE" | "UNDECLARED";
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  summary?: string;
};

const WRITE_NAME = /^(create|update|delete|remove|add|set|move|lock|unlock|invite|rename|send|upload|generate|use_|manage|weave_run|weave_cancel|weave_upload)/;

/** Classifies a tool from its declaration only. Fails closed: no hint is not a read. */
export function classifyDeclaredTool(name: string, annotations: Record<string, unknown> | undefined, description?: string): DeclaredTool {
  const readOnly = annotations?.readOnlyHint;
  const destructive = annotations?.destructiveHint;
  const base = name.replace(/^user-[A-Za-z0-9]+-[A-Za-z0-9]+-/, "");
  let declared: DeclaredTool["declared"] = "UNDECLARED";
  if (readOnly === true) declared = "DECLARED_READ";
  else if (readOnly === false || destructive === true || WRITE_NAME.test(base)) declared = "DECLARED_WRITE";
  return {
    name,
    declared,
    ...(typeof readOnly === "boolean" ? { readOnlyHint: readOnly } : {}),
    ...(typeof destructive === "boolean" ? { destructiveHint: destructive } : {}),
    ...(description ? { summary: description.slice(0, 120) } : {}),
  };
}

/** Static capability declarations from Phase 0 discovery. */
export const CAPABILITIES: Record<SystemId, ConnectorCapability> = {
  aha: {
    system: "aha",
    connection: "aha",
    adapter: "PRODUCTION",
    verifiedReads: ["read_records (shape observed in local traces)", "search_records (shape observed in local traces)"],
    unverifiedReads: ["read_records not-found response shape", "record_type inference from reference format"],
    declaredButUnusedWrites: ["manage_report (observed callable; excluded from the connection)"],
    notes: ["Host OAuth against bayer.aha.io. Integration fields expose Azure DevOps (service_name vsts) links; no DPJ integration field observed."],
  },
  dpj: {
    system: "dpj",
    connection: "dpj",
    adapter: "PRODUCTION",
    verifiedReads: ["search_work_packages (static schema: id, subject, project_id, status_id, type_id, assigned_to_id, version_id filters)"],
    unverifiedReads: ["live search_work_packages output (not yet observed in this repo)", "custom field that stores an Aha reference (none identified)"],
    declaredButUnusedWrites: ["REST writes via .cursor/skills/dpj-write-records (IDE chat only; never bound into Ramirez)"],
    notes: ["Cursor account connector, read-only plugin. Subject filter is a partial, case-insensitive match; descriptions are not searchable."],
  },
  mural: {
    system: "mural",
    connection: "mural",
    adapter: "PRODUCTION",
    verifiedReads: [
      "search_murals (title match; live: MMC Bi-Weekly → bayer1789.1771356982650)",
      "get_mural_info (live: title, member_url, dimensions, last_updated)",
      "get_canvas_overview (live: widget counts by type, area titles)",
      "get_document_tree view=compact (live: sticky text under area root_id)",
    ],
    unverifiedReads: ["list_widgets (schema known; not required for board-level normalize)", "get_widget_by_id"],
    declaredButUnusedWrites: ["create_*, update_*, delete_*, lock/unlock, tag, outline, invite tools (not on Ramirez allowlist)"],
    notes: [
      "Cursor account connector. No research-to-planning identifier convention known.",
      "Ramirez normalizes board metadata; sticky content is evidence context, not identity.",
    ],
  },
  figma: {
    system: "figma",
    connection: null,
    adapter: "INTERFACE_ONLY",
    verifiedReads: [
      "whoami (live: Bayer View seat)",
      "create_session + get_metadata pages list (live: Product-Profiles Mfpvi8EkGRio9wuSXi5ZzS)",
      "get_metadata node subtree + get_screenshot (live: Portfolio Main 2588:718438, Profile Main 250:554914)",
      "get_comments (live: Product-Profiles)",
    ],
    unverifiedReads: ["get_design_context (available; not used for normalize)"],
    declaredButUnusedWrites: ["use_figma, create_new_file, upload_assets, send_code_to_figma, generate_* (IDE plugin)"],
    notes: [
      "Figma is IDE-plugin only by repo policy; no agent MCP connection.",
      "normalizeFigmaNode / parseFigmaUrl normalize chat-side reads; Ramirez never opens Figma itself.",
      "No file titled Product Parentage Outline found; Aha parentage epics link Product-Profiles Portfolio (Products & Parentage).",
    ],
  },
  azure_devops: {
    system: "azure_devops",
    connection: null,
    adapter: "INTERFACE_ONLY",
    verifiedReads: [],
    unverifiedReads: ["work-item reads (no Azure DevOps connector available)"],
    declaredButUnusedWrites: [],
    notes: ["Aha integration fields (vsts) carry Azure DevOps work-item IDs and URLs; Ramirez reports them as links with NOT_RETRIEVED targets."],
  },
  github: {
    system: "github",
    connection: null,
    adapter: "INTERFACE_ONLY",
    verifiedReads: [],
    unverifiedReads: ["issues, PRs, commits (GitHub plugin status errored during discovery)"],
    declaredButUnusedWrites: [],
    notes: [],
  },
};
