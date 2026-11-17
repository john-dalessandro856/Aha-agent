const PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  // No leading \b: names like OPENPROJECT_API_KEY=... contain word characters before the key name.
  [/(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|client[_-]?secret)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1$2[REDACTED]"],
  [/([?&](?:code|state|code_challenge|access_token|token)=)[^&\s]+/gi, "$1[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/\b(?:ghp|gho|ghs|github_pat|xox[abprs])_?[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
];

/** Removes secrets and email addresses from free text. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** A short, redacted excerpt for evidence. Never the whole field. */
export function excerpt(text: string | undefined | null, max = 160): string | undefined {
  if (text === undefined || text === null) return undefined;
  const flat = redact(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export type LogEvent = { level: "info" | "warn"; event: string; [key: string]: unknown };

/** Structured logger that redacts every string value before it is written. */
export function createLogger(sink: (line: string) => void = (line) => console.error(line)) {
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /email|token|secret|password|authorization/i.test(k) ? "[REDACTED]" : clean(v)]));
    }
    return value;
  };
  return (event: LogEvent) => sink(JSON.stringify(clean({ at: new Date().toISOString(), component: "ramirez", ...event })));
}
