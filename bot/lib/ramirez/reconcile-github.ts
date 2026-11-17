// GitHub ↔ Aha reconciliation. GitHub evidence is operator/IDE-supplied only —
// Ramirez never opens a GitHub MCP connection.
import { githubTargetId, normalizeGithubArtifact } from "./adapters/github";
import { conventionVerified, type RamirezConfig } from "./config";
import { excerpt } from "./redact";
import { describeRules, LIFECYCLE_DISCREPANCY, SCORE } from "./rules";
import { comparableDescription, jaccard, normalizeTitle, stripIdentityPrefix, tokens } from "./text";
import {
  MUTATION_MODE,
  NO_CHANGES_STATEMENT,
  type AlignmentAssessment,
  type AlignmentStatus,
  type Artifact,
  type CandidateSet,
  type CrossSystemLink,
  type Discrepancy,
  type Evidence,
  type FieldComparison,
  type MatchingMethod,
  type ReconciliationResult,
  type RelationshipAssessment,
  type RelationshipStatus,
  type ScoreBasis,
} from "./types";
import type { PlanningAdapter, RetrievalSession } from "./retrieval";

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
  retrievedAt?: string;
};

export type ReconcileGithubInput = {
  ahaRefs: string[];
  github: GithubEvidenceInput[];
  expectImplementationCounterpart: boolean;
};

export type ReconcileGithubDeps = {
  aha: PlanningAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

type Pair = {
  github: Artifact;
  aha: Artifact;
  status: RelationshipStatus;
  score: number | null;
  method: MatchingMethod;
  evidenceRefs: string[];
  contradictoryRefs: string[];
  ruleRefs: string[];
  explanation: string;
  raise: string[];
  lower: string[];
  missing: string[];
};

export function githubArtifactId(artifact: Artifact): string | undefined {
  return artifact.externalIds.find((e) => e.scheme === "github_target_id")?.value ?? artifact.sourceId;
}

/** True when an Aha GitHub link names this issue/PR/commit. */
export function linkMatchesGithub(link: CrossSystemLink, gh: Artifact): boolean {
  if (link.targetSystem !== "github" || !link.targetId) return false;
  const id = githubArtifactId(gh);
  if (!id) return false;
  return link.targetId === id || link.targetId === gh.sourceId;
}

function isOpenGithubState(state: string | undefined): boolean {
  if (!state) return false;
  const s = state.toLowerCase();
  return s === "open" || s === "opened" || s.includes("in progress") || s === "draft";
}

function ahaLooksComplete(aha: Artifact, config: RamirezConfig): boolean {
  const name = aha.status?.value.name;
  const category = aha.status?.value.category;
  if (!name && !category) return false;
  if (config.statusMapping) {
    const bucket = (name && config.statusMapping.aha[name]) || (category && config.statusMapping.aha[category]);
    if (bucket && config.statusMapping.completeBuckets.includes(bucket)) return true;
  }
  const text = `${name ?? ""} ${category ?? ""}`.toLowerCase();
  return /\b(done|complete|completed|shipped|closed|released)\b/.test(text);
}

export async function reconcileGithub(input: ReconcileGithubInput, deps: ReconcileGithubDeps): Promise<ReconciliationResult> {
  const { aha, session, config, now } = deps;
  const evidence: Evidence[] = [];
  const candidateSets: CandidateSet[] = [];
  const relationships: RelationshipAssessment[] = [];
  const alignments: AlignmentAssessment[] = [];
  const discrepancies: Discrepancy[] = [];
  const artifacts = new Map<string, Artifact>();
  const ruleRefs = new Set<string>();
  const limitations: string[] = [];
  let ids = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++ids).padStart(3, "0")}`;
  const addEvidence = (e: Omit<Evidence, "id">): string => {
    const id = nextId("E");
    evidence.push({ id, ...e });
    return id;
  };
  const rule = (...rs: string[]) => rs.forEach((r) => ruleRefs.add(r));

  limitations.push("GitHub was not queried by Ramirez; evidence was supplied by the operator/IDE.");
  limitations.push("No Mural, DPJ, Figma, or Azure DevOps retrieval was performed in this GitHub↔Aha run.");
  limitations.push("Commit messages and branch names are never identity by default.");

  const githubArtifacts: Artifact[] = [];
  for (const item of input.github) {
    const artifact = normalizeGithubArtifact(
      {
        owner: item.owner,
        repo: item.repo,
        kind: item.kind,
        ...(item.number !== undefined ? { number: item.number } : {}),
        ...(item.sha ? { sha: item.sha } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.state ? { state: item.state } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.body ? { body: item.body } : {}),
        ...(item.note ? { note: item.note } : {}),
        ...(item.branch ? { branch: item.branch } : {}),
      },
      item.retrievedAt ?? now(),
      "operator_ide_evidence",
      config,
    );
    artifacts.set(artifact.key, artifact);
    githubArtifacts.push(artifact);
    session.queried.add("github");
    session.log.push({
      system: "github",
      operation: "normalize_evidence",
      target: artifact.sourceId,
      state: "AVAILABLE",
      question: "Accept operator/IDE-supplied GitHub evidence",
      cached: false,
      resultCount: 1,
      at: now(),
      note: "No GitHub MCP call; never on READ_TOOL_ALLOWLIST",
    });
  }

  const ahaRefs = [...new Set(input.ahaRefs)];
  const ahaAnchors: Array<{ ref: string; artifact?: Artifact; state: import("./types").RetrievalState }> = [];
  for (const ref of ahaRefs) {
    const res = await session.run("aha", "read_records", ref, "Resolve the selected Aha record", () => aha.getById(ref));
    if (res.value) artifacts.set(res.value.key, res.value);
    ahaAnchors.push({ ref, ...(res.value ? { artifact: res.value } : {}), state: res.state });
  }

  for (const item of githubArtifacts) {
    for (const link of item.links) {
      if (link.targetSystem === "aha" && link.targetId && link.claimsIdentity && !ahaAnchors.some((a) => a.ref === link.targetId)) {
        rule("R-LF-021");
        const r = await session.run("aha", "read_records", link.targetId, "Resolve Aha ref from GitHub title", () => aha.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        ahaAnchors.push({ ref: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
      }
    }
  }

  const pairs: Pair[] = [];
  const pairedAha = new Set<string>();
  const pairedGithub = new Set<string>();

  for (const item of githubArtifacts) {
    const candidates = new Map<string, { artifact: Artifact; linksFromGithub: CrossSystemLink[]; linksFromAha: CrossSystemLink[] }>();

    for (const link of item.links.filter((l) => l.targetSystem === "aha" && l.targetId && l.claimsIdentity)) {
      const hit = ahaAnchors.find((a) => a.ref === link.targetId && a.artifact);
      if (!hit?.artifact) continue;
      const c = candidates.get(hit.artifact.sourceId) ?? { artifact: hit.artifact, linksFromGithub: [], linksFromAha: [] };
      c.linksFromGithub.push(link);
      candidates.set(hit.artifact.sourceId, c);
    }
    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      for (const link of a.artifact.links.filter((l) => linkMatchesGithub(l, item) && l.claimsIdentity)) {
        const c = candidates.get(a.artifact.sourceId) ?? { artifact: a.artifact, linksFromGithub: [], linksFromAha: [] };
        c.linksFromAha.push(link);
        candidates.set(a.artifact.sourceId, c);
      }
    }

    const idSetId = nextId("C");
    candidateSets.push({
      id: idSetId,
      source: item.key,
      targetSystem: "aha",
      candidates: [...candidates.keys()].map((id) => `aha:${id}`),
      rejected: [],
      discoveryMethod: "Explicit GitHub↔Aha identity links (URL and/or title ref)",
      queriedScope: `github ${item.sourceId} + named Aha refs`,
      retrievalState: "AVAILABLE",
      truncated: false,
    });

    if (candidates.size === 0) {
      const title = item.title?.value;
      if (title && ahaAnchors.some((a) => a.artifact) && item.recordType?.value !== "commit") {
        const scored: Array<{ aha: Artifact; score: number; refs: string[] }> = [];
        for (const a of ahaAnchors) {
          if (!a.artifact?.title?.value) continue;
          const sim = jaccard(tokens(title), tokens(a.artifact.title.value));
          if (sim < 0.3) continue;
          scored.push({
            aha: a.artifact,
            score: Math.min(SCORE.capTitleOnly, Math.round(sim * 100)),
            refs: [
              addEvidence({
                type: "METADATA_INFERENCE",
                role: "SUPPORTING",
                subject: item.key,
                object: a.artifact.key,
                fields: ["title"],
                provenance: [item.title!.provenance, a.artifact.title.provenance],
                value: `jaccard=${sim.toFixed(2)}`,
                retrievalState: "AVAILABLE",
                note: "Title overlap only; not identity.",
              }),
            ],
          });
        }
        if (scored.length === 1 && scored[0]!.score >= SCORE.candidateFloor) {
          const s = scored[0]!;
          pairs.push({
            github: item,
            aha: s.aha,
            status: s.score >= 50 ? "POSSIBLE" : "NOT_EVALUATED",
            score: Math.min(s.score, SCORE.capTitleOnly),
            method: "METADATA",
            evidenceRefs: s.refs,
            contradictoryRefs: [],
            ruleRefs: ["R-MD-003", "R-MD-006"],
            explanation: `Title-only metadata match capped at ${SCORE.capTitleOnly}. Not identity.`,
            raise: ["Add a GitHub URL on the Aha record or an Aha ref in the issue/PR title"],
            lower: [],
            missing: ["Deterministic identity link"],
          });
          pairedAha.add(s.aha.sourceId);
          pairedGithub.add(item.key);
          rule("R-MD-003", "R-MD-006");
        } else if (scored.length > 1) {
          relationships.push({
            id: nextId("R"),
            source: item.key,
            targetSystem: "aha",
            status: "AMBIGUOUS",
            method: "METADATA",
            score: SCORE.metadataAmbiguous,
            scoreBasis: { baseline: SCORE.metadataAmbiguous, capsApplied: ["title-only"], components: [] },
            evidenceRefs: scored.flatMap((s) => s.refs),
            contradictoryEvidenceRefs: [],
            missingEvidence: ["Unique deterministic link"],
            targetRetrievalState: "AVAILABLE",
            ruleRefs: ["R-MD-005"],
            explanation: `Multiple title-similar Aha candidates for GitHub ${item.sourceId}; ambiguous.`,
            wouldRaiseConfidence: ["Operator names one Aha reference"],
            wouldLowerConfidence: [],
            candidateSetRef: idSetId,
          });
          rule("R-MD-005");
        }
      }

      if (!pairedGithub.has(item.key)) {
        const orphanSpec = LIFECYCLE_DISCREPANCY.ORPHAN_IMPLEMENTATION_EVIDENCE!;
        if (input.expectImplementationCounterpart) {
          discrepancies.push({
            id: nextId("D"),
            kind: "ORPHAN_IMPLEMENTATION_EVIDENCE",
            severity: orphanSpec.severity,
            systems: ["github", "aha"],
            records: [item.key],
            values: [{ artifact: item.key, field: "title", value: item.title?.value ?? null, provenance: item.title?.provenance }],
            businessImpact: orphanSpec.impact,
            evidenceRefs: [],
            ruleRefs: orphanSpec.ruleRefs,
            authority: "UNKNOWN",
            recommendedResolution: "Name the Aha record this GitHub artifact belongs to, or set expectImplementationCounterpart false.",
          });
          rule(...orphanSpec.ruleRefs);
        }
        relationships.push({
          id: nextId("R"),
          source: item.key,
          targetSystem: "aha",
          status: "NOT_EVALUATED",
          method: "NONE",
          score: null,
          scoreBasis: emptyScore(),
          evidenceRefs: [],
          contradictoryEvidenceRefs: [],
          missingEvidence: ["No Aha counterpart in queried scope"],
          targetRetrievalState: "NOT_FOUND_WITHIN_QUERIED_SCOPE",
          ruleRefs: input.expectImplementationCounterpart ? orphanSpec.ruleRefs : [],
          explanation: input.expectImplementationCounterpart
            ? `No Aha counterpart found for GitHub ${item.sourceId} (ORPHAN_IMPLEMENTATION_EVIDENCE). Not MISSING under R-MISS-001.`
            : `No Aha counterpart linked for GitHub ${item.sourceId}. Expectation was off; no omission asserted.`,
          wouldRaiseConfidence: ["Provide an Aha reference or put a GitHub URL on the Aha record"],
          wouldLowerConfidence: [],
          candidateSetRef: idSetId,
        });
      }
      continue;
    }

    for (const c of candidates.values()) {
      const refs: string[] = [];
      for (const l of c.linksFromGithub) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: item.key,
            object: c.artifact.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.targetId,
            retrievalState: "AVAILABLE",
            note: `GitHub title convention (${l.kind}).`,
          }),
        );
        rule("R-LF-021");
      }
      for (const l of c.linksFromAha) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: c.artifact.key,
            object: item.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.url ?? l.targetId,
            retrievalState: "AVAILABLE",
            note: `Aha GitHub URL (${l.kind}).`,
          }),
        );
        rule("R-LF-020");
      }

      const verified =
        c.linksFromGithub.some((l) => conventionVerified(config, l.kind)) ||
        c.linksFromAha.some((l) => conventionVerified(config, l.kind));
      const bothWays = c.linksFromGithub.length > 0 && c.linksFromAha.length > 0;
      let status: RelationshipStatus;
      let score: number;
      let rules: string[];
      let explanation: string;
      const raise: string[] = [];
      if (bothWays || verified) {
        status = "CONFIRMED";
        score = SCORE.explicitVerifiedUnique;
        rules = ["R-ID-001", ...(c.linksFromGithub.length ? ["R-LF-021"] : []), ...(c.linksFromAha.length ? ["R-LF-020"] : [])];
        explanation = bothWays
          ? `Identity established by links on both GitHub and Aha. Baseline ${SCORE.explicitVerifiedUnique}.`
          : `Identity established by operator-verified convention. Baseline ${SCORE.explicitVerifiedUnique}.`;
        rule("R-ID-001");
      } else {
        status = "PROBABLE";
        score = SCORE.explicitUnverifiedConvention;
        rules = ["R-ID-003", ...(c.linksFromGithub.length ? ["R-LF-021"] : []), ...(c.linksFromAha.length ? ["R-LF-020"] : [])];
        explanation = `One-directional or unverified GitHub↔Aha link. Baseline ${SCORE.explicitUnverifiedConvention}, PROBABLE.`;
        raise.push("Pass verifyConventions for the link kinds you trust");
        if (!bothWays) raise.push("Add the reverse link (GitHub URL on Aha or Aha ref in the issue/PR title)");
        rule("R-ID-003");
      }

      pairs.push({
        github: item,
        aha: c.artifact,
        status,
        score,
        method: "DETERMINISTIC",
        evidenceRefs: refs,
        contradictoryRefs: [],
        ruleRefs: rules,
        explanation,
        raise,
        lower: [],
        missing: [],
      });
      pairedAha.add(c.artifact.sourceId);
      pairedGithub.add(item.key);
    }
  }

  if (input.expectImplementationCounterpart && githubArtifacts.length > 0) {
    for (const a of ahaAnchors) {
      if (!a.artifact || pairedAha.has(a.artifact.sourceId)) continue;
      const hasGhLink = a.artifact.links.some((l) => l.targetSystem === "github" && l.claimsIdentity);
      if (hasGhLink) continue;
      const spec = LIFECYCLE_DISCREPANCY.PLANNING_ABSENT_FROM_IMPLEMENTATION!;
      discrepancies.push({
        id: nextId("D"),
        kind: "PLANNING_ABSENT_FROM_IMPLEMENTATION",
        severity: spec.severity,
        systems: ["aha", "github"],
        records: [a.artifact.key, ...githubArtifacts.map((x) => x.key)],
        values: [{ artifact: a.artifact.key, field: "title", value: a.artifact.title?.value ?? null, provenance: a.artifact.title?.provenance }],
        businessImpact: spec.impact,
        evidenceRefs: [],
        ruleRefs: spec.ruleRefs,
        authority: "UNKNOWN",
        recommendedResolution: "Supply matching GitHub evidence or link the issue/PR on the Aha record.",
      });
      rule(...spec.ruleRefs);
    }
  }

  for (const p of pairs) {
    const relId = nextId("R");
    relationships.push({
      id: relId,
      source: p.github.key,
      target: p.aha.key,
      targetSystem: "aha",
      status: p.status,
      method: p.method,
      score: p.score,
      scoreBasis: { baseline: p.score, capsApplied: p.method === "METADATA" ? ["title-only"] : [], components: [] },
      evidenceRefs: p.evidenceRefs,
      contradictoryEvidenceRefs: p.contradictoryRefs,
      missingEvidence: p.missing,
      targetRetrievalState: "AVAILABLE",
      ruleRefs: p.ruleRefs,
      explanation: p.explanation,
      wouldRaiseConfidence: p.raise,
      wouldLowerConfidence: p.lower,
    });

    if (p.status !== "CONFIRMED" && p.status !== "PROBABLE") continue;
    const aligned = assessGithubAhaAlignment(p.github, p.aha, config);
    alignments.push({
      id: nextId("A"),
      relationshipRef: relId,
      status: aligned.status,
      comparisons: aligned.comparisons,
      evidenceRefs: aligned.comparisons.flatMap((c) => c.evidenceRefs),
      ruleRefs: aligned.ruleRefs,
      explanation: aligned.explanation,
    });
    rule(...aligned.ruleRefs);

    for (const cmp of aligned.comparisons.filter((c) => c.result === "DIFFERENT")) {
      const implSpec = LIFECYCLE_DISCREPANCY.IMPLEMENTATION_PLANNING_MISMATCH!;
      const kind = cmp.field === "description" || cmp.field === "status" ? "IMPLEMENTATION_PLANNING_MISMATCH" : "TITLE_CONFLICT";
      const severity = cmp.field === "title" ? "MEDIUM" : implSpec.severity;
      discrepancies.push({
        id: nextId("D"),
        kind,
        severity,
        systems: ["github", "aha"],
        records: [p.github.key, p.aha.key],
        values: [
          { artifact: p.github.key, field: cmp.field, value: cmp.sourceValue },
          { artifact: p.aha.key, field: cmp.field, value: cmp.targetValue },
        ],
        businessImpact: cmp.field === "title" ? "Implementation title and planning title differ." : implSpec.impact,
        evidenceRefs: [...p.evidenceRefs],
        ruleRefs: cmp.field === "title" ? [...aligned.ruleRefs] : implSpec.ruleRefs,
        relationshipRef: relId,
        authority: "UNKNOWN",
        recommendedResolution: "Review both values; Ramirez does not choose an authority unless you configure one.",
      });
      if (kind === "IMPLEMENTATION_PLANNING_MISMATCH") rule(...implSpec.ruleRefs);
    }

    if (ahaLooksComplete(p.aha, config) && isOpenGithubState(p.github.status?.value.name)) {
      const spec = LIFECYCLE_DISCREPANCY.UNSUPPORTED_COMPLETION_CLAIM!;
      discrepancies.push({
        id: nextId("D"),
        kind: "UNSUPPORTED_COMPLETION_CLAIM",
        severity: spec.severity,
        systems: ["aha", "github"],
        records: [p.aha.key, p.github.key],
        values: [
          { artifact: p.aha.key, field: "status", value: p.aha.status?.value.name ?? null, provenance: p.aha.status?.provenance },
          { artifact: p.github.key, field: "state", value: p.github.status?.value.name ?? null, provenance: p.github.status?.provenance },
        ],
        businessImpact: spec.impact,
        evidenceRefs: [...p.evidenceRefs],
        ruleRefs: spec.ruleRefs,
        relationshipRef: relId,
        authority: "UNKNOWN",
        recommendedResolution: "Close or merge the GitHub work, or correct the Aha completion status.",
      });
      rule(...spec.ruleRefs);
    }
  }

  if (config.conventions.ahaDescriptionGithubUrl.enabled && !config.conventions.ahaDescriptionGithubUrl.verified) {
    limitations.push("Unverified GitHub URL conventions cap those links at PROBABLE until you pass verifyConventions.");
  }
  if (config.conventions.githubTitleAhaRef.enabled && !config.conventions.githubTitleAhaRef.verified) {
    limitations.push("Unverified GitHub title Aha-ref convention caps those links at PROBABLE until verified.");
  }

  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: {
      aha: ahaRefs,
      dpj: [],
      mural: [],
      figma: [],
      ado: [],
      github: githubArtifacts.map((g) => g.sourceId),
      options: {
        expectDpjCounterpart: false,
        expectPlanningCounterpart: false,
        expectDesignCounterpart: false,
        expectEngineeringCounterpart: false,
        expectImplementationCounterpart: input.expectImplementationCounterpart,
        dpjProjectId: null,
        transition: "github_aha",
      },
    },
    systemsQueried: [...session.queried],
    systemsNotQueried: [
      { system: "mural", reason: "outside the GitHub ↔ Aha scope of this run" },
      { system: "dpj", reason: "outside the GitHub ↔ Aha scope of this run" },
      { system: "figma", reason: "IDE plugin only; no agent connection" },
      { system: "azure_devops", reason: "outside the GitHub ↔ Aha scope of this run" },
    ],
    artifacts: [...artifacts.values()],
    evidence,
    candidateSets,
    relationships,
    alignments,
    discrepancies,
    proposals: [],
    downstreamLinks: [],
    lifecyclePaths: [],
    retrievalLog: session.log,
    limitations,
    rulesApplied: describeRules(ruleRefs),
  };
}

function emptyScore(): ScoreBasis {
  return { baseline: null, capsApplied: [], components: [] };
}

export function assessGithubAhaAlignment(
  github: Artifact,
  aha: Artifact,
  config: RamirezConfig,
): {
  status: AlignmentStatus;
  comparisons: FieldComparison[];
  ruleRefs: string[];
  explanation: string;
} {
  const comparisons: FieldComparison[] = [];
  const ruleRefs = new Set<string>(["R-AL-001", "R-AL-002"]);
  const gTitle = stripIdentityPrefix(github.title?.value ?? "");
  const aTitle = stripIdentityPrefix(aha.title?.value ?? "");
  comparisons.push({
    field: "title",
    sourceValue: gTitle || null,
    targetValue: aTitle || null,
    result: !gTitle || !aTitle ? "NOT_COMPARABLE" : normalizeTitle(gTitle) === normalizeTitle(aTitle) ? "EQUAL" : "DIFFERENT",
    method: "NORMALIZED",
    evidenceRefs: [],
    ruleRef: "R-AL-002",
    ...(!gTitle || !aTitle ? { note: "one side is empty" } : {}),
  });

  ruleRefs.add("R-AL-003");
  const gDesc = comparableDescription(github.description?.value ?? "");
  const aDesc = comparableDescription(aha.description?.value ?? "");
  if (!gDesc || !aDesc) {
    comparisons.push({
      field: "description",
      sourceValue: gDesc || null,
      targetValue: aDesc || null,
      result: "NOT_COMPARABLE",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: "one side has no description",
    });
  } else {
    const sim = jaccard(tokens(gDesc), tokens(aDesc));
    comparisons.push({
      field: "description",
      sourceValue: excerpt(gDesc, 200) ?? null,
      targetValue: excerpt(aDesc, 200) ?? null,
      result: sim >= 0.5 ? "EQUAL" : "DIFFERENT",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: `lexical overlap ${sim.toFixed(2)} (threshold 0.50)`,
    });
  }

  ruleRefs.add("R-AL-004");
  const ghState = github.status?.value.name;
  const ahaStatus = aha.status?.value.name;
  if (!config.statusMapping || !ghState || !ahaStatus) {
    comparisons.push({
      field: "status",
      sourceValue: ghState ?? null,
      targetValue: ahaStatus ?? null,
      result: "NOT_COMPARABLE",
      method: "DIRECT",
      evidenceRefs: [],
      ruleRef: "R-AL-004",
      note: config.statusMapping ? "one side missing status" : "no statusMapping configured",
    });
  } else {
    const mapGh = config.statusMapping.dpj[ghState] ?? config.statusMapping.aha[ghState];
    const mapAha = config.statusMapping.aha[ahaStatus];
    comparisons.push({
      field: "status",
      sourceValue: ghState,
      targetValue: ahaStatus,
      result: mapGh && mapAha ? (mapGh === mapAha ? "EQUAL" : "DIFFERENT") : "NOT_COMPARABLE",
      method: "NORMALIZED",
      evidenceRefs: [],
      ruleRef: "R-AL-004",
      ...(!mapGh || !mapAha ? { note: "status not in configured mapping" } : {}),
    });
  }

  const different = comparisons.filter((c) => c.result === "DIFFERENT");
  let status: AlignmentStatus;
  if (different.some((c) => c.field === "description" || c.field === "status")) status = "CONTRADICTORY";
  else if (different.length > 0) status = "PARTIALLY_ALIGNED";
  else if (comparisons.some((c) => c.result === "EQUAL")) status = "ALIGNED";
  else status = "NOT_EVALUATED";
  ruleRefs.add("R-AL-009");
  return {
    status,
    comparisons,
    ruleRefs: [...ruleRefs].sort(),
    explanation: `${different.length} field(s) differ: ${different.map((c) => c.field).join(", ") || "none"}. GitHub↔Aha compares title, description, and mapped status.`,
  };
}

/** Exposed for tests that build target ids the same way as the adapter. */
export { githubTargetId };
