// Normalizes Mural board metadata and canvas overview into a Ramirez Artifact.
// Field names follow shapes observed from the IDE Mural plugin in live reads
// (get_mural_info, get_canvas_overview, search_murals).
import { excerpt } from "../redact";
import type { Artifact, Field, Provenance } from "../types";

type Obj = Record<string, unknown>;
const ADAPTER = "mural-mcp-read@1";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : undefined;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type MuralAreaSummary = { id: string; title: string };
export type MuralOverview = {
  totalWidgets?: number;
  byType?: Record<string, number>;
  areas?: MuralAreaSummary[];
  topLevelCount?: number;
};

/** Builds a board Artifact from `get_mural_info` (required) plus optional overview. */
export function normalizeMuralBoard(
  infoRaw: unknown,
  retrievedAt: string,
  overview?: MuralOverview,
  method = "get_mural_info",
): Artifact {
  const info = obj(infoRaw) ?? {};
  const sourceId = str(info.id) ?? str(info.mural_id) ?? "unknown";
  const title = str(info.title);
  const memberUrl = str(info.member_url);
  const description = str(info.description);
  const workspace = str(info.workspace_id) ?? str(info.workspace_name);
  const updatedMs = num(info.last_updated) ?? num(info.updated_on);
  const updated =
    updatedMs !== undefined
      ? new Date(updatedMs).toISOString()
      : str(info.last_updated);

  const prov = (field: string, value?: string): Provenance => ({
    system: "mural",
    sourceRecordId: sourceId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    ...(memberUrl ? { sourceUrl: memberUrl } : {}),
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  const areaTitles = (overview?.areas ?? []).map((a) => a.title).filter(Boolean);
  const byType = overview?.byType;
  const typeSummary = byType
    ? Object.entries(byType)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ")
    : undefined;
  const descriptionParts = [
    description,
    overview?.totalWidgets !== undefined ? `widgets=${overview.totalWidgets}` : undefined,
    typeSummary ? `by_type={${typeSummary}}` : undefined,
    areaTitles.length ? `areas=${areaTitles.length}: ${areaTitles.slice(0, 8).join("; ")}${areaTitles.length > 8 ? "; …" : ""}` : undefined,
  ].filter(Boolean);

  return {
    key: `mural:${sourceId}`,
    system: "mural",
    sourceId,
    displayId: title,
    retrievalState: "AVAILABLE",
    recordType: field("record_type", "mural_board", "mural_board"),
    ...(memberUrl ? { url: field("member_url", memberUrl, memberUrl) } : {}),
    ...(title ? { title: field("title", title, title) } : {}),
    ...(descriptionParts.length
      ? { description: field("overview", descriptionParts.join(" | "), descriptionParts.join(" | ")) }
      : {}),
    ...(workspace ? { project: field("workspace_id", { id: workspace, name: str(info.workspace_name) ?? workspace }) } : {}),
    ...(updated ? { lastModified: field("last_updated", updated, updated) } : {}),
    ...(areaTitles.length ? { tags: field("areas", areaTitles) } : {}),
    externalIds: [],
    links: [],
  };
}

/** Normalizes one `search_murals` hit into a thin Artifact (title search only). */
export function normalizeMuralSearchHit(raw: unknown, retrievedAt: string, method = "search_murals"): Artifact {
  const hit = obj(raw) ?? {};
  const sourceId = str(hit.mural_id) ?? "unknown";
  const title = str(hit.title);
  const memberUrl = str(hit.member_url);
  const status = str(hit.status);
  const updated = num(hit.updated_on) !== undefined ? new Date(num(hit.updated_on)!).toISOString() : undefined;
  const prov = (field: string, value?: string): Provenance => ({
    system: "mural",
    sourceRecordId: sourceId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    ...(memberUrl ? { sourceUrl: memberUrl } : {}),
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  return {
    key: `mural:${sourceId}`,
    system: "mural",
    sourceId,
    displayId: title,
    retrievalState: "AVAILABLE",
    recordType: field("record_type", "mural_board", "mural_board"),
    ...(memberUrl ? { url: field("member_url", memberUrl, memberUrl) } : {}),
    ...(title ? { title: field("title", title, title) } : {}),
    ...(status ? { status: field("status", { name: status }) } : {}),
    ...(str(hit.workspace_id)
      ? { project: field("workspace_id", { id: str(hit.workspace_id)!, name: str(hit.workspace_name) }) }
      : {}),
    ...(updated ? { lastModified: field("updated_on", updated, updated) } : {}),
    externalIds: [],
    links: [],
  };
}

export function overviewFromCanvas(raw: unknown): MuralOverview {
  const o = obj(raw) ?? {};
  const byType = obj(o.by_type) as Record<string, number> | undefined;
  const areas = arr(o.areas)
    .map((a) => {
      const x = obj(a);
      const id = str(x?.widget_id);
      const title = str(x?.title);
      return id && title ? { id, title } : undefined;
    })
    .filter((a): a is MuralAreaSummary => a !== undefined);
  return {
    ...(num(o.total_widgets) !== undefined ? { totalWidgets: num(o.total_widgets) } : {}),
    ...(byType ? { byType } : {}),
    ...(areas.length ? { areas } : {}),
    ...(num(o.top_level_count) !== undefined ? { topLevelCount: num(o.top_level_count) } : {}),
  };
}
