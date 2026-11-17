// Phase 5: combine independent mural↔Aha and Figma↔Aha hops, stitch shared
// Aha lifecycle paths, and optionally assess direct mural↔Figma links.
import { conventionVerified, type RamirezConfig } from "./config";
import { linkMatchesFigma, reconcileFigma, type FigmaEvidenceInput } from "./reconcile-figma";
import { reconcileMural } from "./reconcile-mural";
import { excerpt } from "./redact";
import { describeRules, LIFECYCLE_DISCREPANCY, SCORE } from "./rules";
import { comparableDescription, jaccard, normalizeTitle, stripIdentityPrefix, tokens } from "./text";
import {
  MUTATION_MODE,
  NO_CHANGES_STATEMENT,
  type AlignmentAssessment,
  type Artifact,
  type CandidateSet,
  type Discrepancy,
  type Evidence,
  type FieldComparison,
  type LifecyclePath,
  type ProposedChange,
  type ReconciliationResult,
  type RelationshipAssessment,
  type RelationshipStatus,
  type RetrievalLogEntry,
  type SystemId,
} from "./types";
import type { MuralEvidenceAdapter, PlanningAdapter, RetrievalSession } from "./retrieval";

export type ReconcileLifecycleInput = {
  muralIds: string[];
  ahaRefs: string[];
  figma: FigmaEvidenceInput[];
  expectPlanningCounterpart: boolean;
  expectDesignCounterpart: boolean;
  includeStickyExcerpts: boolean;
  /** When true (default), assess mural↔Figma when both are in scope. */
  includeMuralFigmaHop: boolean;
};

export type ReconcileLifecycleDeps = {
  aha: PlanningAdapter;
  mural: MuralEvidenceAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

export async function reconcileLifecycle(input: ReconcileLifecycleInput, deps: ReconcileLifecycleDeps): Promise<ReconciliationResult> {
  const hasMural = input.muralIds.length > 0;
  const hasFigma = input.figma.length > 0;
  if (!hasMural && !hasFigma) {
    throw new Error("lifecycle reconcile requires at least one mural id/URL or Figma evidence object");
  }

  const parts: ReconciliationResult[] = [];
  const extraLimitations: string[] = [];
  const ruleRefs = new Set<string>(["R-LF-011"]);

  if (hasMural) {
    parts.push(
      await reconcileMural(
        {
          muralIds: input.muralIds,
          ahaRefs: input.ahaRefs,
          expectPlanningCounterpart: input.expectPlanningCounterpart,
          includeStickyExcerpts: input.includeStickyExcerpts,
        },
        deps,
      ),
    );
  }
  if (hasFigma) {
    const ahaFromMural = parts[0]?.artifacts.filter((a) => a.system === "aha").map((a) => a.sourceId) ?? [];
    const ahaRefs = [...new Set([...input.ahaRefs, ...ahaFromMural])];
    parts.push(
      await reconcileFigma(
        {
          ahaRefs,
          figma: input.figma,
          expectDesignCounterpart: input.expectDesignCounterpart,
        },
        { aha: deps.aha, session: deps.session, config: deps.config, now: deps.now },
      ),
    );
  }

  const merged = mergeHopResults(parts, {
    muralIds: input.muralIds,
    ahaRefs: input.ahaRefs,
    figmaIds: input.figma.map((f) => (f.nodeId ? `${f.fileKey}:${f.nodeId.replace("-", ":")}` : f.fileKey)),
    expectPlanningCounterpart: input.expectPlanningCounterpart,
    expectDesignCounterpart: input.expectDesignCounterpart,
  });

  merged.lifecyclePaths = buildLifecyclePaths(merged.relationships);
  for (const _ of merged.lifecyclePaths) ruleRefs.add("R-LF-011");

  if (input.includeMuralFigmaHop && hasMural && hasFigma) {
    const direct = assessDirectMuralFigma(merged, deps.config);
    merged.relationships.push(...direct.relationships);
    merged.alignments.push(...direct.alignments);
    merged.discrepancies.push(...direct.discrepancies);
    merged.evidence.push(...direct.evidence);
    for (const r of direct.ruleIds) ruleRefs.add(r);
    extraLimitations.push(...direct.limitations);
  }

  extraLimitations.push(
    "Each hop (mural↔Aha, Figma↔Aha, mural↔Figma) is evaluated independently; a CONFIRMED hop does not confirm another.",
  );
  extraLimitations.push("No DPJ, Azure DevOps, or GitHub retrieval was performed in this lifecycle run.");
  if (!hasMural) extraLimitations.push("No mural was named; mural↔Aha and mural↔Figma hops were skipped.");
  if (!hasFigma) extraLimitations.push("No Figma evidence was supplied; Figma↔Aha and mural↔Figma hops were skipped.");

  merged.limitations = [...new Set([...merged.limitations, ...extraLimitations])];
  merged.rulesApplied = describeRules([...new Set([...merged.rulesApplied.map((r) => r.id), ...ruleRefs])]);
  merged.scope.options.transition = "lifecycle";
  merged.statement = NO_CHANGES_STATEMENT;
  merged.mutationMode = MUTATION_MODE;
  return merged;
}

function mergeHopResults(
  parts: ReconciliationResult[],
  scope: {
    muralIds: string[];
    ahaRefs: string[];
    figmaIds: string[];
    expectPlanningCounterpart: boolean;
    expectDesignCounterpart: boolean;
  },
): ReconciliationResult {
  const artifacts = new Map<string, Artifact>();
  const evidence: Evidence[] = [];
  const candidateSets: CandidateSet[] = [];
  const relationships: RelationshipAssessment[] = [];
  const alignments: AlignmentAssessment[] = [];
  const discrepancies: Discrepancy[] = [];
  const proposals: ProposedChange[] = [];
  const downstreamLinks: ReconciliationResult["downstreamLinks"] = [];
  const retrievalLog: RetrievalLogEntry[] = [];
  const limitations: string[] = [];
  const systemsQueried = new Set<SystemId>();
  const ruleIds = new Set<string>();

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(3, "0")}`;

  for (const part of parts) {
    for (const art of part.artifacts) artifacts.set(art.key, art);
    for (const s of part.systemsQueried) systemsQueried.add(s);
    limitations.push(...part.limitations);
    retrievalLog.push(...part.retrievalLog);
    proposals.push(...part.proposals);
    downstreamLinks.push(...part.downstreamLinks);
    for (const x of part.rulesApplied) ruleIds.add(x.id);

    const eMap = new Map<string, string>();
    const rMap = new Map<string, string>();
    const aMap = new Map<string, string>();
    const dMap = new Map<string, string>();
    const cMap = new Map<string, string>();
    for (const ev of part.evidence) eMap.set(ev.id, nextId("E"));
    for (const rel of part.relationships) rMap.set(rel.id, nextId("R"));
    for (const al of part.alignments) aMap.set(al.id, nextId("A"));
    for (const disc of part.discrepancies) dMap.set(disc.id, nextId("D"));
    for (const cs of part.candidateSets) cMap.set(cs.id, nextId("C"));

    for (const ev of part.evidence) evidence.push({ ...ev, id: eMap.get(ev.id)! });
    for (const rel of part.relationships) {
      relationships.push({
        ...rel,
        id: rMap.get(rel.id)!,
        evidenceRefs: rel.evidenceRefs.map((id) => eMap.get(id) ?? id),
        contradictoryEvidenceRefs: rel.contradictoryEvidenceRefs.map((id) => eMap.get(id) ?? id),
        ...(rel.candidateSetRef ? { candidateSetRef: cMap.get(rel.candidateSetRef) ?? rel.candidateSetRef } : {}),
      });
    }
    for (const al of part.alignments) {
      alignments.push({
        ...al,
        id: aMap.get(al.id)!,
        relationshipRef: rMap.get(al.relationshipRef) ?? al.relationshipRef,
        evidenceRefs: al.evidenceRefs.map((id) => eMap.get(id) ?? id),
      });
    }
    for (const disc of part.discrepancies) {
      discrepancies.push({
        ...disc,
        id: dMap.get(disc.id)!,
        evidenceRefs: disc.evidenceRefs.map((id) => eMap.get(id) ?? id),
        ...(disc.relationshipRef ? { relationshipRef: rMap.get(disc.relationshipRef) ?? disc.relationshipRef } : {}),
      });
    }
    for (const cs of part.candidateSets) candidateSets.push({ ...cs, id: cMap.get(cs.id)! });
  }

  const ahaFromParts = [...artifacts.values()].filter((x) => x.system === "aha").map((x) => x.sourceId);
  const muralFromParts = [...artifacts.values()].filter((x) => x.system === "mural").map((x) => x.sourceId);
  const figmaFromParts = [...artifacts.values()].filter((x) => x.system === "figma").map((x) => x.sourceId);

  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: {
      aha: [...new Set([...scope.ahaRefs, ...ahaFromParts])],
      dpj: [],
      mural: [...new Set([...scope.muralIds, ...muralFromParts])],
      figma: [...new Set([...scope.figmaIds, ...figmaFromParts])],
      ado: [],
      github: [],
      options: {
        expectDpjCounterpart: false,
        expectPlanningCounterpart: scope.expectPlanningCounterpart,
        expectDesignCounterpart: scope.expectDesignCounterpart,
        expectEngineeringCounterpart: false,
        expectImplementationCounterpart: false,
        dpjProjectId: null,
        transition: "lifecycle",
      },
    },
    systemsQueried: [...systemsQueried],
    systemsNotQueried: [
      { system: "dpj", reason: "outside the lifecycle research/design/planning scope of this run" },
      { system: "azure_devops", reason: "no Azure DevOps connector in this repository" },
      { system: "github", reason: "no GitHub connector for this path" },
      ...(!systemsQueried.has("mural") ? [{ system: "mural" as const, reason: "no mural named for this run" }] : []),
      ...(!systemsQueried.has("figma")
        ? [{ system: "figma" as const, reason: "no Figma evidence supplied (IDE handoff required)" }]
        : []),
    ],
    artifacts: [...artifacts.values()],
    evidence,
    candidateSets,
    relationships,
    alignments,
    discrepancies,
    proposals,
    downstreamLinks,
    lifecyclePaths: [],
    retrievalLog,
    limitations: [...new Set(limitations)],
    rulesApplied: describeRules(ruleIds),
  };
}

/** Aha keys that appear as targets of both a mural and a Figma relationship. */
export function buildLifecyclePaths(relationships: RelationshipAssessment[]): LifecyclePath[] {
  const byAha = new Map<string, { mural?: RelationshipAssessment; figma?: RelationshipAssessment }>();
  for (const rel of relationships) {
    if (rel.targetSystem !== "aha" || !rel.target) continue;
    const entry = byAha.get(rel.target) ?? {};
    if (rel.source.startsWith("mural:")) entry.mural = rel;
    if (rel.source.startsWith("figma:")) entry.figma = rel;
    byAha.set(rel.target, entry);
  }
  const paths: LifecyclePath[] = [];
  for (const [ahaKey, hops] of byAha) {
    if (!hops.mural || !hops.figma) continue;
    paths.push({
      ahaKey,
      muralKey: hops.mural.source,
      figmaKey: hops.figma.source,
      muralRelationshipRef: hops.mural.id,
      figmaRelationshipRef: hops.figma.id,
      muralStatus: hops.mural.status,
      figmaStatus: hops.figma.status,
      explanation: `Independent hops through ${ahaKey}: mural ${hops.mural.status}, Figma ${hops.figma.status} (R-LF-011).`,
    });
  }
  return paths;
}

function assessDirectMuralFigma(
  merged: ReconciliationResult,
  config: RamirezConfig,
): {
  relationships: RelationshipAssessment[];
  alignments: AlignmentAssessment[];
  discrepancies: Discrepancy[];
  evidence: Evidence[];
  ruleIds: string[];
  limitations: string[];
} {
  const murals = merged.artifacts.filter((a) => a.system === "mural");
  const figmas = merged.artifacts.filter((a) => a.system === "figma");
  const relationships: RelationshipAssessment[] = [];
  const alignments: AlignmentAssessment[] = [];
  const discrepancies: Discrepancy[] = [];
  const evidence: Evidence[] = [];
  const ruleIds: string[] = [];
  const limitations: string[] = [];
  let n = 0;
  const next = (p: string) => `${p}-MF${String(++n).padStart(3, "0")}`;

  for (const mural of murals) {
    for (const fig of figmas) {
      const links = mural.links.filter((l) => l.kind === "mural_description_figma_url" && linkMatchesFigma(l, fig));
      let status: RelationshipStatus | null = null;
      let score: number | null = null;
      let method: RelationshipAssessment["method"] = "NONE";
      const refs: string[] = [];
      const raise: string[] = [];
      const rules: string[] = [];

      if (links.length > 0) {
        const verified = links.some((l) => conventionVerified(config, l.kind));
        for (const l of links) {
          const id = next("E");
          evidence.push({
            id,
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: mural.key,
            object: fig.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.url ?? l.targetId,
            retrievalState: "AVAILABLE",
            note: "Figma URL on mural description.",
          });
          refs.push(id);
        }
        rules.push("R-LF-012", verified ? "R-ID-001" : "R-ID-003");
        ruleIds.push("R-LF-012", verified ? "R-ID-001" : "R-ID-003");
        status = verified ? "CONFIRMED" : "PROBABLE";
        score = verified ? SCORE.explicitVerifiedUnique : SCORE.explicitUnverifiedConvention;
        method = "DETERMINISTIC";
        if (!verified) raise.push("Pass verifyConventions including mural_description_figma_url");
      } else {
        const sharedAha = merged.lifecyclePaths.find((p) => p.muralKey === mural.key && p.figmaKey === fig.key);
        const mTitle = mural.title?.value;
        const fTitle = fig.title?.value;
        if (mTitle && fTitle) {
          const sim = jaccard(tokens(mTitle), tokens(fTitle));
          if (sim >= 0.3 || sharedAha) {
            const id = next("E");
            evidence.push({
              id,
              type: "METADATA_INFERENCE",
              role: "SUPPORTING",
              subject: mural.key,
              object: fig.key,
              fields: ["title"],
              provenance: [mural.title!.provenance, fig.title!.provenance],
              value: sharedAha ? `shared_aha=${sharedAha.ahaKey}; jaccard=${sim.toFixed(2)}` : `jaccard=${sim.toFixed(2)}`,
              retrievalState: "AVAILABLE",
              note: sharedAha
                ? "Same Aha in both hops; mural↔Figma title overlap is not identity by itself."
                : "Title overlap only; not identity.",
            });
            refs.push(id);
            status = "POSSIBLE";
            score = Math.min(SCORE.capTitleOnly, Math.round(sim * 100) || SCORE.capSharedKeyword);
            method = "METADATA";
            rules.push("R-MD-003", "R-MD-006");
            ruleIds.push("R-MD-003", "R-MD-006");
            raise.push("Add a Figma URL on the mural description for deterministic research→design identity");
          }
        }
      }

      if (!status) continue;

      const relId = next("R");
      relationships.push({
        id: relId,
        source: mural.key,
        target: fig.key,
        targetSystem: "figma",
        status,
        method,
        score,
        scoreBasis: { baseline: score, capsApplied: method === "METADATA" ? ["title-only"] : [], components: [] },
        evidenceRefs: refs,
        contradictoryEvidenceRefs: [],
        missingEvidence: method === "METADATA" ? ["Deterministic mural→Figma URL"] : [],
        targetRetrievalState: "AVAILABLE",
        ruleRefs: rules,
        explanation:
          method === "DETERMINISTIC"
            ? `Mural→Figma identity via description URL (${status}).`
            : `Mural→Figma metadata-only link (${status}); not identity.`,
        wouldRaiseConfidence: raise,
        wouldLowerConfidence: [],
      });

      if (status !== "CONFIRMED" && status !== "PROBABLE") continue;
      const aligned = alignMuralFigma(mural, fig);
      alignments.push({
        id: next("A"),
        relationshipRef: relId,
        status: aligned.status,
        comparisons: aligned.comparisons,
        evidenceRefs: [],
        ruleRefs: aligned.ruleRefs,
        explanation: aligned.explanation,
      });
      ruleIds.push(...aligned.ruleRefs);
      for (const cmp of aligned.comparisons.filter((c) => c.result === "DIFFERENT")) {
        const spec = LIFECYCLE_DISCREPANCY.RESEARCH_DESIGN_MISMATCH!;
        discrepancies.push({
          id: next("D"),
          kind: cmp.field === "description" ? "RESEARCH_DESIGN_MISMATCH" : "TITLE_CONFLICT",
          severity: cmp.field === "description" ? spec.severity : "MEDIUM",
          systems: ["mural", "figma"],
          records: [mural.key, fig.key],
          values: [
            { artifact: mural.key, field: cmp.field, value: cmp.sourceValue },
            { artifact: fig.key, field: cmp.field, value: cmp.targetValue },
          ],
          businessImpact: cmp.field === "description" ? spec.impact : "Research board title and design frame name differ.",
          evidenceRefs: refs,
          ruleRefs: cmp.field === "description" ? spec.ruleRefs : aligned.ruleRefs,
          relationshipRef: relId,
          authority: "UNKNOWN",
          recommendedResolution: "Review research vs design; Ramirez does not apply changes (PROPOSAL_ONLY).",
        });
        if (cmp.field === "description") ruleIds.push(...spec.ruleRefs);
      }
    }
  }

  if (relationships.length === 0 && murals.length && figmas.length) {
    limitations.push("No direct mural↔Figma identity found (no matching Figma URL on mural description; title metadata insufficient).");
  }
  return { relationships, alignments, discrepancies, evidence, ruleIds, limitations };
}

function alignMuralFigma(mural: Artifact, figma: Artifact): {
  status: AlignmentAssessment["status"];
  comparisons: FieldComparison[];
  ruleRefs: string[];
  explanation: string;
} {
  const comparisons: FieldComparison[] = [];
  const ruleRefs = ["R-AL-001", "R-AL-002", "R-AL-003", "R-AL-009"];
  const mTitle = stripIdentityPrefix(mural.title?.value ?? "");
  const fTitle = stripIdentityPrefix(figma.title?.value ?? "");
  comparisons.push({
    field: "title",
    sourceValue: mTitle || null,
    targetValue: fTitle || null,
    result: !mTitle || !fTitle ? "NOT_COMPARABLE" : normalizeTitle(mTitle) === normalizeTitle(fTitle) ? "EQUAL" : "DIFFERENT",
    method: "NORMALIZED",
    evidenceRefs: [],
    ruleRef: "R-AL-002",
  });
  const mDesc = comparableDescription(mural.description?.value ?? "");
  const fDesc = comparableDescription(figma.description?.value ?? "");
  if (!mDesc || !fDesc) {
    comparisons.push({
      field: "description",
      sourceValue: mDesc || null,
      targetValue: fDesc || null,
      result: "NOT_COMPARABLE",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: "one side has no description",
    });
  } else {
    const sim = jaccard(tokens(mDesc), tokens(fDesc));
    comparisons.push({
      field: "description",
      sourceValue: excerpt(mDesc, 200) ?? null,
      targetValue: excerpt(fDesc, 200) ?? null,
      result: sim >= 0.5 ? "EQUAL" : "DIFFERENT",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: `lexical overlap ${sim.toFixed(2)}`,
    });
  }
  const different = comparisons.filter((c) => c.result === "DIFFERENT");
  const status = different.some((c) => c.field === "description")
    ? "CONTRADICTORY"
    : different.length
      ? "PARTIALLY_ALIGNED"
      : comparisons.some((c) => c.result === "EQUAL")
        ? "ALIGNED"
        : "NOT_EVALUATED";
  return {
    status,
    comparisons,
    ruleRefs,
    explanation: `${different.length} field(s) differ between mural and Figma: ${different.map((c) => c.field).join(", ") || "none"}.`,
  };
}
