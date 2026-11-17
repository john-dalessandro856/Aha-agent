// Deterministic text helpers. No model calls, no embeddings.

/** Aha reference numbers: VEL-E-3599 (epic), ABC-123 (feature), ABC-123-1 (requirement). */
export const AHA_REF = /\b[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?\b/g;
const AHA_REF_EXACT = /^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/;

export function isAhaRef(value: string): boolean {
  return AHA_REF_EXACT.test(value);
}

export function stripMarkup(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Leading "[REF]" prefix on a DPJ subject, if any. */
export function bracketPrefixRef(subject: string): string | undefined {
  const m = /^\s*\[([^\]]+)\]/.exec(subject);
  const ref = m?.[1]?.trim();
  return ref !== undefined && isAhaRef(ref) ? ref : undefined;
}

export function stripIdentityPrefix(title: string): string {
  return title.replace(/^\s*\[[^\]]+\]\s*/, "");
}

export function normalizeTitle(title: string): string {
  return stripIdentityPrefix(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or",
  "that", "the", "this", "to", "with", "will", "we", "our", "should", "can", "via",
]);

export function tokens(text: string): Set<string> {
  return new Set(
    normalizeTitle(stripMarkup(text))
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export function normalizeName(name: string): string {
  return [...tokens(name.replace(/,/g, " "))].sort().join(" ");
}

export function calendarDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m?.[1] ?? null;
}

/** Description with markup and identity lines (e.g. "Aha: <url>") removed. */
export function comparableDescription(text: string): string {
  return stripMarkup(text)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(aha|dpj|openproject)\s*:\s*https?:\/\//i.test(line))
    .join("\n")
    .trim();
}

export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(flatKeys(value)).sort());
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function flatKeys(value: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out[k] = true;
      flatKeys(v, out);
    }
  }
  return out;
}
