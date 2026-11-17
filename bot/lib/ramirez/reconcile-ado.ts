// ADO ↔ Aha reconciliation. ADO evidence is operator/IDE-supplied only —
// Ramirez never opens an Azure DevOps connector.
import { normalizeAdoWorkItem } from "./adapters/ado";
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

export type AdoEvidenceInput = {
  workItemId: string;
  org?: string;
  project?: string;
  title?: string;
  state?: string;
  url?: string;
  description?: string;
  note?: string;
  assignedTo?: string;
  iteration?: string;
  retrievedAt?: string;
};

export type ReconcileAdoInput = {
  ahaRefs: string[];
  ado: AdoEvidenceInput[];
  expectEngineeringCounterpart: boolean;
};

export type ReconcileAdoDeps = {
  aha: PlanningAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

type Pair = {
  ado: Artifact;
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

export function adoWorkItemId(artifact: Artifact): string | undefined {
  return artifact.externalIds.find((e) => e.scheme === "ado_work_item_id")?.value ?? artifact.sourceId;
}

/** True when an Aha ADO link names this work item. */
export function linkMatchesAdo(link: CrossSystemLink, ado: Artifact): boolean {
  if (link.targetSystem !== "azure_devops" || !link.targetId) return false;
  const id = adoWorkItemId(ado);
  if (!id) return false;
  return link.targetId === id || link.targetId === ado.sourceId;
}

export async function reconcileAdo(input: ReconcileAdoInput, deps: ReconcileAdoDeps): Promise<ReconciliationResult> {
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

  limitations.push("ADO was not queried by Ramirez; evidence was supplied by the operator/IDE.");
  limitations.push("No Mural, DPJ, Figma, or GitHub retrieval was performed in this ADO↔Aha run.");

  const adoArtifacts: Artifact[] = [];
  for (const item of input.ado) {
    const artifact = normalizeAdoWorkItem(
      {
        workItemId: item.workItemId,
        ...(item.org ? { org: item.org } : {}),
        ...(item.project ? { project: item.project } : {}),
        ...(item.title ? { title: item.title } : {}),
        ...(item.state ? { state: item.state } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.description ? { description: item.description } : {}),
        ...(item.note ? { note: item.note } : {}),
        ...(item.assignedTo ? { assignedTo: item.assignedTo } : {}),
        ...(item.iteration ? { iteration: item.iteration } : {}),
      },
      item.retrievedAt ?? now(),
      "operator_ide_evidence",
      config,
    );
    artifacts.set(artifact.key, artifact);
    adoArtifacts.push(artifact);
    session.queried.add("azure_devops");
    session.log.push({
      system: "azure_devops",
      operation: "normalize_evidence",
      target: artifact.sourceId,
      state: "AVAILABLE",
      question: "Accept operator/IDE-supplied ADO evidence",
      cached: false,
      resultCount: 1,
      at: now(),
      note: "No Azure DevOps connector call; INTERFACE_ONLY",
    });
  }

  const ahaRefs = [...new Set(input.ahaRefs)];
  const ahaAnchors: Array<{ ref: string; artifact?: Artifact; state: import("./types").RetrievalState }> = [];
  for (const ref of ahaRefs) {
    const res = await session.run("aha", "read_records", ref, "Resolve the selected Aha record", () => aha.getById(ref));
    if (res.value) artifacts.set(res.value.key, res.value);
    ahaAnchors.push({ ref, ...(res.value ? { artifact: res.value } : {}), state: res.state });
  }

  for (const item of adoArtifacts) {
    for (const link of item.links) {
      if (link.targetSystem === "aha" && link.targetId && link.claimsIdentity && !ahaAnchors.some((a) => a.ref === link.targetId)) {
        rule("R-LF-015");
        const r = await session.run("aha", "read_records", link.targetId, "Resolve Aha ref from ADO title", () => aha.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        ahaAnchors.push({ ref: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
      }
    }
  }

  const pairs: Pair[] = [];
  const pairedAha = new Set<string>();
  const pairedAdo = new Set<string>();

  for (const item of adoArtifacts) {
    const candidates = new Map<string, { artifact: Artifact; linksFromAdo: CrossSystemLink[]; linksFromAha: CrossSystemLink[] }>();

    for (const link of item.links.filter((l) => l.targetSystem === "aha" && l.targetId && l.claimsIdentity)) {
      const hit = ahaAnchors.find((a) => a.ref === link.targetId && a.artifact);
      if (!hit?.artifact) continue;
      const c = candidates.get(hit.artifact.sourceId) ?? { artifact: hit.artifact, linksFromAdo: [], linksFromAha: [] };
      c.linksFromAdo.push(link);
      candidates.set(hit.artifact.sourceId, c);
    }
    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      for (const link of a.artifact.links.filter((l) => linkMatchesAdo(l, item) && l.claimsIdentity)) {
        const c = candidates.get(a.artifact.sourceId) ?? { artifact: a.artifact, linksFromAdo: [], linksFromAha: [] };
        c.linksFromAha.push(link);
        candidates.set(a.artifact.sourceId, c);
      }
    }

    for (const a of ahaAnchors) {
      if (!a.artifact) continue;
      const otherLinks = a.artifact.links.filter(
        (l) => l.targetSystem === "azure_devops" && l.claimsIdentity && l.targetId && !linkMatchesAdo(l, item),
      );
      const pairsHere = candidates.has(a.artifact.sourceId);
      if (pairsHere && otherLinks.length > 0) {
        const spec = LIFECYCLE_DISCREPANCY.STALE_ADO_LINK!;
        discrepancies.push({
          id: nextId("D"),
          kind: "STALE_ADO_LINK",
          severity: spec.severity,
          systems: ["aha", "azure_devops"],
          records: [a.artifact.key, item.key],
          values: [
            { artifact: a.artifact.key, field: "link", value: otherLinks[0]!.url ?? otherLinks[0]!.targetId ?? null, provenance: otherLinks[0]!.provenance },
            { artifact: item.key, field: "workItemId", value: adoWorkItemId(item) ?? null, provenance: item.externalIds[0]?.provenance },
          ],
          businessImpact: spec.impact,
          evidenceRefs: [],
          ruleRefs: spec.ruleRefs,
          authority: "UNKNOWN",
          recommendedResolution: "Update the ADO link on the Aha record to the work item under review, or supply matching evidence.",
        });
        rule(...spec.ruleRefs);
      }
    }

    const idSetId = nextId("C");
    candidateSets.push({
      id: idSetId,
      source: item.key,
      targetSystem: "aha",
      candidates: [...candidates.keys()].map((id) => `aha:${id}`),
      rejected: [],
      discoveryMethod: "Explicit ADO↔Aha identity links (integration, URL, and/or title ref)",
      queriedScope: `ado ${item.sourceId} + named Aha refs`,
      retrievalState: "AVAILABLE",
      truncated: false,
    });

    if (candidates.size === 0) {
      const title = item.title?.value;
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
            ado: item,
            aha: s.aha,
            status: s.score >= 50 ? "POSSIBLE" : "NOT_EVALUATED",
            score: Math.min(s.score, SCORE.capTitleOnly),
            method: "METADATA",
            evidenceRefs: s.refs,
            contradictoryRefs: [],
            ruleRefs: ["R-MD-003", "R-MD-006"],
            explanation: `Title-only metadata match capped at ${SCORE.capTitleOnly}. Not identity.`,
            raise: ["Add an ADO URL / vsts link on the Aha record or an Aha ref in the work-item title"],
            lower: [],
            missing: ["Deterministic identity link"],
          });
          pairedAha.add(s.aha.sourceId);
          pairedAdo.add(item.key);
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
            explanation: `Multiple title-similar Aha candidates for ADO ${item.sourceId}; ambiguous.`,
            wouldRaiseConfidence: ["Operator names one Aha reference"],
            wouldLowerConfidence: [],
            candidateSetRef: idSetId,
          });
          rule("R-MD-005");
        }
      }

      if (!pairedAdo.has(item.key)) {
        const orphanSpec = LIFECYCLE_DISCREPANCY.ORPHAN_ENGINEERING_EVIDENCE!;
        if (input.expectEngineeringCounterpart) {
          discrepancies.push({
            id: nextId("D"),
            kind: "ORPHAN_ENGINEERING_EVIDENCE",
            severity: orphanSpec.severity,
            systems: ["azure_devops", "aha"],
            records: [item.key],
            values: [{ artifact: item.key, field: "title", value: item.title?.value ?? null, provenance: item.title?.provenance }],
            businessImpact: orphanSpec.impact,
            evidenceRefs: [],
            ruleRefs: orphanSpec.ruleRefs,
            authority: "UNKNOWN",
            recommendedResolution: "Name the Aha record this work item belongs to, or set expectEngineeringCounterpart false.",
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
          ruleRefs: input.expectEngineeringCounterpart ? orphanSpec.ruleRefs : [],
          explanation: input.expectEngineeringCounterpart
            ? `No Aha counterpart found for ADO ${item.sourceId} (ORPHAN_ENGINEERING_EVIDENCE). Not MISSING under R-MISS-001.`
            : `No Aha counterpart linked for ADO ${item.sourceId}. Expectation was off; no omission asserted.`,
          wouldRaiseConfidence: ["Provide an Aha reference or put an ADO URL / vsts id on the Aha record"],
          wouldLowerConfidence: [],
          candidateSetRef: idSetId,
        });
      }
      continue;
    }

    for (const c of candidates.values()) {
      const refs: string[] = [];
      for (const l of c.linksFromAdo) {
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
            note: `ADO title convention (${l.kind}).`,
          }),
        );
        rule("R-LF-015");
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
            note: `Aha ADO link (${l.kind}).`,
          }),
        );
        rule("R-LF-014");
      }

      const verified =
        c.linksFromAdo.some((l) => conventionVerified(config, l.kind)) || c.linksFromAha.some((l) => conventionVerified(config, l.kind));
      const bothWays = c.linksFromAdo.length > 0 && c.linksFromAha.length > 0;
      let status: RelationshipStatus;
      let score: number;
      let rules: string[];
      let explanation: string;
      const raise: string[] = [];
      if (bothWays || verified) {
        status = "CONFIRMED";
        score = SCORE.explicitVerifiedUnique;
        rules = ["R-ID-001", ...(c.linksFromAdo.length ? ["R-LF-015"] : []), ...(c.linksFromAha.length ? ["R-LF-014"] : [])];
        explanation = bothWays
          ? `Identity established by links on both ADO and Aha. Baseline ${SCORE.explicitVerifiedUnique}.`
          : `Identity established by operator-verified convention. Baseline ${SCORE.explicitVerifiedUnique}.`;
        rule("R-ID-001");
      } else {
        status = "PROBABLE";
        score = SCORE.explicitUnverifiedConvention;
        rules = ["R-ID-003", ...(c.linksFromAdo.length ? ["R-LF-015"] : []), ...(c.linksFromAha.length ? ["R-LF-014"] : [])];
        explanation = `One-directional or unverified ADO↔Aha link. Baseline ${SCORE.explicitUnverifiedConvention}, PROBABLE.`;
        raise.push("Pass verifyConventions for the link kinds you trust");
        if (!bothWays) raise.push("Add the reverse link (ADO URL/vsts on Aha or Aha ref in the work-item title)");
        rule("R-ID-003");
      }

      pairs.push({
        ado: item,
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
      pairedAdo.add(item.key);
    }
  }

  if (input.expectEngineeringCounterpart && adoArtifacts.length > 0) {
    for (const a of ahaAnchors) {
      if (!a.artifact || pairedAha.has(a.artifact.sourceId)) continue;
      const hasAdoLink = a.artifact.links.some((l) => l.targetSystem === "azure_devops" && l.claimsIdentity);
      if (hasAdoLink) continue;
      const spec = LIFECYCLE_DISCREPANCY.PLANNING_ABSENT_FROM_ENGINEERING!;
      discrepancies.push({
        id: nextId("D"),
        kind: "PLANNING_ABSENT_FROM_ENGINEERING",
        severity: spec.severity,
        systems: ["aha", "azure_devops"],
        records: [a.artifact.key, ...adoArtifacts.map((x) => x.key)],
        values: [{ artifact: a.artifact.key, field: "title", value: a.artifact.title?.value ?? null, provenance: a.artifact.title?.provenance }],
        businessImpact: spec.impact,
        evidenceRefs: [],
        ruleRefs: spec.ruleRefs,
        authority: "UNKNOWN",
        recommendedResolution: "Supply matching ADO evidence or link the work item on the Aha record.",
      });
      rule(...spec.ruleRefs);
    }
  }

  for (const p of pairs) {
    const relId = nextId("R");
    relationships.push({
      id: relId,
      source: p.ado.key,
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
    const aligned = assessAdoAhaAlignment(p.ado, p.aha, config);
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
      const engSpec = LIFECYCLE_DISCREPANCY.ENGINEERING_PLANNING_MISMATCH!;
      const kind = cmp.field === "description" || cmp.field === "status" ? "ENGINEERING_PLANNING_MISMATCH" : "TITLE_CONFLICT";
      const severity = cmp.field === "title" ? "MEDIUM" : engSpec.severity;
      discrepancies.push({
        id: nextId("D"),
        kind,
        severity,
        systems: ["azure_devops", "aha"],
        records: [p.ado.key, p.aha.key],
        values: [
          { artifact: p.ado.key, field: cmp.field, value: cmp.sourceValue },
          { artifact: p.aha.key, field: cmp.field, value: cmp.targetValue },
        ],
        businessImpact: cmp.field === "title" ? "Engineering work-item title and planning title differ." : engSpec.impact,
        evidenceRefs: [...p.evidenceRefs],
        ruleRefs: cmp.field === "title" ? [...aligned.ruleRefs] : engSpec.ruleRefs,
        relationshipRef: relId,
        authority: "UNKNOWN",
        recommendedResolution: "Review both values; Ramirez does not choose an authority unless you configure one.",
      });
      if (kind === "ENGINEERING_PLANNING_MISMATCH") rule(...engSpec.ruleRefs);
    }
  }

  if (config.conventions.ahaDescriptionAdoUrl.enabled && !config.conventions.ahaDescriptionAdoUrl.verified) {
    limitations.push("Unverified ADO URL conventions cap those links at PROBABLE until you pass verifyConventions.");
  }
  if (config.conventions.ahaIntegrationField.enabled && !config.conventions.ahaIntegrationField.verified) {
    limitations.push("Unverified Aha vsts integration links cap those pairs at PROBABLE until verified.");
  }
  if (config.conventions.adoTitleAhaRef.enabled && !config.conventions.adoTitleAhaRef.verified) {
    limitations.push("Unverified ADO title Aha-ref convention caps those links at PROBABLE until verified.");
  }

  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: {
      aha: ahaRefs,
      dpj: [],
      mural: [],
      figma: [],
      ado: adoArtifacts.map((a) => a.sourceId),
      github: [],
      options: {
        expectDpjCounterpart: false,
        expectPlanningCounterpart: false,
        expectDesignCounterpart: false,
        expectEngineeringCounterpart: input.expectEngineeringCounterpart,
        expectImplementationCounterpart: false,
        dpjProjectId: null,
        transition: "ado_aha",
      },
    },
    systemsQueried: [...session.queried],
    systemsNotQueried: [
      { system: "mural", reason: "outside the ADO ↔ Aha scope of this run" },
      { system: "dpj", reason: "outside the ADO ↔ Aha scope of this run" },
      { system: "figma", reason: "IDE plugin only; no agent connection" },
      { system: "github", reason: "outside the ADO ↔ Aha scope of this run" },
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

export function assessAdoAhaAlignment(
  ado: Artifact,
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
  const aTitle = stripIdentityPrefix(ado.title?.value ?? "");
  const bTitle = stripIdentityPrefix(aha.title?.value ?? "");
  comparisons.push({
    field: "title",
    sourceValue: aTitle || null,
    targetValue: bTitle || null,
    result: !aTitle || !bTitle ? "NOT_COMPARABLE" : normalizeTitle(aTitle) === normalizeTitle(bTitle) ? "EQUAL" : "DIFFERENT",
    method: "NORMALIZED",
    evidenceRefs: [],
    ruleRef: "R-AL-002",
    ...(!aTitle || !bTitle ? { note: "one side is empty" } : {}),
  });

  ruleRefs.add("R-AL-003");
  const aDesc = comparableDescription(ado.description?.value ?? "");
  const bDesc = comparableDescription(aha.description?.value ?? "");
  if (!aDesc || !bDesc) {
    comparisons.push({
      field: "description",
      sourceValue: aDesc || null,
      targetValue: bDesc || null,
      result: "NOT_COMPARABLE",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: "one side has no description",
    });
  } else {
    const sim = jaccard(tokens(aDesc), tokens(bDesc));
    comparisons.push({
      field: "description",
      sourceValue: excerpt(aDesc, 200) ?? null,
      targetValue: excerpt(bDesc, 200) ?? null,
      result: sim >= 0.5 ? "EQUAL" : "DIFFERENT",
      method: "SEMANTIC",
      evidenceRefs: [],
      ruleRef: "R-AL-003",
      note: `lexical overlap ${sim.toFixed(2)} (threshold 0.50)`,
    });
  }

  ruleRefs.add("R-AL-004");
  const adoState = ado.status?.value.name;
  const ahaStatus = aha.status?.value.name;
  if (!config.statusMapping || !adoState || !ahaStatus) {
    comparisons.push({
      field: "status",
      sourceValue: adoState ?? null,
      targetValue: ahaStatus ?? null,
      result: "NOT_COMPARABLE",
      method: "DIRECT",
      evidenceRefs: [],
      ruleRef: "R-AL-004",
      note: config.statusMapping ? "one side missing status" : "no statusMapping configured",
    });
  } else {
    const mapAdo = config.statusMapping.dpj[adoState] ?? config.statusMapping.aha[adoState];
    const mapAha = config.statusMapping.aha[ahaStatus];
    comparisons.push({
      field: "status",
      sourceValue: adoState,
      targetValue: ahaStatus,
      result: mapAdo && mapAha ? (mapAdo === mapAha ? "EQUAL" : "DIFFERENT") : "NOT_COMPARABLE",
      method: "NORMALIZED",
      evidenceRefs: [],
      ruleRef: "R-AL-004",
      ...(!mapAdo || !mapAha ? { note: "status not in configured mapping" } : {}),
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
    explanation: `${different.length} field(s) differ: ${different.map((c) => c.field).join(", ") || "none"}. ADO↔Aha compares title, description, and mapped status.`,
  };
}
