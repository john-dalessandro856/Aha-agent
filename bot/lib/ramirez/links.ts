// Shared URL / title identity extractors for lifecycle links.
import { AHA_REF, isAhaRef } from "./text";

const FIGMA_URL =
  /https?:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([0-9a-zA-Z]{22,128})(?:\/([^/?#\s]+))?(?:\/)?(?:\?[^\s#]*)?(?:#[^\s]*)?/gi;

/** app.mural.co/t/{ws}/m/{ws}/{id} → mural id `{ws}.{id}` */
const MURAL_MEMBER_URL =
  /https?:\/\/(?:app\.)?mural\.co\/t\/([A-Za-z0-9_-]+)\/m\/([A-Za-z0-9_-]+)\/(\d+)/gi;

export type ParsedFigmaUrl = { url: string; fileKey: string; fileName?: string; nodeId?: string };

export type ParsedMuralUrl = { url: string; muralId: string; workspaceId: string };

export function parseFigmaUrls(text: string): ParsedFigmaUrl[] {
  const out: ParsedFigmaUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(FIGMA_URL)) {
    const url = m[0]!;
    const fileKey = m[1]!;
    const fileName = m[2] ? decodeURIComponent(m[2]) : undefined;
    const nodeMatch = url.match(/[?&]node-id=(\d+[:-]\d+)/i);
    const nodeId = nodeMatch?.[1]?.replace("-", ":");
    const key = `${fileKey}:${nodeId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, fileKey, ...(fileName ? { fileName } : {}), ...(nodeId ? { nodeId } : {}) });
  }
  return out;
}

export function parseMuralUrls(text: string): ParsedMuralUrl[] {
  const out: ParsedMuralUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MURAL_MEMBER_URL)) {
    const url = m[0]!;
    const workspaceId = m[1]!;
    const muralId = `${m[2]}.${m[3]}`;
    if (seen.has(muralId)) continue;
    seen.add(muralId);
    out.push({ url, muralId, workspaceId });
  }
  return out;
}

/** Resolves a mural id from a member URL, or returns the input if it already looks like an id. */
export function resolveMuralId(idOrUrl: string): string | undefined {
  const trimmed = idOrUrl.trim();
  if (/^[A-Za-z0-9_-]+\.\d+$/.test(trimmed)) return trimmed;
  return parseMuralUrls(trimmed)[0]?.muralId;
}

/** First Aha reference in a title/name when the operator treats titles as identity. */
export function ahaRefFromTitle(title: string): string | undefined {
  const m = title.match(AHA_REF);
  const ref = m?.[0];
  return ref !== undefined && isAhaRef(ref) ? ref : undefined;
}

/** Azure DevOps work-item edit URLs (dev.azure.com and *.visualstudio.com). */
const ADO_WORK_ITEM_URL =
  /https?:\/\/(?:dev\.azure\.com\/([^/\s]+)\/([^/\s]+)|([A-Za-z0-9_-]+)\.visualstudio\.com\/([^/\s]+))\/_workitems\/edit\/(\d+)/gi;

export type ParsedAdoUrl = {
  url: string;
  workItemId: string;
  org?: string;
  project?: string;
};

export function parseAdoUrls(text: string): ParsedAdoUrl[] {
  const out: ParsedAdoUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(ADO_WORK_ITEM_URL)) {
    const url = m[0]!;
    const workItemId = m[5]!;
    const org = m[1] ?? m[3];
    const project = m[2] ?? m[4];
    if (seen.has(workItemId)) continue;
    seen.add(workItemId);
    out.push({
      url,
      workItemId,
      ...(org ? { org } : {}),
      ...(project ? { project } : {}),
    });
  }
  return out;
}

/** github.com issue, pull request, and commit URLs. */
const GITHUB_URL =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull|commit)\/([A-Za-z0-9]+)/gi;

export type ParsedGithubUrl = {
  url: string;
  owner: string;
  repo: string;
  kind: "issue" | "pr" | "commit";
  number?: number;
  sha?: string;
  /** Canonical identity: `owner/repo#n` or `owner/repo@sha`. */
  targetId: string;
};

export function parseGithubUrls(text: string): ParsedGithubUrl[] {
  const out: ParsedGithubUrl[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(GITHUB_URL)) {
    const url = m[0]!;
    const owner = m[1]!;
    const repo = m[2]!;
    const pathKind = m[3]!;
    const tail = m[4]!;
    let kind: ParsedGithubUrl["kind"];
    let number: number | undefined;
    let sha: string | undefined;
    let targetId: string;
    if (pathKind === "commit") {
      kind = "commit";
      sha = tail;
      targetId = `${owner}/${repo}@${sha}`;
    } else {
      kind = pathKind === "pull" ? "pr" : "issue";
      number = Number(tail);
      if (!Number.isFinite(number) || number <= 0) continue;
      targetId = `${owner}/${repo}#${number}`;
    }
    if (seen.has(targetId)) continue;
    seen.add(targetId);
    out.push({
      url,
      owner,
      repo,
      kind,
      targetId,
      ...(number !== undefined ? { number } : {}),
      ...(sha ? { sha } : {}),
    });
  }
  return out;
}
