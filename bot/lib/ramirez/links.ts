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
