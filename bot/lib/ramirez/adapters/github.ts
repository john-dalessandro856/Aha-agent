// Normalizes operator/IDE-supplied GitHub issue/PR/commit metadata.
// Ramirez never opens a GitHub MCP connection.
import type { RamirezConfig } from "../config";
import { DEFAULT_CONFIG } from "../config";
import { ahaRefFromTitle, parseGithubUrls } from "../links";
import { excerpt } from "../redact";
import type { Artifact, CrossSystemLink, Field, Provenance } from "../types";

const ADAPTER = "github-operator-evidence@1";

export type GithubEvidenceInput = {
  owner: string;
  repo: string;
  kind: "issue" | "pr" | "commit";
  number?: number;
  sha?: string;
  title?: string;
  state?: string;
  url?: string;
  body?: string;
  note?: string;
  branch?: string;
};

export function githubTargetId(input: Pick<GithubEvidenceInput, "owner" | "repo" | "kind" | "number" | "sha">): string {
  if (input.kind === "commit") {
    const sha = input.sha?.trim();
    if (!sha) throw new Error("github commit evidence requires sha");
    return `${input.owner}/${input.repo}@${sha}`;
  }
  if (input.number === undefined) throw new Error("github issue/pr evidence requires number");
  return `${input.owner}/${input.repo}#${input.number}`;
}

/**
 * Builds an Artifact for a GitHub issue, PR, or commit from operator/IDE evidence.
 * Commit evidence never claims Aha identity from the commit message (R-ID-007 / R-LF-021).
 */
export function normalizeGithubArtifact(
  input: GithubEvidenceInput,
  retrievedAt: string,
  method = "operator_ide_evidence",
  config: RamirezConfig = DEFAULT_CONFIG,
): Artifact {
  const targetId = githubTargetId(input);
  const url =
    input.url ??
    (input.kind === "commit"
      ? `https://github.com/${input.owner}/${input.repo}/commit/${input.sha}`
      : `https://github.com/${input.owner}/${input.repo}/${input.kind === "pr" ? "pull" : "issues"}/${input.number}`);
  const title =
    input.title ??
    (input.kind === "commit" ? `Commit ${input.sha?.slice(0, 7)}` : `${input.kind === "pr" ? "PR" : "Issue"} #${input.number}`);
  const descriptionParts = [input.body, input.note, input.branch ? `branch=${input.branch}` : undefined].filter(Boolean);

  const prov = (field: string, value?: string): Provenance => ({
    system: "github",
    sourceRecordId: targetId,
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
  // Title refs only for issue/PR — commits stay off identity by default.
  if (input.kind !== "commit" && config.conventions.githubTitleAhaRef.enabled) {
    const ref = ahaRefFromTitle(title);
    if (ref) {
      links.push({
        targetSystem: "aha",
        targetId: ref,
        kind: "github_title_aha_ref",
        claimsIdentity: true,
        provenance: prov("title", ref),
      });
    }
  }

  return {
    key: `github:${targetId}`,
    system: "github",
    sourceId: targetId,
    displayId: targetId,
    retrievalState: "AVAILABLE",
    recordType: field("record_type", input.kind === "pr" ? "pull_request" : input.kind, input.kind),
    url: field("url", url, url),
    title: field("title", title, title),
    ...(descriptionParts.length
      ? { description: field("body", descriptionParts.join(" | "), descriptionParts.join(" | ")) }
      : {}),
    project: field("repo", { id: `${input.owner}/${input.repo}`, name: input.repo, prefix: input.owner }),
    ...(input.state ? { status: field("state", { name: input.state }, input.state) } : {}),
    externalIds: [
      { scheme: "github_target_id", value: targetId, provenance: prov("targetId", targetId) },
      ...(input.number !== undefined
        ? [{ scheme: "github_number", value: String(input.number), provenance: prov("number", String(input.number)) }]
        : []),
      ...(input.sha ? [{ scheme: "github_sha", value: input.sha, provenance: prov("sha", input.sha) }] : []),
    ],
    links,
  };
}

export { parseGithubUrls };
