// Mural ↔ Aha reconciliation. Read-only. Sticky text is never identity.
import { conventionVerified, type RamirezConfig } from "./config";
import { resolveMuralId } from "./links";
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
  type RetrievalState,
  type ScoreBasis,
} from "./types";
import type { MuralEvidenceAdapter, PlanningAdapter, RetrievalSession } from "./retrieval";

export type ReconcileMuralInput = {
  muralIds: string[];
  ahaRefs: string[];
  expectPlanningCounterpart: boolean;
  includeStickyExcerpts: boolean;
};

export type ReconcileMuralDeps = {
  aha: PlanningAdapter;
  mural: MuralEvidenceAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

type Pair = {
  mural: Artifact;
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

export async function reconcileMural(input: ReconcileMuralInput, deps: ReconcileMuralDeps): Promise<ReconciliationResult> {
  const { aha, mural, session, config, now } = deps;
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

  const muralIds = [...new Set(input.muralIds.map((x) => resolveMuralId(x)).filter((x): x is string => Boolean(x)))];
  const unresolvedUrls = input.muralIds.filter((x) => !resolveMuralId(x));
  for (const bad of unresolvedUrls) limitations.push(`Could not parse mural id from "${bad.slice(0, 80)}".`);

  const ahaRefs = [...new Set(input.ahaRefs)];

  // ---- Resolve murals -------------------------------------------------------
  const muralAnchors: Array<{ id: string; artifact?: Artifact; state: RetrievalState }> = [];
  for (const id of muralIds) {
    const res = await session.run("mural", "get_mural_info", id, "Resolve the selected mural board", () => mural.getById(id));
    let artifact = res.value;
    if (artifact && input.includeStickyExcerpts && mural.getStickyExcerpts) {
      const sticky = await session.run("mural", "get_document_tree", id, "Sticky/area text as evidence context only", () => mural.getStickyExcerpts!(id));
      if (sticky.state === "AVAILABLE" && sticky.value) {
        const note = excerpt(sticky.value, 400) ?? sticky.value.slice(0, 400);
        const base = artifact.description?.value ?? "";
        artifact = {
          ...artifact,
          description: {
            value: [base, `sticky_excerpts=${note}`].filter(Boolean).join(" | "),
            provenance: {
              system: "mural",
              sourceRecordId: artifact.sourceId,
              sourceField: "document_tree",
              retrievedAt: now(),
              retrievalMethod: "get_document_tree",
              adapter: "mural-mcp-read@1",
              excerpt: note,
            },
          },
        };
        limitations.push(`Sticky excerpts on mural ${id} are evidence context only; they never establish identity (R-LF-004 / R-ID-007).`);
      } else if (sticky.state !== "AVAILABLE") {
        limitations.push(`Sticky excerpts for mural ${id} not retrieved (${sticky.state}).`);
      }
    }
    if (artifact) artifacts.set(artifact.key, artifact);
    muralAnchors.push({ id, ...(artifact ? { artifact } : {}), state: res.state });
  }

  // ---- Resolve Aha anchors --------------------------------------------------
  const ahaAnchors: Array<{ ref: string; artifact?: Artifact; state: RetrievalState }> = [];
  for (const ref of ahaRefs) {
    const res = await session.run("aha", "read_records", ref, "Resolve the selected Aha record", () => aha.getById(ref));
    if (res.value) artifacts.set(res.value.key, res.value);
    ahaAnchors.push({ ref, ...(res.value ? { artifact: res.value } : {}), state: res.state });
  }

  // Follow mural → Aha title refs
  for (const m of muralAnchors) {
    for (const link of m.artifact?.links ?? []) {
      if (link.targetSystem === "aha" && link.targetId && link.claimsIdentity && !ahaAnchors.some((a) => a.ref === link.targetId)) {
        rule("R-LF-004");
        const r = await session.run("aha", "read_records", link.targetId, "Resolve Aha ref from mural title", () => aha.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        ahaAnchors.push({ ref: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
      }
    }
  }

  // Follow Aha → mural URLs
  for (const a of ahaAnchors) {
    for (const link of a.artifact?.links ?? []) {
      if (link.targetSystem === "mural" && link.targetId && link.claimsIdentity && !muralAnchors.some((m) => m.id === link.targetId)) {
        rule("R-LF-002");
        const r = await session.run("mural", "get_mural_info", link.targetId, "Resolve mural linked from Aha", () => mural.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        muralAnchors.push({ id: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
        if (r.state === "NOT_FOUND_WITHIN_QUERIED_SCOPE") {
          discrepancies.push({
            id: nextId("D"),
            kind: "POTENTIAL_BROKEN_LINK",
            severity: "MEDIUM",
            systems: ["aha", "mural"],
            records: [a.artifact!.key, `mural:${link.targetId}`],
            values: [{ artifact: a.artifact!.key, field: "link", value: link.url ?? link.targetId ?? null, provenance: link.provenance }],
            businessImpact: "The Aha record points at a mural the exact-id lookup could not find.",
            evidenceRefs: [
              addEvidence({
                type: "EXPLICIT_IDENTIFIER_LINK",
                role: "SUPPORTING",
                subject: a.artifact!.key,
                object: `mural:${link.targetId}`,
                fields: ["links"],
                provenance: [link.provenance],
                value: link.targetId,
                retrievalState: r.state,
                note: "Explicit mural link; board lookup did not resolve it.",
              }),
            ],
            ruleRefs: ["R-ID-006"],
            authority: "UNKNOWN",
            recommendedResolution: "Confirm the mural still exists, then correct the URL on the Aha record.",
          });
          rule("R-ID-006");
        }
      }
    }
  }

  // ---- Pair each mural with Aha candidates ----------------------------------
  const pairs: Pair[] = [];
  const pairedAha = new Set<string>();

  for (const mAnchor of muralAnchors) {
    if (!mAnchor.artifact) {
      relationships.push({
        id: nextId("R"),
        source: `mural:${mAnchor.id}`,
        targetSystem: "aha",
        status: "NOT_EVALUATED",
        method: "NONE",
        score: null,
        scoreBasis: emptyScore(),
        evidenceRefs: [],
        contradictoryEvidenceRefs: [],
        missingEvidence: ["Mural board not retrieved"],
        targetRetrievalState: mAnchor.state,
        ruleRefs: [],
        explanation: `Mural ${mAnchor.id} was not retrieved (${mAnchor.state}). No relationship is asserted.`,
        wouldRaiseConfidence: [],
        wouldLowerConfidence: [],
      });
      continue;
    }
    const board = mAnchor.artifact;
    const candidates = new Map<string, { artifact: Artifact; linksFromMural: CrossSystemLink[]; linksFromAha: CrossSystemLink[] }>();

    for (const link of board.links.filter((l) => l.targetSystem === "aha" && l.targetId && l.claimsIdentity)) {
      const hit = ahaAnchors.find((a) => a.ref === link.targetId && a.artifact);
      if (!hit?.artifact) continue;
      const c = candidates.get(hit.artifact.sourceId) ?? { artifact: hit.artifact, linksFromMural: [], linksFromAha: [] };
      c.linksFromMural.push(link);
      candidates.set(hit.artifact.sourceId, c);
    }
    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      for (const link of a.artifact.links.filter((l) => l.targetSystem === "mural" && l.targetId === board.sourceId && l.claimsIdentity)) {
        const c = candidates.get(a.artifact.sourceId) ?? { artifact: a.artifact, linksFromMural: [], linksFromAha: [] };
        c.linksFromAha.push(link);
        candidates.set(a.artifact.sourceId, c);
      }
    }

    const idSetId = nextId("C");
    candidateSets.push({
      id: idSetId,
      source: board.key,
      targetSystem: "aha",
      candidates: [...candidates.keys()].map((id) => `aha:${id}`),
      rejected: [],
      discoveryMethod: "Explicit mural↔Aha identity links (URL and/or title ref)",
      queriedScope: `mural ${board.sourceId} + named Aha refs`,
      retrievalState: "AVAILABLE",
      truncated: false,
    });

    if (candidates.size === 0) {
      // Metadata fallback: title search against named Aha only (no portfolio sweep)
      const title = board.title?.value;
      if (title && ahaAnchors.some((a) => a.artifact)) {
        const scored: Array<{ aha: Artifact; score: number; refs: string[] }> = [];
        for (const a of ahaAnchors) {
          if (!a.artifact?.title?.value) continue;
          const sim = jaccard(tokens(title), tokens(a.artifact.title.value));
          if (sim < 0.3) continue;
          const refs = [
            addEvidence({
              type: "METADATA_INFERENCE",
              role: "SUPPORTING",
              subject: board.key,
              object: a.artifact.key,
              fields: ["title"],
              provenance: [board.title!.provenance, a.artifact.title.provenance],
              value: `jaccard=${sim.toFixed(2)}`,
              retrievalState: "AVAILABLE",
              note: "Title overlap only; not identity.",
            }),
          ];
          scored.push({ aha: a.artifact, score: Math.min(SCORE.capTitleOnly, Math.round(sim * 100)), refs });
        }
        if (scored.length === 1 && scored[0]!.score >= SCORE.candidateFloor) {
          const s = scored[0]!;
          pairs.push({
            mural: board,
            aha: s.aha,
            status: s.score >= 50 ? "POSSIBLE" : "NOT_EVALUATED",
            score: Math.min(s.score, SCORE.capTitleOnly),
            method: "METADATA",
            evidenceRefs: s.refs,
            contradictoryRefs: [],
            ruleRefs: ["R-MD-003", "R-MD-006"],
            explanation: `Title-only metadata match capped at ${SCORE.capTitleOnly}. Not identity.`,
            raise: ["Add a mural URL on the Aha record or an Aha ref in the mural title"],
            lower: [],
            missing: ["Deterministic identity link"],
          });
          pairedAha.add(s.aha.sourceId);
          rule("R-MD-003", "R-MD-006");
        } else if (scored.length > 1) {
          relationships.push({
            id: nextId("R"),
            source: board.key,
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
            explanation: `Multiple title-similar Aha candidates for mural ${board.sourceId}; ambiguous.`,
            wouldRaiseConfidence: ["Operator names one Aha reference"],
            wouldLowerConfidence: [],
            candidateSetRef: idSetId,
          });
          rule("R-MD-005");
        }
      }

      if (!pairs.some((p) => p.mural.key === board.key)) {
        const orphanSpec = LIFECYCLE_DISCREPANCY.ORPHAN_RESEARCH_EVIDENCE!;
        if (input.expectPlanningCounterpart) {
          discrepancies.push({
            id: nextId("D"),
            kind: "ORPHAN_RESEARCH_EVIDENCE",
            severity: orphanSpec.severity,
            systems: ["mural", "aha"],
            records: [board.key],
            values: [{ artifact: board.key, field: "title", value: board.title?.value ?? null, provenance: board.title?.provenance }],
            businessImpact: orphanSpec.impact,
            evidenceRefs: [],
            ruleRefs: orphanSpec.ruleRefs,
            authority: "UNKNOWN",
            recommendedResolution: "Name the Aha record this board belongs to, or set expectPlanningCounterpart false.",
          });
          rule(...orphanSpec.ruleRefs);
        }
        relationships.push({
          id: nextId("R"),
          source: board.key,
          targetSystem: "aha",
          status: "NOT_EVALUATED",
          method: "NONE",
          score: null,
          scoreBasis: emptyScore(),
          evidenceRefs: [],
          contradictoryEvidenceRefs: [],
          missingEvidence: ["No Aha counterpart in queried scope"],
          targetRetrievalState: "NOT_FOUND_WITHIN_QUERIED_SCOPE",
          ruleRefs: input.expectPlanningCounterpart ? orphanSpec.ruleRefs : [],
          explanation: input.expectPlanningCounterpart
            ? `No Aha counterpart found for mural ${board.sourceId} under the queried scope (ORPHAN_RESEARCH_EVIDENCE). Not MISSING under R-MISS-001.`
            : `No Aha counterpart linked for mural ${board.sourceId}. Expectation was off; no omission asserted.`,
          wouldRaiseConfidence: ["Provide an Aha reference or put a mural URL on the Aha record"],
          wouldLowerConfidence: [],
          candidateSetRef: idSetId,
        });
      }
      continue;
    }

    for (const c of candidates.values()) {
      const refs: string[] = [];
      for (const l of c.linksFromMural) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: board.key,
            object: c.artifact.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.targetId,
            retrievalState: "AVAILABLE",
            note: `Mural title convention (${l.kind}).`,
          }),
        );
        rule("R-LF-004");
      }
      for (const l of c.linksFromAha) {
        refs.push(
          addEvidence({
            type: "EXPLICIT_IDENTIFIER_LINK",
            role: "SUPPORTING",
            subject: c.artifact.key,
            object: board.key,
            fields: [l.kind],
            provenance: [l.provenance],
            value: l.url ?? l.targetId,
            retrievalState: "AVAILABLE",
            note: `Aha mural URL (${l.kind}).`,
          }),
        );
        rule("R-LF-002");
      }

      const muralVerified = c.linksFromMural.some((l) => conventionVerified(config, l.kind));
      const ahaVerified = c.linksFromAha.some((l) => conventionVerified(config, l.kind));
      const bothWays = c.linksFromMural.length > 0 && c.linksFromAha.length > 0;
      const verified = muralVerified || ahaVerified;

      let status: RelationshipStatus;
      let score: number;
      let rules: string[];
      let explanation: string;
      const raise: string[] = [];
      if (bothWays || verified) {
        status = "CONFIRMED";
        score = SCORE.explicitVerifiedUnique;
        rules = ["R-ID-001", ...(c.linksFromMural.length ? ["R-LF-004"] : []), ...(c.linksFromAha.length ? ["R-LF-002"] : [])];
        explanation = bothWays
          ? `Identity established by links on both mural and Aha. Baseline ${SCORE.explicitVerifiedUnique}.`
          : `Identity established by operator-verified convention. Baseline ${SCORE.explicitVerifiedUnique}.`;
        rule("R-ID-001");
      } else {
        status = "PROBABLE";
        score = SCORE.explicitUnverifiedConvention;
        rules = ["R-ID-003", ...(c.linksFromMural.length ? ["R-LF-004"] : []), ...(c.linksFromAha.length ? ["R-LF-002"] : [])];
        explanation = `One-directional or unverified mural↔Aha link. Baseline ${SCORE.explicitUnverifiedConvention}, PROBABLE.`;
        raise.push("Pass verifyConventions for the link kinds you trust");
        if (!bothWays) raise.push("Add the reverse link (mural URL on Aha or Aha ref in mural title)");
        rule("R-ID-003");
      }

      pairs.push({
        mural: board,
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
    }
  }

  // Aha named but never paired — research absent / planning without board
  for (const a of ahaAnchors) {
    if (!a.artifact || pairedAha.has(a.artifact.sourceId)) continue;
    if (!input.expectPlanningCounterpart) continue;
    if (muralAnchors.length === 0) continue;
    const spec = LIFECYCLE_DISCREPANCY.RESEARCH_ABSENT_FROM_PLANNING!;
    // Only emit when murals were in scope and this Aha was expected to connect
    const hasMuralLink = a.artifact.links.some((l) => l.targetSystem === "mural" && l.claimsIdentity);
    if (hasMuralLink) continue;
    discrepancies.push({
      id: nextId("D"),
      kind: "RESEARCH_ABSENT_FROM_PLANNING",
      severity: spec.severity,
      systems: ["mural", "aha"],
      records: [a.artifact.key, ...muralAnchors.map((m) => `mural:${m.id}`)],
      values: [{ artifact: a.artifact.key, field: "title", value: a.artifact.title?.value ?? null, provenance: a.artifact.title?.provenance }],
      businessImpact: spec.impact,
      evidenceRefs: [],
      ruleRefs: spec.ruleRefs,
      authority: "UNKNOWN",
      recommendedResolution: "Link the mural on the Aha record, or confirm this Aha item is out of research scope.",
    });
    rule(...spec.ruleRefs);
  }

  // Materialize relationships + alignment
  for (const p of pairs) {
    const relId = nextId("R");
    relationships.push({
      id: relId,
      source: p.mural.key,
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
    const aligned = assessMuralAhaAlignment(p.mural, p.aha);
    const alignId = nextId("A");
    alignments.push({
      id: alignId,
      relationshipRef: relId,
      status: aligned.status,
      comparisons: aligned.comparisons,
      evidenceRefs: aligned.comparisons.flatMap((c) => c.evidenceRefs),
      ruleRefs: aligned.ruleRefs,
      explanation: aligned.explanation,
    });
    rule(...aligned.ruleRefs);

    for (const cmp of aligned.comparisons.filter((c) => c.result === "DIFFERENT")) {
      const kind = cmp.field === "description" ? "DESCRIPTION_CONFLICT" : "TITLE_CONFLICT";
      const severity = cmp.field === "description" ? "MEDIUM" : "MEDIUM";
      discrepancies.push({
        id: nextId("D"),
        kind,
        severity,
        systems: ["mural", "aha"],
        records: [p.mural.key, p.aha.key],
        values: [
          { artifact: p.mural.key, field: cmp.field, value: cmp.sourceValue },
          { artifact: p.aha.key, field: cmp.field, value: cmp.targetValue },
        ],
        businessImpact:
          cmp.field === "description"
            ? "Board overview and planning description no longer agree lexically; research may be out of sync with planning."
            : "Board title and planning title differ; teams may refer to different work.",
        evidenceRefs: [...p.evidenceRefs],
        ruleRefs: [...aligned.ruleRefs],
        relationshipRef: relId,
        authority: "UNKNOWN",
        recommendedResolution: "Review both values; Ramirez does not choose an authority unless you configure one.",
      });
    }
  }

  if (!config.conventions.ahaDescriptionMuralUrl.verified && config.conventions.ahaDescriptionMuralUrl.enabled) {
    limitations.push("Unverified identity conventions cap mural URL links at PROBABLE until you pass verifyConventions.");
  }
  if (!config.conventions.muralTitleAhaRef.verified && config.conventions.muralTitleAhaRef.enabled) {
    limitations.push("Unverified mural title Aha-ref convention caps those links at PROBABLE until verified.");
  }
  limitations.push("Sticky/area text never establishes identity.");
  limitations.push("No DPJ, Figma, Azure DevOps, or GitHub retrieval was performed in this mural↔Aha run.");

  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: {
      aha: ahaRefs,
      dpj: [],
      mural: muralIds,
      figma: [],
      options: {
        expectDpjCounterpart: false,
        expectPlanningCounterpart: input.expectPlanningCounterpart,
        expectDesignCounterpart: false,
        dpjProjectId: null,
        transition: "mural_aha",
      },
    },
    systemsQueried: [...session.queried],
    systemsNotQueried: [
      { system: "dpj", reason: "outside the Mural ↔ Aha scope of this run" },
      { system: "figma", reason: "IDE plugin only; no agent connection" },
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

/** Title + description only for mural↔Aha. */
export function assessMuralAhaAlignment(mural: Artifact, aha: Artifact): {
  status: AlignmentStatus;
  comparisons: FieldComparison[];
  ruleRefs: string[];
  explanation: string;
} {
  const comparisons: FieldComparison[] = [];
  const ruleRefs = new Set<string>(["R-AL-001", "R-AL-002"]);
  const mTitle = stripIdentityPrefix(mural.title?.value ?? "");
  const aTitle = stripIdentityPrefix(aha.title?.value ?? "");
  comparisons.push({
    field: "title",
    sourceValue: mTitle || null,
    targetValue: aTitle || null,
    result: !mTitle || !aTitle ? "NOT_COMPARABLE" : normalizeTitle(mTitle) === normalizeTitle(aTitle) ? "EQUAL" : "DIFFERENT",
    method: "NORMALIZED",
    evidenceRefs: [],
    ruleRef: "R-AL-002",
    ...(!mTitle || !aTitle ? { note: "one side is empty" } : {}),
  });

  ruleRefs.add("R-AL-003");
  const mDesc = comparableDescription(mural.description?.value ?? "");
  const aDesc = comparableDescription(aha.description?.value ?? "");
  if (!mDesc || !aDesc) {
    comparisons.push({
      field: "description",
      sourceValue: mDesc || null,
      targetValue: aDesc || null,
      result: "NOT_COMPARABLE",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: "one side has no description",
    });
  } else {
    const sim = jaccard(tokens(mDesc), tokens(aDesc));
    comparisons.push({
      field: "description",
      sourceValue: excerpt(mDesc, 200) ?? null,
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
    explanation: `${different.length} field(s) differ: ${different.map((c) => c.field).join(", ") || "none"}. Mural↔Aha compares title and description only.`,
  };
}
