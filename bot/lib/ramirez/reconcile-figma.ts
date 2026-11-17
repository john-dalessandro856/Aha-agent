// Figma ↔ Aha reconciliation. Figma evidence is operator/IDE-supplied only —
// Ramirez never opens a Figma MCP connection.
import { normalizeFigmaNode } from "./adapters/figma";
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

export type FigmaEvidenceInput = {
  fileKey: string;
  fileName?: string;
  nodeId?: string;
  nodeName?: string;
  pages?: Array<{ id: string; name: string }>;
  url?: string;
  note?: string;
  retrievedAt?: string;
};

export type ReconcileFigmaInput = {
  ahaRefs: string[];
  figma: FigmaEvidenceInput[];
  expectDesignCounterpart: boolean;
};

export type ReconcileFigmaDeps = {
  aha: PlanningAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

type Pair = {
  figma: Artifact;
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

export function figmaFileKey(artifact: Artifact): string | undefined {
  return artifact.externalIds.find((e) => e.scheme === "figma_file_key")?.value ?? artifact.project?.value.id;
}

/** True when an Aha Figma link names this file (or a node inside it). */
export function linkMatchesFigma(link: CrossSystemLink, figma: Artifact): boolean {
  if (link.targetSystem !== "figma" || !link.targetId) return false;
  const fk = figmaFileKey(figma);
  if (!fk) return false;
  return link.targetId === figma.sourceId || link.targetId === fk || link.targetId.startsWith(`${fk}:`);
}

export async function reconcileFigma(input: ReconcileFigmaInput, deps: ReconcileFigmaDeps): Promise<ReconciliationResult> {
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

  limitations.push("Figma was not queried by Ramirez; evidence was supplied by the operator/IDE.");
  limitations.push("No Mural, DPJ, Azure DevOps, or GitHub retrieval was performed in this Figma↔Aha run.");

  // ---- Normalize supplied Figma evidence (no MCP) ---------------------------
  const figmaArtifacts: Artifact[] = [];
  for (const item of input.figma) {
    const artifact = normalizeFigmaNode(
      {
        fileKey: item.fileKey,
        ...(item.fileName ? { fileName: item.fileName } : {}),
        ...(item.nodeId ? { nodeId: item.nodeId.replace("-", ":") } : {}),
        ...(item.nodeName ? { nodeName: item.nodeName } : {}),
        ...(item.pages ? { pages: item.pages } : {}),
        ...(item.note ? { note: item.note } : {}),
      },
      item.retrievedAt ?? now(),
      "operator_ide_evidence",
      config,
    );
    artifacts.set(artifact.key, artifact);
    figmaArtifacts.push(artifact);
    session.queried.add("figma");
    session.log.push({
      system: "figma",
      operation: "normalize_evidence",
      target: artifact.sourceId,
      state: "AVAILABLE",
      question: "Accept operator/IDE-supplied Figma evidence",
      cached: false,
      resultCount: 1,
      at: now(),
      note: "No Figma MCP call; INTERFACE_ONLY",
    });
  }

  const ahaRefs = [...new Set(input.ahaRefs)];
  const ahaAnchors: Array<{ ref: string; artifact?: Artifact; state: import("./types").RetrievalState }> = [];
  for (const ref of ahaRefs) {
    const res = await session.run("aha", "read_records", ref, "Resolve the selected Aha record", () => aha.getById(ref));
    if (res.value) artifacts.set(res.value.key, res.value);
    ahaAnchors.push({ ref, ...(res.value ? { artifact: res.value } : {}), state: res.state });
  }

  // Follow figma title → Aha
  for (const fig of figmaArtifacts) {
    for (const link of fig.links) {
      if (link.targetSystem === "aha" && link.targetId && link.claimsIdentity && !ahaAnchors.some((a) => a.ref === link.targetId)) {
        rule("R-LF-003");
        const r = await session.run("aha", "read_records", link.targetId, "Resolve Aha ref from Figma title", () => aha.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        ahaAnchors.push({ ref: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
      }
    }
  }

  const pairs: Pair[] = [];
  const pairedAha = new Set<string>();
  const pairedFigma = new Set<string>();

  for (const fig of figmaArtifacts) {
    const candidates = new Map<string, { artifact: Artifact; linksFromFigma: CrossSystemLink[]; linksFromAha: CrossSystemLink[] }>();

    for (const link of fig.links.filter((l) => l.targetSystem === "aha" && l.targetId && l.claimsIdentity)) {
      const hit = ahaAnchors.find((a) => a.ref === link.targetId && a.artifact);
      if (!hit?.artifact) continue;
      const c = candidates.get(hit.artifact.sourceId) ?? { artifact: hit.artifact, linksFromFigma: [], linksFromAha: [] };
      c.linksFromFigma.push(link);
      candidates.set(hit.artifact.sourceId, c);
    }
    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      for (const link of a.artifact.links.filter((l) => linkMatchesFigma(l, fig) && l.claimsIdentity)) {
        const c = candidates.get(a.artifact.sourceId) ?? { artifact: a.artifact, linksFromFigma: [], linksFromAha: [] };
        c.linksFromAha.push(link);
        candidates.set(a.artifact.sourceId, c);
      }
    }

    // Stale link: Aha points at a different fileKey than this evidence, while also matching via title ref
    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      const otherFileLinks = a.artifact.links.filter(
        (l) => l.targetSystem === "figma" && l.claimsIdentity && l.targetId && !linkMatchesFigma(l, fig),
      );
      const pairsHere = candidates.has(a.artifact.sourceId);
      if (pairsHere && otherFileLinks.length > 0) {
        const spec = LIFECYCLE_DISCREPANCY.STALE_DESIGN_LINK!;
        discrepancies.push({
          id: nextId("D"),
          kind: "STALE_DESIGN_LINK",
          severity: spec.severity,
          systems: ["aha", "figma"],
          records: [a.artifact.key, fig.key],
          values: [
            { artifact: a.artifact.key, field: "link", value: otherFileLinks[0]!.url ?? otherFileLinks[0]!.targetId ?? null, provenance: otherFileLinks[0]!.provenance },
            { artifact: fig.key, field: "fileKey", value: figmaFileKey(fig) ?? null, provenance: fig.externalIds[0]?.provenance },
          ],
          businessImpact: spec.impact,
          evidenceRefs: [],
          ruleRefs: spec.ruleRefs,
          authority: "UNKNOWN",
          recommendedResolution: "Update the Figma URL on the Aha record to the file under review, or supply matching evidence.",
        });
        rule(...spec.ruleRefs);
      }
    }

    const idSetId = nextId("C");
    candidateSets.push({
      id: idSetId,
      source: fig.key,
      targetSystem: "aha",
      candidates: [...candidates.keys()].map((id) => `aha:${id}`),
      rejected: [],
      discoveryMethod: "Explicit Figma↔Aha identity links (URL and/or title ref)",
      queriedScope: `figma ${fig.sourceId} + named Aha refs`,
      retrievalState: "AVAILABLE",
      truncated: false,
    });

    if (candidates.size === 0) {
      const title = fig.title?.value;
      if (title && ahaAnchors.some((a) => a.artifact)) {
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
                subject: fig.key,
                object: a.artifact.key,
                fields: ["title"],
                provenance: [fig.title!.provenance, a.artifact.title.provenance],
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
            figma: fig,
            aha: s.aha,
            status: s.score >= 50 ? "POSSIBLE" : "NOT_EVALUATED",
            score: Math.min(s.score, SCORE.capTitleOnly),
            method: "METADATA",
            evidenceRefs: s.refs,
            contradictoryRefs: [],
            ruleRefs: ["R-MD-003", "R-MD-006"],
            explanation: `Title-only metadata match capped at ${SCORE.capTitleOnly}. Not identity.`,
            raise: ["Add a Figma URL on the Aha record or an Aha ref in the Figma frame name"],
            lower: [],
            missing: ["Deterministic identity link"],
          });
          pairedAha.add(s.aha.sourceId);
          pairedFigma.add(fig.key);
          rule("R-MD-003", "R-MD-006");
        } else if (scored.length > 1) {
          relationships.push({
            id: nextId("R"),
            source: fig.key,
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
            explanation: `Multiple title-similar Aha candidates for Figma ${fig.sourceId}; ambiguous.`,
            wouldRaiseConfidence: ["Operator names one Aha reference"],
            wouldLowerConfidence: [],
            candidateSetRef: idSetId,
          });
          rule("R-MD-005");
        }
      }

      if (!pairedFigma.has(fig.key)) {
        const orphanSpec = LIFECYCLE_DISCREPANCY.ORPHAN_DESIGN_EVIDENCE!;
        if (input.expectDesignCounterpart) {
          discrepancies.push({
            id: nextId("D"),
            kind: "ORPHAN_DESIGN_EVIDENCE",
            severity: orphanSpec.severity,
            systems: ["figma", "aha"],
            records: [fig.key],
            values: [{ artifact: fig.key, field: "title", value: fig.title?.value ?? null, provenance: fig.title?.provenance }],
            businessImpact: orphanSpec.impact,
            evidenceRefs: [],
            ruleRefs: orphanSpec.ruleRefs,
            authority: "UNKNOWN",
            recommendedResolution: "Name the Aha record this design belongs to, or set expectDesignCounterpart false.",
          });
          rule(...orphanSpec.ruleRefs);
        }
        relationships.push({
          id: nextId("R"),
          source: fig.key,
          targetSystem: "aha",
          status: "NOT_EVALUATED",
          method: "NONE",
          score: null,
          scoreBasis: emptyScore(),
          evidenceRefs: [],
          contradictoryEvidenceRefs: [],
          missingEvidence: ["No Aha counterpart in queried scope"],
          targetRetrievalState: "NOT_FOUND_WITHIN_QUERIED_SCOPE",
          ruleRefs: input.expectDesignCounterpart ? orphanSpec.ruleRefs : [],
          explanation: input.expectDesignCounterpart
            ? `No Aha counterpart found for Figma ${fig.sourceId} (ORPHAN_DESIGN_EVIDENCE). Not MISSING under R-MISS-001.`
            : `No Aha counterpart linked for Figma ${fig.sourceId}. Expectation was off; no omission asserted.`,
          wouldRaiseConfidence: ["Provide an Aha reference or put a Figma URL on the Aha record"],
          wouldLowerConfidence: [],
          candidateSetRef: idSetId,
        });
      }
      continue;
    }

    for (const c of candidates.values()) {
      const refs: string[] = [];
      for (const l of c.linksFromFigma) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: fig.key,
            object: c.artifact.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.targetId,
            retrievalState: "AVAILABLE",
            note: `Figma title convention (${l.kind}).`,
          }),
        );
        rule("R-LF-003");
      }
      for (const l of c.linksFromAha) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: c.artifact.key,
            object: fig.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.url ?? l.targetId,
            retrievalState: "AVAILABLE",
            note: `Aha Figma URL (${l.kind}).`,
          }),
        );
        rule("R-LF-001");
      }

      const verified =
        c.linksFromFigma.some((l) => conventionVerified(config, l.kind)) || c.linksFromAha.some((l) => conventionVerified(config, l.kind));
      const bothWays = c.linksFromFigma.length > 0 && c.linksFromAha.length > 0;
      let status: RelationshipStatus;
      let score: number;
      let rules: string[];
      let explanation: string;
      const raise: string[] = [];
      if (bothWays || verified) {
        status = "CONFIRMED";
        score = SCORE.explicitVerifiedUnique;
        rules = ["R-ID-001", ...(c.linksFromFigma.length ? ["R-LF-003"] : []), ...(c.linksFromAha.length ? ["R-LF-001"] : [])];
        explanation = bothWays
          ? `Identity established by links on both Figma and Aha. Baseline ${SCORE.explicitVerifiedUnique}.`
          : `Identity established by operator-verified convention. Baseline ${SCORE.explicitVerifiedUnique}.`;
        rule("R-ID-001");
      } else {
        status = "PROBABLE";
        score = SCORE.explicitUnverifiedConvention;
        rules = ["R-ID-003", ...(c.linksFromFigma.length ? ["R-LF-003"] : []), ...(c.linksFromAha.length ? ["R-LF-001"] : [])];
        explanation = `One-directional or unverified Figma↔Aha link. Baseline ${SCORE.explicitUnverifiedConvention}, PROBABLE.`;
        raise.push("Pass verifyConventions for the link kinds you trust");
        if (!bothWays) raise.push("Add the reverse link (Figma URL on Aha or Aha ref in the frame name)");
        rule("R-ID-003");
      }

      pairs.push({
        figma: fig,
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
      pairedFigma.add(fig.key);
    }
  }

  // Aha in scope with expectation but no design pair
  if (input.expectDesignCounterpart && figmaArtifacts.length > 0) {
    for (const a of ahaAnchors) {
      if (!a.artifact || pairedAha.has(a.artifact.sourceId)) continue;
      const hasFigmaLink = a.artifact.links.some((l) => l.targetSystem === "figma" && l.claimsIdentity);
      if (hasFigmaLink) continue;
      const spec = LIFECYCLE_DISCREPANCY.PLANNING_ABSENT_FROM_DESIGN!;
      discrepancies.push({
        id: nextId("D"),
        kind: "PLANNING_ABSENT_FROM_DESIGN",
        severity: spec.severity,
        systems: ["aha", "figma"],
        records: [a.artifact.key, ...figmaArtifacts.map((f) => f.key)],
        values: [{ artifact: a.artifact.key, field: "title", value: a.artifact.title?.value ?? null, provenance: a.artifact.title?.provenance }],
        businessImpact: spec.impact,
        evidenceRefs: [],
        ruleRefs: spec.ruleRefs,
        authority: "UNKNOWN",
        recommendedResolution: "Supply matching Figma evidence or link the design URL on the Aha record.",
      });
      rule(...spec.ruleRefs);
    }
  }

  for (const p of pairs) {
    const relId = nextId("R");
    relationships.push({
      id: relId,
      source: p.figma.key,
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
    const aligned = assessFigmaAhaAlignment(p.figma, p.aha);
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
      const designSpec = LIFECYCLE_DISCREPANCY.DESIGN_PLANNING_MISMATCH!;
      const kind = cmp.field === "description" ? "DESIGN_PLANNING_MISMATCH" : "TITLE_CONFLICT";
      const severity = cmp.field === "description" ? designSpec.severity : "MEDIUM";
      discrepancies.push({
        id: nextId("D"),
        kind,
        severity,
        systems: ["figma", "aha"],
        records: [p.figma.key, p.aha.key],
        values: [
          { artifact: p.figma.key, field: cmp.field, value: cmp.sourceValue },
          { artifact: p.aha.key, field: cmp.field, value: cmp.targetValue },
        ],
        businessImpact: cmp.field === "description" ? designSpec.impact : "Design frame name and planning title differ.",
        evidenceRefs: [...p.evidenceRefs],
        ruleRefs: cmp.field === "description" ? designSpec.ruleRefs : [...aligned.ruleRefs],
        relationshipRef: relId,
        authority: "UNKNOWN",
        recommendedResolution: "Review both values; Ramirez does not choose an authority unless you configure one.",
      });
      if (cmp.field === "description") rule(...designSpec.ruleRefs);
    }
  }

  if (config.conventions.ahaDescriptionFigmaUrl.enabled && !config.conventions.ahaDescriptionFigmaUrl.verified) {
    limitations.push("Unverified Figma URL conventions cap those links at PROBABLE until you pass verifyConventions.");
  }
  if (config.conventions.figmaTitleAhaRef.enabled && !config.conventions.figmaTitleAhaRef.verified) {
    limitations.push("Unverified figma title Aha-ref convention caps those links at PROBABLE until verified.");
  }

  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: {
      aha: ahaRefs,
      dpj: [],
      mural: [],
      figma: figmaArtifacts.map((f) => f.sourceId),
      ado: [],
      github: [],
      options: {
        expectDpjCounterpart: false,
        expectPlanningCounterpart: false,
        expectDesignCounterpart: input.expectDesignCounterpart,
        expectEngineeringCounterpart: false,
        expectImplementationCounterpart: false,
        dpjProjectId: null,
        transition: "figma_aha",
      },
    },
    systemsQueried: [...session.queried],
    systemsNotQueried: [
      { system: "mural", reason: "outside the Figma ↔ Aha scope of this run" },
      { system: "dpj", reason: "outside the Figma ↔ Aha scope of this run" },
      { system: "azure_devops", reason: "no Azure DevOps connector in this repository" },
      { system: "github", reason: "no GitHub connector for this path" },
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

export function assessFigmaAhaAlignment(figma: Artifact, aha: Artifact): {
  status: AlignmentStatus;
  comparisons: FieldComparison[];
  ruleRefs: string[];
  explanation: string;
} {
  const comparisons: FieldComparison[] = [];
  const ruleRefs = new Set<string>(["R-AL-001", "R-AL-002"]);
  const fTitle = stripIdentityPrefix(figma.title?.value ?? "");
  const aTitle = stripIdentityPrefix(aha.title?.value ?? "");
  comparisons.push({
    field: "title",
    sourceValue: fTitle || null,
    targetValue: aTitle || null,
    result: !fTitle || !aTitle ? "NOT_COMPARABLE" : normalizeTitle(fTitle) === normalizeTitle(aTitle) ? "EQUAL" : "DIFFERENT",
    method: "NORMALIZED",
    evidenceRefs: [],
    ruleRef: "R-AL-002",
    ...(!fTitle || !aTitle ? { note: "one side is empty" } : {}),
  });

  ruleRefs.add("R-AL-003");
  const fDesc = comparableDescription(figma.description?.value ?? "");
  const aDesc = comparableDescription(aha.description?.value ?? "");
  if (!fDesc || !aDesc) {
    comparisons.push({
      field: "description",
      sourceValue: fDesc || null,
      targetValue: aDesc || null,
      result: "NOT_COMPARABLE",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: "one side has no description",
    });
  } else {
    const sim = jaccard(tokens(fDesc), tokens(aDesc));
    comparisons.push({
      field: "description",
      sourceValue: excerpt(fDesc, 200) ?? null,
      targetValue: excerpt(aDesc, 200) ?? null,
      result: sim >= 0.5 ? "EQUAL" : "DIFFERENT",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: `lexical overlap ${sim.toFixed(2)} (threshold 0.50)`,
    });
  }

  const different = comparisons.filter((c) => c.result === "DIFFERENT");
  let status: AlignmentStatus;
  if (different.some((c) => c.field === "description")) status = "CONTRADICTORY";
  else if (different.length > 0) status = "PARTIALLY_ALIGNED";
  else if (comparisons.some((c) => c.result === "EQUAL")) status = "ALIGNED";
  else status = "NOT_EVALUATED";
  ruleRefs.add("R-AL-009");
  return {
    status,
    comparisons,
    ruleRefs: [...ruleRefs].sort(),
    explanation: `${different.length} field(s) differ: ${different.map((c) => c.field).join(", ") || "none"}. Figma↔Aha compares title and description only.`,
  };
}
