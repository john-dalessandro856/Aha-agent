// Normalizes Figma file/page/node metadata into a Ramirez Artifact.
// Figma stays IDE-plugin only (no agent MCP connection). These helpers
// normalize payloads observed from get_metadata / whoami-backed reads in chat.
import type { RamirezConfig } from "../config";
import { DEFAULT_CONFIG } from "../config";
import { ahaRefFromTitle } from "../links";
import { excerpt } from "../redact";
import type { Artifact, CrossSystemLink, Field, Provenance } from "../types";

type Obj = Record<string, unknown>;
const ADAPTER = "figma-ide-plugin@1";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : undefined;

export type FigmaPageRef = { id: string; name: string };

/**
 * Builds an Artifact for a Figma design file (or a named node inside it).
 * `fileKey` is required. `nodeId` / `nodeName` identify a page or frame when known.
 */
export function normalizeFigmaNode(
  input: {
    fileKey: string;
    fileName?: string;
    nodeId?: string;
    nodeName?: string;
    pages?: FigmaPageRef[];
    note?: string;
  },
  retrievedAt: string,
  method = "get_metadata",
  config: RamirezConfig = DEFAULT_CONFIG,
): Artifact {
  const sourceId = input.nodeId ? `${input.fileKey}:${input.nodeId}` : input.fileKey;
  const url = input.nodeId
    ? `https://www.figma.com/design/${input.fileKey}/${encodeURIComponent(input.fileName ?? "file")}?node-id=${input.nodeId.replace(":", "-")}`
    : `https://www.figma.com/design/${input.fileKey}/${encodeURIComponent(input.fileName ?? "file")}`;
  const title = input.nodeName ?? input.fileName ?? input.fileKey;
  const pageNames = (input.pages ?? []).map((p) => p.name);
  const descriptionParts = [
    input.note,
    pageNames.length ? `pages=${pageNames.length}: ${pageNames.slice(0, 12).join("; ")}${pageNames.length > 12 ? "; …" : ""}` : undefined,
  ].filter(Boolean);

  const prov = (field: string, value?: string): Provenance => ({
    system: "figma",
    sourceRecordId: sourceId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    sourceUrl: url,
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  const links: CrossSystemLink[] = [];
  if (config.conventions.figmaTitleAhaRef.enabled) {
    const fromTitle = ahaRefFromTitle(title);
    const fromFile = input.fileName ? ahaRefFromTitle(input.fileName) : undefined;
    const ref = fromTitle ?? fromFile;
    if (ref) {
      links.push({
        targetSystem: "aha",
        targetId: ref,
        kind: "figma_title_aha_ref",
        claimsIdentity: true,
        provenance: prov(fromTitle ? "name" : "fileName", ref),
      });
    }
  }

  return {
    key: `figma:${sourceId}`,
    system: "figma",
    sourceId,
    displayId: title,
    retrievalState: "AVAILABLE",
    recordType: field("record_type", input.nodeId ? "figma_node" : "figma_file", input.nodeId ? "figma_node" : "figma_file"),
    url: field("url", url, url),
    title: field("name", title, title),
    ...(descriptionParts.length
      ? { description: field("pages", descriptionParts.join(" | "), descriptionParts.join(" | ")) }
      : {}),
    project: field("fileKey", { id: input.fileKey, name: input.fileName ?? input.fileKey }),
    ...(pageNames.length ? { tags: field("pages", pageNames) } : {}),
    externalIds: [{ scheme: "figma_file_key", value: input.fileKey, provenance: prov("fileKey", input.fileKey) }],
    links,
  };
}

/** Parses a Figma design URL into fileKey + optional nodeId. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string; fileName?: string } | undefined {
  const m = url.match(/figma\.com\/(?:design|file)\/([0-9a-zA-Z]{22,128})(?:\/([^/?#]+))?(?:\/)?(?:\?[^#]*)?(?:#.*)?/);
  if (!m) return undefined;
  const fileKey = m[1]!;
  const fileName = m[2] ? decodeURIComponent(m[2]) : undefined;
  const nodeMatch = url.match(/[?&]node-id=(\d+[:-]\d+)/i);
  const nodeId = nodeMatch?.[1]?.replace("-", ":");
  return { fileKey, ...(fileName ? { fileName } : {}), ...(nodeId ? { nodeId } : {}) };
}

/** Extracts top-level page list lines from a get_metadata "pages only" text response. */
export function pagesFromMetadataListing(text: string): FigmaPageRef[] {
  const pages: FigmaPageRef[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*(\d+:\d+)\s*:\s*(.+?)\s*$/);
    if (m) pages.push({ id: m[1]!, name: m[2]!.trim() });
  }
  return pages;
}
