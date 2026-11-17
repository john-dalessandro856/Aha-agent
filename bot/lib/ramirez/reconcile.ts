// Aha ↔ DPJ reconciliation. Pure logic over normalized artifacts. It never
// calls a connector directly: every retrieval goes through RetrievalSession.
import type { RamirezConfig } from "./config";
import { excerpt } from "./redact";
import type { PlanningAdapter, CandidateHit, RetrievalSession } from "./retrieval";
import { describeRules, SCORE } from "./rules";
import { calendarDate, comparableDescription, jaccard, normalizeName, normalizeTitle, stableHash, stripIdentityPrefix, tokens } from "./text";
import {
  MUTATION_MODE,
  NO_CHANGES_STATEMENT,
  type AlignmentAssessment,
  type AlignmentStatus,
  type Artifact,
  type CandidateSet,
  type ConflictingValue,
  type CrossSystemLink,
  type Discrepancy,
  type DiscrepancyKind,
  type Evidence,
  type EvidenceType,
  type FieldComparison,
  type MatchingMethod,
  type ProposedChange,
  type Provenance,
  type ReconciliationResult,
  type RelationshipAssessment,
  type RelationshipStatus,
  type RetrievalState,
  type ScoreBasis,
  type Severity,
  type SystemId,
} from "./types";

export type ReconcileInput = {
  ahaRefs: string[];
  dpjIds: string[];
  expectDpjCounterpart: boolean;
  dpjProjectId?: string;
};

export type ReconcileDeps = {
  aha: PlanningAdapter;
  dpj: PlanningAdapter;
  session: RetrievalSession;
  config: RamirezConfig;
  now: () => string;
};

type DpjCandidate = {
  id: string;
  artifact?: Artifact;
  state: RetrievalState;
  explicitLinks: CrossSystemLink[];
  fromIdentifierSearch: boolean;
  fromTitleSearch: boolean;
};

type Pair = {
  key: string;
  aha: Artifact;
  dpj: Artifact;
  deterministic: boolean;
  method: MatchingMethod;
  status: RelationshipStatus;
  score: number | null;
  scoreBasis: ScoreBasis;
  evidenceRefs: string[];
  contradictoryRefs: string[];
  ruleRefs: string[];
  candidateSetRef?: string;
  explanation: string;
  raise: string[];
  lower: string[];
  missing: string[];
};

const DISCREPANCY_FOR_FIELD: Record<string, { kind: DiscrepancyKind; severity: Severity; impact: string }> = {
  title: { kind: "TITLE_CONFLICT", severity: "MEDIUM", impact: "Planning labels differ; teams can work from different scope names." },
  description: { kind: "DESCRIPTION_CONFLICT", severity: "MEDIUM", impact: "Descriptions no longer agree lexically; possible rework." },
  owner: { kind: "OWNERSHIP_CONFLICT", severity: "HIGH", impact: "Accountable owner differs between systems; work may be funded or governed by the wrong party." },
  startDate: { kind: "DATE_CONFLICT", severity: "HIGH", impact: "Planned start differs; release and capacity plans may diverge." },
  dueDate: { kind: "DATE_CONFLICT", severity: "HIGH", impact: "Planned due date differs; release and capacity plans may diverge." },
  hierarchy: { kind: "HIERARCHY_CONFLICT", severity: "HIGH", impact: "Parent differs; roll-ups and governance can report the work under the wrong parent." },
  status: { kind: "STATUS_CONFLICT", severity: "HIGH", impact: "Status differs under the configured mapping; reporting can disagree." },
};

const SCOPE_DRIFT_SEVERITY: Severity = "MEDIUM";

export async function reconcile(input: ReconcileInput, deps: ReconcileDeps): Promise<ReconciliationResult> {
  const { aha, dpj, session, config, now } = deps;
  const evidence: Evidence[] = [];
  const candidateSets: CandidateSet[] = [];
  const relationships: RelationshipAssessment[] = [];
  const alignments: AlignmentAssessment[] = [];
  const discrepancies: Discrepancy[] = [];
  const proposals: ProposedChange[] = [];
  const downstreamLinks: ReconciliationResult["downstreamLinks"] = [];
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
  const rule = (...ids: string[]) => ids.forEach((r) => ruleRefs.add(r));

  // ---- 1. Resolve the selected Aha records --------------------------------
  const ahaRefs = [...new Set(input.ahaRefs)];
  const dpjSeedIds = [...new Set(input.dpjIds)];
  const ahaAnchors: Array<{ ref: string; artifact?: Artifact; state: RetrievalState }> = [];
  for (const ref of ahaRefs) {
    const res = await session.run("aha", "read_records", ref, "Resolve the selected Aha record", () => aha.getById(ref));
    if (res.value) artifacts.set(res.value.key, res.value);
    ahaAnchors.push({ ref, ...(res.value ? { artifact: res.value } : {}), state: res.state });
  }

  // DPJ anchors: resolve each selected work package. Its Aha links add Aha anchors.
  const dpjAnchors: Array<{ id: string; artifact?: Artifact; state: RetrievalState }> = [];
  for (const id of dpjSeedIds) {
    const res = await session.run("dpj", "search_work_packages", `id=${id}`, "Resolve the selected DPJ work package", () => dpj.getById(id));
    if (res.value) artifacts.set(res.value.key, res.value);
    dpjAnchors.push({ id, ...(res.value ? { artifact: res.value } : {}), state: res.state });
    for (const link of res.value?.links ?? []) {
      if (link.targetSystem === "aha" && link.targetId && link.claimsIdentity && !ahaAnchors.some((a) => a.ref === link.targetId)) {
        const r = await session.run("aha", "read_records", link.targetId, "Resolve the Aha record a selected DPJ package claims", () => aha.getById(link.targetId!));
        if (r.value) artifacts.set(r.value.key, r.value);
        ahaAnchors.push({ ref: link.targetId, ...(r.value ? { artifact: r.value } : {}), state: r.state });
      }
    }
  }

  for (const anchor of dpjAnchors) {
    if (!anchor.artifact) continue;
    const hasAhaClaim = anchor.artifact.links.some((l) => l.targetSystem === "aha" && l.claimsIdentity);
    if (!hasAhaClaim) {
      limitations.push(`DPJ ${anchor.id} carries no Aha identity claim. Reverse discovery by title was not run, so no Aha counterpart is asserted.`);
    }
  }

  // ---- 2. Reconcile each Aha anchor ------------------------------------------
  const pairs: Pair[] = [];
  for (const anchor of ahaAnchors) {
    if (!anchor.artifact) {
      relationships.push({
        id: nextId("R"),
        source: `aha:${anchor.ref}`,
        targetSystem: "dpj",
        status: "NOT_EVALUATED",
        method: "NONE",
        score: null,
        scoreBasis: { baseline: null, capsApplied: [], components: [] },
        evidenceRefs: [],
        contradictoryEvidenceRefs: [],
        missingEvidence: ["Aha record not retrieved"],
        targetRetrievalState: anchor.state,
        ruleRefs: [],
        explanation: `Aha ${anchor.ref} was not retrieved (${anchor.state}). No relationship is asserted.`,
        wouldRaiseConfidence: [],
        wouldLowerConfidence: [],
      });
      continue;
    }
    const aha = anchor.artifact;
    const explicitTargets = aha.links.filter((l) => l.targetSystem === "dpj" && l.targetId && l.claimsIdentity);
    const candidates = new Map<string, DpjCandidate>();
    const entry = (id: string): DpjCandidate => {
      let c = candidates.get(id);
      if (!c) {
        c = { id, state: "NOT_RETRIEVED", explicitLinks: [], fromIdentifierSearch: false, fromTitleSearch: false };
        candidates.set(id, c);
      }
      return c;
    };

    // 2a. Level 1, deterministic: explicit links recorded on the Aha record.
    for (const link of explicitTargets) {
      const c = entry(link.targetId!);
      c.explicitLinks.push(link);
      const res = await session.run("dpj", "search_work_packages", `id=${link.targetId}`, `Resolve the DPJ record linked from ${aha.key}`, () => dpj.getById(link.targetId!));
      c.state = res.state;
      if (res.value) {
        c.artifact = res.value;
        artifacts.set(res.value.key, res.value);
      } else if (res.state === "NOT_FOUND_WITHIN_QUERIED_SCOPE") {
        discrepancies.push({
          id: nextId("D"),
          kind: "POTENTIAL_BROKEN_LINK",
          severity: "MEDIUM",
          systems: ["aha", "dpj"],
          records: [aha.key, `dpj:${link.targetId}`],
          values: [{ artifact: aha.key, field: "link", value: link.url ?? link.targetId ?? null, provenance: link.provenance }],
          businessImpact: "The Aha record points at a DPJ work package the exact-ID lookup could not find.",
          evidenceRefs: [addEvidence({ type: "EXPLICIT_IDENTIFIER_LINK", role: "SUPPORTING", subject: aha.key, object: `dpj:${link.targetId}`, fields: ["links"], provenance: [link.provenance], value: link.targetId, retrievalState: res.state, note: "Explicit link; exact-ID lookup did not resolve it." })],
          ruleRefs: ["R-ID-006"],
          authority: "UNKNOWN",
          recommendedResolution: "Confirm whether the DPJ work package was deleted or moved, then correct the link in Aha or DPJ.",
        });
        rule("R-ID-006");
      } else {
        limitations.push(`Explicit link ${aha.key} → DPJ ${link.targetId} not evaluated (${res.state}).`);
      }
    }

    // 2b. Level 1, deterministic discovery: DPJ subject filter on the Aha reference.
    const idChannels = identityChannelsRequired(config);
    const identifierSearch = await session.run("dpj", "search_work_packages", `subject~${anchor.ref}`, `Find DPJ records whose subject carries ${anchor.ref}`, () => dpj.searchByIdentifier(anchor.ref));
    const idSetId = nextId("C");
    candidateSets.push({
      id: idSetId,
      source: aha.key,
      targetSystem: "dpj",
      candidates: (identifierSearch.value ?? []).map((h) => `dpj:${h.id}`),
      rejected: [],
      discoveryMethod: "DPJ subject filter on Aha reference (identifier channel)",
      queriedScope: identifierSearch.scope,
      retrievalState: identifierSearch.state,
      truncated: Boolean(identifierSearch.truncated),
      ...(identifierSearch.truncated ? { ambiguityReason: "result truncated; absence cannot be concluded" } : {}),
    });
    for (const hit of identifierSearch.value ?? []) {
      const c = entry(hit.id);
      c.fromIdentifierSearch = true;
      c.artifact ??= await resolveHit(hit, dpj, session, artifacts);
      if (c.artifact) c.state = "AVAILABLE";
    }

    // 2c. Deterministic identity per candidate, from both directions.
    const deterministicPairs = new Map<string, { status: RelationshipStatus; score: number | null; method: MatchingMethod; raise: string[]; lower: string[]; refs: string[]; contradictory: string[]; rules: string[]; explanation: string }>();
    for (const c of candidates.values()) {
      if (!c.artifact) continue;
      const claims = c.artifact.links.filter((l) => l.targetSystem === "aha" && l.targetId && l.claimsIdentity);
      const claimsHere = claims.filter((l) => l.targetId === aha.sourceId);
      const claimsElsewhere = claims.filter((l) => l.targetId !== aha.sourceId);
      const refs: string[] = [];
      for (const l of c.explicitLinks) {
        refs.push(addEvidence({ type: "EXPLICIT_IDENTIFIER_LINK", role: "SUPPORTING", subject: aha.key, object: c.artifact.key, fields: ["links"], provenance: [l.provenance], value: l.url ?? l.targetId, retrievalState: "AVAILABLE", note: "Link recorded on the Aha record." }));
      }
      for (const l of claimsHere) {
        refs.push(addEvidence({ type: l.kind === "dpj_custom_field_ref" ? "EXPLICIT_IDENTIFIER_LINK" : "EXPLICIT_IDENTIFIER_LINK", role: "SUPPORTING", subject: c.artifact.key, object: aha.key, fields: [l.kind], provenance: [l.provenance], value: l.targetId, retrievalState: "AVAILABLE", note: `Back-reference from DPJ (${l.kind}).` }));
      }
      if (claimsElsewhere.length > 0) {
        const refsElsewhere = claimsElsewhere.map((l) => addEvidence({ type: "EXPLICIT_IDENTIFIER_LINK", role: "CONTRADICTORY", subject: c.artifact!.key, object: `aha:${l.targetId}`, fields: [l.kind], provenance: [l.provenance], value: l.targetId, retrievalState: "AVAILABLE", note: "DPJ record names a different Aha reference." }));
        deterministicPairs.set(c.id, { status: "CONTRADICTORY", score: 0, method: "DETERMINISTIC", raise: [], lower: ["DPJ names a different Aha reference"], refs, contradictory: refsElsewhere, rules: ["R-ID-004"], explanation: `DPJ ${c.id} names ${claimsElsewhere.map((l) => l.targetId).join(", ")} as its Aha reference. Deterministic contradiction; no identity asserted.` });
        continue;
      }
      if (c.explicitLinks.length === 0 && claimsHere.length === 0) continue;
      const verifiedBackref = claimsHere.some((l) => backrefVerified(l, config));
      const bothWays = c.explicitLinks.length > 0 && claimsHere.length > 0;
      if (bothWays || (claimsHere.length > 0 && verifiedBackref)) {
        const via = bothWays ? "explicit link on both records" : "verified convention on the DPJ record";
        deterministicPairs.set(c.id, {
          status: "CONFIRMED",
          score: SCORE.explicitVerifiedUnique,
          method: "DETERMINISTIC",
          raise: [],
          lower: [],
          refs,
          contradictory: [],
          rules: ["R-ID-001"],
          explanation: `Identity established by ${via}. Baseline ${SCORE.explicitVerifiedUnique}.`,
        });
        rule("R-ID-001");
      } else {
        const why = c.explicitLinks.length > 0 ? "explicit link on the Aha record only" : "DPJ subject convention not verified";
        deterministicPairs.set(c.id, {
          status: "PROBABLE",
          score: SCORE.explicitUnverifiedConvention,
          method: "DETERMINISTIC",
          raise: ["DPJ record links back to the Aha reference", "Migration owner confirms the convention"],
          lower: [],
          refs,
          contradictory: [],
          rules: ["R-ID-003"],
          explanation: `One-directional identity (${why}). Baseline ${SCORE.explicitUnverifiedConvention}, PROBABLE.`,
        });
        rule("R-ID-003");
      }
    }

    // Mapping contradictions: Aha links to Y, while DPJ X claims this Aha reference.
    const explicitIdsHere = new Set(explicitTargets.map((l) => l.targetId!));
    for (const [id, pair] of deterministicPairs) {
      if (pair.status === "CONTRADICTORY") continue;
      const claimsHere = candidates.get(id)?.artifact?.links.some((l) => l.targetSystem === "aha" && l.targetId === aha.sourceId && l.claimsIdentity);
      const otherExplicit = [...explicitIdsHere].filter((x) => x !== id);
      if (claimsHere && otherExplicit.length > 0) {
        pair.status = "CONTRADICTORY";
        pair.score = null;
        pair.lower.push(`Aha links to DPJ ${otherExplicit.join(", ")} instead`);
        const otherLinks = explicitTargets.filter((l) => l.targetId !== id);
        pair.contradictory.push(addEvidence({ type: "EXPLICIT_IDENTIFIER_LINK", role: "CONTRADICTORY", subject: aha.key, object: otherExplicit.map((x) => `dpj:${x}`).join(", "), fields: ["links"], provenance: otherLinks.map((l) => l.provenance), value: otherExplicit.join(","), retrievalState: "AVAILABLE", note: "The Aha record links to a different DPJ work package." }));
        pair.explanation = `Conflicting deterministic identifiers: DPJ ${id} claims ${aha.sourceId}, but ${aha.sourceId} links to DPJ ${otherExplicit.join(", ")}. Not averaged; not confirmed.`;
        pair.rules.push("R-ID-004");
        rule("R-ID-004");
      }
    }

    const deterministicLive = [...deterministicPairs.values()].filter((p) => p.status !== "CONTRADICTORY");
    if (deterministicLive.length >= 2) {
      for (const p of deterministicLive) {
        p.status = "AMBIGUOUS";
        p.raise.push("Remove the duplicate mapping so one DPJ record carries the identity");
        p.rules.push("R-ID-005");
      }
      rule("R-ID-005");
      discrepancies.push({
        id: nextId("D"),
        kind: "DUPLICATE_MAPPING",
        severity: "HIGH",
        systems: ["aha", "dpj"],
        records: [aha.key, ...[...deterministicPairs.keys()].map((id) => `dpj:${id}`)],
        values: [...deterministicPairs.keys()].map((id) => ({ artifact: `dpj:${id}`, field: "identity link", value: aha.sourceId })),
        businessImpact: "More than one DPJ work package claims the same Aha record. Planning totals and ownership can double count.",
        evidenceRefs: [],
        ruleRefs: ["R-ID-005"],
        authority: "UNKNOWN",
        recommendedResolution: "Decide which DPJ work package is the migration target and close or relate the other as a duplicate.",
      });
    }

    // Build deterministic pairs.
    for (const [id, p] of deterministicPairs) {
      const c = candidates.get(id)!;
      pairs.push({
        key: `${aha.key}|dpj:${id}`,
        aha,
        dpj: c.artifact!,
        deterministic: true,
        method: p.method,
        status: p.status,
        score: p.status === "CONTRADICTORY" ? null : p.score,
        scoreBasis: { baseline: p.status === "CONTRADICTORY" ? null : p.score, capsApplied: [], components: [p.explanation] },
        evidenceRefs: p.refs,
        contradictoryRefs: p.contradictory,
        ruleRefs: p.rules,
        candidateSetRef: idSetId,
        explanation: p.explanation,
        raise: p.raise,
        lower: p.lower,
        missing: [],
      });
    }

    // 2d. Level 2, metadata. Runs only when deterministic identity is not established.
    const hasLiveDeterministic = deterministicLive.some((p) => p.status === "CONFIRMED" || p.status === "PROBABLE");
    const titleText = aha.title?.value;
    let titleHits: CandidateHit[] = [];
    let titleState: RetrievalState = "NOT_RETRIEVED";
    if (!hasLiveDeterministic && titleText) {
      const titleRes = await session.run("dpj", "search_work_packages", `subject~title:${normalizeTitle(titleText)}`, `Find DPJ records by the title of ${aha.key} (metadata fallback)`, () => dpj.searchByTitle(titleText, input.dpjProjectId ? { projectId: input.dpjProjectId } : undefined));
      titleState = titleRes.state;
      titleHits = titleRes.value ?? [];
      const titleSetId = nextId("C");
      candidateSets.push({
        id: titleSetId,
        source: aha.key,
        targetSystem: "dpj",
        candidates: titleHits.map((h) => `dpj:${h.id}`),
        rejected: [],
        discoveryMethod: "DPJ subject filter on Aha title (metadata fallback)",
        queriedScope: titleRes.scope,
        retrievalState: titleRes.state,
        truncated: Boolean(titleRes.truncated),
        ...(titleRes.truncated ? { ambiguityReason: "result truncated" } : {}),
      });
      for (const hit of titleHits) {
        const c = entry(hit.id);
        c.fromTitleSearch = true;
        c.artifact ??= await resolveHit(hit, dpj, session, artifacts);
        if (c.artifact) c.state = "AVAILABLE";
      }
    }

    const metadataCandidates = [...candidates.values()].filter((c) => c.artifact && !deterministicPairs.has(c.id) && !c.artifact.links.some((l) => l.targetSystem === "aha" && l.targetId === aha.sourceId && l.claimsIdentity));
    if (!hasLiveDeterministic) {
      const scored = metadataCandidates.map((c) => ({ c, m: metadataScore(aha, c.artifact!, config) }));
      const ranked = scored.sort((a, b) => b.m.score - a.m.score);
      const top = ranked[0];
      const contenders = top ? ranked.filter((x) => x.m.score >= 50 && x.m.score >= top.m.score - 10) : [];
      const ambiguous = contenders.length >= 2;
      if (ambiguous) rule("R-MD-005");
      for (const { c, m } of ranked) {
        let status: RelationshipStatus;
        let score = m.score;
        const caps = [...m.caps];
        if (ambiguous && m.score >= 50 && m.score >= top!.m.score - 10) {
          status = "AMBIGUOUS";
          score = Math.min(score, SCORE.metadataAmbiguous);
          caps.push("R-MD-005 ambiguity cap 60");
        } else if (m.score >= 75 && m.contradictions.length === 0) {
          status = "PROBABLE";
        } else if (m.score >= 25) {
          status = "POSSIBLE";
        } else {
          candidateSets.find((s) => s.id === idSetId)?.rejected.push({ key: c.artifact!.key, reason: "metadata score below 25" });
          continue;
        }
        const refs = [
          addEvidence({ type: "METADATA_INFERENCE", role: "SUPPORTING", subject: aha.key, object: c.artifact!.key, fields: m.fields, provenance: fieldProvenance(aha, c.artifact!, m.fields), value: m.summary, retrievalState: "AVAILABLE", note: "Metadata comparison, not identity." }),
        ];
        const contradictory = m.contradictions.map((field) =>
          addEvidence({ type: "METADATA_INFERENCE", role: "CONTRADICTORY", subject: aha.key, object: c.artifact!.key, fields: [field], provenance: fieldProvenance(aha, c.artifact!, [field]), retrievalState: "AVAILABLE", note: "Record type is not the configured equivalent." }),
        );
        // An ambiguity cap is only traceable if the pair itself cites R-MD-005.
        const rules = status === "AMBIGUOUS" ? [...m.rules, "R-MD-005"] : [...m.rules];
        rule(...rules);
        const missingEvidence: string[] = [];
        if (!m.corroborations.includes("owner")) missingEvidence.push("owner corroboration");
        if (!m.corroborations.includes("start") && !m.corroborations.includes("due")) missingEvidence.push("date corroboration");
        pairs.push({
          key: `${aha.key}|dpj:${c.id}`,
          aha,
          dpj: c.artifact!,
          deterministic: false,
          method: "METADATA",
          status,
          score,
          scoreBasis: { baseline: m.score, capsApplied: caps, components: [m.summary] },
          evidenceRefs: refs,
          contradictoryRefs: contradictory,
          ruleRefs: rules,
          candidateSetRef: idSetId,
          explanation: `Metadata match (${m.summary}). Metadata never confirms identity; status ${status}.`,
          raise: ["A deterministic link (subject reference or Aha URL) on the DPJ record", ...(m.corroborations.length < 2 ? ["Owner and date corroboration"] : [])],
          lower: m.contradictions.map((f) => `${f} differs`),
          missing: missingEvidence,
        });
      }

      // 2e. Level 3, semantic fallback. Only when no candidate reached 25 on metadata.
      const anyMetadataCandidate = pairs.some((p) => p.aha.key === aha.key && p.method === "METADATA" && p.status !== "AMBIGUOUS");
      if (!anyMetadataCandidate && config.semanticFallback && aha.description?.value) {
        for (const c of titleHits.length ? titleHits.map((h) => candidates.get(h.id)?.artifact).filter((x): x is Artifact => Boolean(x)) : []) {
          if (!c.description?.value) continue;
          const sim = jaccard(tokens(aha.description.value), tokens(c.description.value));
          if (sim < 0.3) continue;
          const score = Math.min(SCORE.capSharedKeyword, Math.round(sim * 100));
          const refs = [addEvidence({ type: "SEMANTIC_INFERENCE", role: "SUPPORTING", subject: aha.key, object: c.key, fields: ["description"], provenance: fieldProvenance(aha, c, ["description"]), value: `lexical overlap ${sim.toFixed(2)}`, retrievalState: "AVAILABLE", note: "Lexical token overlap only. Capped at the shared-keyword ceiling." })];
          rule("R-SEM-001", "R-MD-004");
          pairs.push({
            key: `${aha.key}|${c.key}`,
            aha,
            dpj: c,
            deterministic: false,
            method: "SEMANTIC",
            status: "POSSIBLE",
            score,
            scoreBasis: { baseline: null, capsApplied: [`R-MD-004 shared-keyword cap ${SCORE.capSharedKeyword}`, "R-SEM-001 semantic cap 74 (not reached)"], components: [`lexical overlap ${sim.toFixed(2)}`] },
            evidenceRefs: refs,
            contradictoryRefs: [],
            ruleRefs: ["R-SEM-001", "R-MD-004"],
            candidateSetRef: idSetId,
            explanation: "Semantic fallback on lexical overlap of descriptions only. Never confirms identity or sets authority.",
            raise: ["Deterministic link on either record", "Matching title and owner"],
            lower: [],
            missing: ["title corroboration", "deterministic link"],
          });
        }
      }
    }

    // 2f. Missing and omission, only when no live pair exists.
    const liveForAha = pairs.filter((p) => p.aha.key === aha.key && p.status !== "CONTRADICTORY");
    if (input.expectDpjCounterpart && !liveForAha.some((p) => ["CONFIRMED", "PROBABLE", "AMBIGUOUS", "POSSIBLE"].includes(p.status))) {
      const coverage = idChannels.every((ch) => dpj.searchableIdentifierChannels.includes(ch));
      const idOk = identifierSearch.state === "NOT_FOUND_WITHIN_QUERIED_SCOPE" && !identifierSearch.truncated;
      const titleOk = titleState === "NOT_FOUND_WITHIN_QUERIED_SCOPE" || titleState === "AVAILABLE";
      const notCovered = idChannels.filter((ch) => !dpj.searchableIdentifierChannels.includes(ch));
      let status: RelationshipStatus;
      let state: RetrievalState = identifierSearch.state;
      const missingEvidence: string[] = [];
      if (idOk && coverage && titleOk) {
        status = "MISSING";
        rule("R-MISS-001");
        discrepancies.push({
          id: nextId("D"),
          kind: "MIGRATION_OMISSION",
          severity: "HIGH",
          systems: ["aha", "dpj"],
          records: [aha.key],
          values: [{ artifact: aha.key, field: "DPJ counterpart", value: null }],
          businessImpact: "An Aha record in migration scope has no DPJ counterpart the search could find.",
          evidenceRefs: [addEvidence({ type: "DIRECT_FACT", role: "SUPPORTING", subject: aha.key, fields: ["DPJ counterpart"], provenance: aha.url ? [aha.url.provenance] : [], value: "no candidate", retrievalState: identifierSearch.state, note: identifierSearch.scope })],
          ruleRefs: ["R-MISS-001"],
          authority: "UNKNOWN",
          recommendedResolution: "Create or relate the DPJ work package after the migration owner confirms it belongs in DPJ.",
        });
      } else if (identifierSearch.state === "NOT_AVAILABLE" || identifierSearch.state === "INACCESSIBLE" || identifierSearch.state === "NOT_RETRIEVED" || identifierSearch.truncated) {
        status = "NOT_EVALUATED";
        state = identifierSearch.truncated ? "NOT_AVAILABLE" : identifierSearch.state;
        missingEvidence.push(identifierSearch.truncated ? "identifier search truncated" : `identifier search ${identifierSearch.state}`);
        rule("R-MISS-003");
      } else {
        status = "NOT_EVALUATED";
        missingEvidence.push(...(notCovered.length ? [`DPJ cannot search identity channel(s): ${notCovered.join(", ")}`] : []));
        rule("R-MISS-002");
        discrepancies.push({
          id: nextId("D"),
          kind: "POTENTIAL_MIGRATION_OMISSION",
          severity: "MEDIUM",
          systems: ["aha", "dpj"],
          records: [aha.key],
          values: [{ artifact: aha.key, field: "DPJ counterpart", value: null }],
          businessImpact: "No DPJ counterpart was found in the searchable identity channels. Absence is not proven: descriptions cannot be searched.",
          evidenceRefs: [],
          ruleRefs: ["R-MISS-002"],
          authority: "UNKNOWN",
          recommendedResolution: "Check DPJ manually for the Aha reference, or add a searchable custom field carrying it.",
        });
      }
      relationships.push({
        id: nextId("R"),
        source: aha.key,
        targetSystem: "dpj",
        status,
        method: "NONE",
        score: null,
        scoreBasis: { baseline: null, capsApplied: [], components: [] },
        evidenceRefs: [],
        contradictoryEvidenceRefs: [],
        missingEvidence,
        candidateSetRef: idSetId,
        targetRetrievalState: state,
        ruleRefs: status === "MISSING" ? ["R-MISS-001"] : ["R-MISS-002"],
        explanation: status === "MISSING" ? `No DPJ candidate for ${aha.sourceId} in ${identifierSearch.scope}.` : `No live DPJ candidate for ${aha.sourceId}. Search state ${identifierSearch.state}; MISSING criteria not met.`,
        wouldRaiseConfidence: ["Searchable DPJ identity channel covering descriptions"],
        wouldLowerConfidence: [],
      });
    }

    // Downstream traceability: report links, do not query.
    for (const link of aha.links.filter((l) => l.targetSystem !== "dpj" && l.targetSystem !== "aha")) {
      downstreamLinks.push({
        source: aha.key,
        targetSystem: link.targetSystem,
        ...(link.targetId ? { targetId: link.targetId } : {}),
        ...(link.url ? { url: link.url } : {}),
        retrievalState: "NOT_RETRIEVED",
        note: `Recorded in Aha integration fields. No ${link.targetSystem} connector is loaded; target not queried.`,
      });
    }
  }

  // Deterministic pairs were pushed earlier; metadata/semantic pairs were pushed later.
  // Now materialize relationships, alignments, discrepancies, and proposals from pairs.
  for (const p of pairs) {
    const relId = nextId("R");
    relationships.push({
      id: relId,
      source: p.aha.key,
      target: p.dpj.key,
      targetSystem: "dpj",
      status: p.status,
      method: p.method,
      score: p.score,
      scoreBasis: p.scoreBasis,
      evidenceRefs: p.evidenceRefs,
      contradictoryEvidenceRefs: p.contradictoryRefs,
      missingEvidence: p.missing,
      ...(p.candidateSetRef ? { candidateSetRef: p.candidateSetRef } : {}),
      targetRetrievalState: "AVAILABLE",
      ruleRefs: [...new Set(p.ruleRefs)].sort(),
      explanation: p.explanation,
      wouldRaiseConfidence: p.raise,
      wouldLowerConfidence: p.lower,
    });
    p.ruleRefs.forEach((r) => ruleRefs.add(r));

    if ((p.status === "CONFIRMED" || p.status === "PROBABLE") && p.aha && p.dpj) {
      const aligned = assessAlignment(p.aha, p.dpj, config);
      const alignId = nextId("A");
      const comparisonEvidence = aligned.comparisons.map((cmp) => ({
        cmp,
        ev: addEvidence({ type: cmp.method === "SEMANTIC" ? "SEMANTIC_INFERENCE" : "DIRECT_FACT", role: cmp.result === "DIFFERENT" ? "CONTRADICTORY" : "SUPPORTING", subject: p.aha.key, object: p.dpj.key, fields: [cmp.field], provenance: fieldProvenance(p.aha, p.dpj, [cmp.field]), value: `${cmp.sourceValue ?? "—"} | ${cmp.targetValue ?? "—"}`, retrievalState: "AVAILABLE", note: cmp.note ?? `Field comparison ${cmp.result}.` }),
      }));
      const comparisons = comparisonEvidence.map(({ cmp, ev }) => ({ ...cmp, evidenceRefs: [ev] }));
      rule(...aligned.ruleRefs);
      alignments.push({
        id: alignId,
        relationshipRef: relId,
        status: aligned.status,
        comparisons,
        evidenceRefs: comparisonEvidence.map((c) => c.ev),
        ruleRefs: aligned.ruleRefs,
        explanation: aligned.explanation,
      });
      for (const { cmp, ev } of comparisonEvidence) {
        if (cmp.result !== "DIFFERENT") continue;
        const spec = DISCREPANCY_FOR_FIELD[cmp.field] ?? { kind: "SCOPE_DRIFT" as DiscrepancyKind, severity: SCOPE_DRIFT_SEVERITY, impact: "Meaning differs; verify scope." };
        const kind: DiscrepancyKind = cmp.field === "description" ? "SCOPE_DRIFT" : spec.kind;
        const severity: Severity = cmp.field === "description" ? SCOPE_DRIFT_SEVERITY : spec.severity;
        const authorityRule = config.authority.find((a) => a.field === cmp.field && a.targetSystem === "dpj");
        const authority: Discrepancy["authority"] = authorityRule ? { system: authorityRule.authoritativeSystem, basis: authorityRule.basis } : "UNKNOWN";
        const discId = nextId("D");
        discrepancies.push({
          id: discId,
          kind,
          severity,
          systems: ["aha", "dpj"],
          records: [p.aha.key, p.dpj.key],
          values: [
            { artifact: p.aha.key, field: cmp.field, value: cmp.sourceValue, ...(provFor(p.aha, cmp.field) ? { provenance: provFor(p.aha, cmp.field)! } : {}) },
            { artifact: p.dpj.key, field: cmp.field, value: cmp.targetValue, ...(provFor(p.dpj, cmp.field) ? { provenance: provFor(p.dpj, cmp.field)! } : {}) },
          ],
          businessImpact: spec.impact,
          evidenceRefs: [ev],
          ruleRefs: [...aligned.ruleRefs],
          relationshipRef: relId,
          authority,
          recommendedResolution: authority === "UNKNOWN"
            ? `Confirm the authoritative ${cmp.field} with the migration owner. Both values are preserved; no overwrite is proposed.`
            : `Review the proposed ${cmp.field} change against ${authority.system} and approve it explicitly by proposal ID.`,
        });
        if (p.status === "CONFIRMED" && authorityRule && cmp.targetValue !== null && cmp.sourceValue !== null) {
          const proposalId = `P-${stableHash([relId, cmp.field, cmp.sourceValue]).slice(0, 8)}`;
          proposals.push({
            proposalId,
            status: "PROPOSED",
            applied: false,
            targetSystem: "dpj",
            targetRecord: p.dpj.key,
            field: cmp.field,
            existingValue: cmp.targetValue,
            proposedValue: cmp.sourceValue,
            evidenceRefs: [ev],
            ruleRefs: ["R-PROP-001", "R-PROP-002"],
            provenance: fieldProvenance(p.aha, p.dpj, [cmp.field]),
            evidenceScore: p.score ?? 0,
            risk: severity,
            impact: spec.impact,
            approverOrOwner: "unknown (named in authority.basis only if configured)",
            baseStateFingerprint: stableHash({ key: p.dpj.key, field: cmp.field, value: cmp.targetValue, lastModified: p.dpj.lastModified?.value }),
            approvalRequirement: `Explicit human approval naming ${proposalId}. Re-read ${p.dpj.key} before any apply; invalidate if its fingerprint changed.`,
          });
          rule("R-PROP-001", "R-PROP-002");
        }
      }
    }
  }

  // ---- 3. Assemble result ---------------------------------------------------
  const systemsQueried = [...session.queried];
  const systemsNotQueried: ReconciliationResult["systemsNotQueried"] = [
    { system: "figma", reason: "IDE plugin only; no agent connection" },
    { system: "azure_devops", reason: "no Azure DevOps connector in this repository" },
    { system: "github", reason: "no GitHub connector; plugin status errored during discovery" },
    { system: "mural", reason: "outside the Aha ↔ DPJ scope of this run" },
  ];
  const unverifiedConventions: string[] = [];
  if (config.conventions.dpjSubjectBracketRef.enabled && !config.conventions.dpjSubjectBracketRef.verified) unverifiedConventions.push("DPJ subject [AHA-REF] prefix");
  if (config.conventions.dpjDescriptionAhaUrl.enabled && !config.conventions.dpjDescriptionAhaUrl.verified) unverifiedConventions.push("DPJ description 'Aha:' URL line");
  if (unverifiedConventions.length) limitations.push(`Unverified identity conventions cap these links at PROBABLE: ${unverifiedConventions.join("; ")}.`);
  if (!dpj.searchableIdentifierChannels.includes("description")) limitations.push("DPJ search_work_packages filters on subject only; descriptions and custom fields cannot be searched, so omission cannot be concluded.");
  if (config.semanticFallback) limitations.push("Semantic fallback is lexical overlap only; it is capped at the shared-keyword ceiling and never confirms identity.");
  if (config.statusMapping === null) limitations.push("No Aha↔DPJ status mapping is configured; status is NOT_COMPARABLE.");
  if (config.authority.length === 0) limitations.push("No field authority is configured; discrepancies keep both values and no proposals are generated.");
  limitations.push("No Azure DevOps, GitHub, Figma, or Mural retrieval was performed.");

  const retrievalLog = session.log;
  return {
    mutationMode: MUTATION_MODE,
    statement: NO_CHANGES_STATEMENT,
    scope: { aha: ahaRefs, dpj: dpjSeedIds, options: { expectDpjCounterpart: input.expectDpjCounterpart, dpjProjectId: input.dpjProjectId ?? null } },
    systemsQueried,
    systemsNotQueried,
    artifacts: [...artifacts.values()],
    evidence,
    candidateSets,
    relationships,
    alignments,
    discrepancies,
    proposals,
    downstreamLinks,
    retrievalLog,
    limitations,
    rulesApplied: describeRules(ruleRefs),
  };
}

// ---- helpers ----------------------------------------------------------------

function identityChannelsRequired(config: RamirezConfig): Array<"subject" | "description" | "custom_field"> {
  const out: Array<"subject" | "description" | "custom_field"> = [];
  if (config.conventions.dpjSubjectBracketRef.enabled) out.push("subject");
  if (config.conventions.dpjDescriptionAhaUrl.enabled) out.push("description");
  if (config.dpj.ahaReferenceCustomFields.length > 0) out.push("custom_field");
  return out;
}

function backrefVerified(link: CrossSystemLink, config: RamirezConfig): boolean {
  if (link.kind === "dpj_custom_field_ref") return true;
  if (link.kind === "dpj_subject_bracket_ref") return config.conventions.dpjSubjectBracketRef.verified;
  if (link.kind === "dpj_description_aha_url") return config.conventions.dpjDescriptionAhaUrl.verified;
  return false;
}

async function resolveHit(hit: CandidateHit, dpj: PlanningAdapter, session: RetrievalSession, artifacts: Map<string, Artifact>): Promise<Artifact | undefined> {
  if (hit.artifact) {
    artifacts.set(hit.artifact.key, hit.artifact);
    return hit.artifact;
  }
  const res = await session.run("dpj", "search_work_packages", `id=${hit.id}`, "Fetch a candidate DPJ record", () => dpj.getById(hit.id));
  if (res.value) artifacts.set(res.value.key, res.value);
  return res.value;
}

type MetadataResult = {
  score: number;
  caps: string[];
  corroborations: string[];
  contradictions: string[];
  fields: string[];
  rules: string[];
  summary: string;
};

/** Metadata comparison. Never returns CONFIRMED; the caller maps score to status. */
export function metadataScore(aha: Artifact, dpj: Artifact, config: RamirezConfig): MetadataResult {
  const rTitle = aha.title?.value ?? "";
  const xTitle = dpj.title?.value ?? "";
  const titleExact = normalizeTitle(rTitle) !== "" && normalizeTitle(rTitle) === normalizeTitle(xTitle);
  const overlap = jaccard(tokens(rTitle), tokens(xTitle));
  const titleSimilar = !titleExact && overlap >= 0.8;
  const corroborations: string[] = [];
  const contradictions: string[] = [];
  const fields: string[] = ["title"];

  const typeR = aha.recordType?.value;
  const typeX = dpj.recordType?.value?.toLowerCase();
  if (typeR && typeX) {
    fields.push("recordType");
    const expected = config.typeEquivalence[typeR];
    if (expected && expected === typeX) corroborations.push("type");
    else if (expected) contradictions.push("type");
  }
  if (aha.owner && dpj.owner) {
    fields.push("owner");
    if (normalizeName(aha.owner.value.name) === normalizeName(dpj.owner.value.name)) corroborations.push("owner");
  }
  const aStart = calendarDate(aha.startDate?.value);
  if (aStart) {
    fields.push("startDate");
    if (aStart === calendarDate(dpj.startDate?.value)) corroborations.push("start");
  }
  const aDue = calendarDate(aha.dueDate?.value);
  if (aDue) {
    fields.push("dueDate");
    if (aDue === calendarDate(dpj.dueDate?.value)) corroborations.push("due");
  }

  const caps: string[] = [];
  const rules: string[] = [];
  const corr = corroborations.length;
  let score: number;
  if (titleExact && corr >= 2) {
    score = SCORE.metadataStrong;
    rules.push("R-MD-001");
  } else if (titleExact && corr === 1) {
    score = SCORE.metadataTitlePlusOne;
    rules.push("R-MD-002");
  } else if (titleExact) {
    score = SCORE.capTitleOnly;
    caps.push(`R-MD-003 title-only cap ${SCORE.capTitleOnly}`);
    rules.push("R-MD-003");
  } else if (titleSimilar && corr >= 2) {
    score = SCORE.metadataSimilarTitleStrong;
    rules.push("R-MD-002");
  } else {
    score = Math.min(SCORE.capSharedKeyword, Math.round(overlap * 100));
    caps.push(`R-MD-004 shared-keyword cap ${SCORE.capSharedKeyword}`);
    rules.push("R-MD-004");
  }
  if (contradictions.length > 0) {
    score = Math.min(score, 74);
    caps.push("R-MD-007 contradictory type limits status to POSSIBLE");
    rules.push("R-MD-007");
  }
  return {
    score,
    caps,
    corroborations,
    contradictions,
    fields,
    rules: [...rules, "R-MD-006"],
    summary: `title ${titleExact ? "exact" : titleSimilar ? "similar" : `overlap ${overlap.toFixed(2)}`}; corroborated: ${corroborations.join(", ") || "none"}${contradictions.length ? `; contradictory: ${contradictions.join(", ")}` : ""}`,
  };
}

type ProvField = "title" | "description" | "owner" | "status" | "startDate" | "dueDate" | "release" | "parent" | "recordType" | "lastModified" | "url";

/** Provenance of one normalized field, or undefined when the field was not retrieved. */
function provFor(artifact: Artifact, field: string): Provenance | undefined {
  const v = (artifact as unknown as Record<string, { provenance?: Provenance } | undefined>)[field === "hierarchy" ? "parent" : field];
  return v?.provenance;
}

function fieldProvenance(aha: Artifact, dpj: Artifact, fields: string[]): Provenance[] {
  const out: Provenance[] = [];
  for (const f of fields) {
    const a = provFor(aha, f);
    const d = provFor(dpj, f);
    if (a) out.push(a);
    if (d) out.push(d);
  }
  return out;
}

type Alignment = { status: AlignmentStatus; comparisons: FieldComparison[]; ruleRefs: string[]; explanation: string };

export function assessAlignment(aha: Artifact, dpj: Artifact, config: RamirezConfig): Alignment {
  const comparisons: FieldComparison[] = [];
  const ruleRefs = new Set<string>(["R-AL-001"]);

  const rTitle = stripIdentityPrefix(aha.title?.value ?? "");
  const xTitle = stripIdentityPrefix(dpj.title?.value ?? "");
  ruleRefs.add("R-AL-002");
  comparisons.push(compare("title", rTitle, xTitle, "NORMALIZED", "R-AL-002", (a, b) => normalizeTitle(a) === normalizeTitle(b)));

  const rDesc = comparableDescription(aha.description?.value ?? "");
  const xDesc = comparableDescription(dpj.description?.value ?? "");
  ruleRefs.add("R-AL-003");
  if (!rDesc || !xDesc) {
    comparisons.push({ field: "description", sourceValue: rDesc || null, targetValue: xDesc || null, result: "NOT_COMPARABLE", method: "SEMANTIC", evidenceRefs: [], ruleRef: "R-AL-003", note: "one side has no description" });
  } else {
    const sim = jaccard(tokens(rDesc), tokens(xDesc));
    comparisons.push({ field: "description", sourceValue: excerpt(rDesc, 200) ?? null, targetValue: excerpt(xDesc, 200) ?? null, result: sim >= 0.5 ? "EQUAL" : "DIFFERENT", method: "SEMANTIC", evidenceRefs: [], ruleRef: "R-AL-003", note: `lexical overlap ${sim.toFixed(2)} (threshold 0.50)` });
  }

  ruleRefs.add("R-AL-006");
  comparisons.push(compare("owner", aha.owner?.value.name ?? "", dpj.owner?.value.name ?? "", "NORMALIZED", "R-AL-006", (a, b) => normalizeName(a) === normalizeName(b)));
  ruleRefs.add("R-AL-005");
  comparisons.push(compare("startDate", calendarDate(aha.startDate?.value) ?? "", calendarDate(dpj.startDate?.value) ?? "", "DIRECT", "R-AL-005", (a, b) => a === b));
  comparisons.push(compare("dueDate", calendarDate(aha.dueDate?.value) ?? "", calendarDate(dpj.dueDate?.value) ?? "", "DIRECT", "R-AL-005", (a, b) => a === b));

  ruleRefs.add("R-AL-004");
  if (!config.statusMapping) {
    comparisons.push({ field: "status", sourceValue: aha.status?.value.name ?? null, targetValue: dpj.status?.value.name ?? null, result: "NOT_COMPARABLE", method: "DIRECT", evidenceRefs: [], ruleRef: "R-AL-004", note: "no status mapping configured" });
  } else {
    const a = aha.status ? config.statusMapping.aha[aha.status.value.name] : undefined;
    const x = dpj.status ? config.statusMapping.dpj[dpj.status.value.name] : undefined;
    comparisons.push(a && x ? compare("status", a, x, "DIRECT", "R-AL-004", (p, q) => p === q) : { field: "status", sourceValue: aha.status?.value.name ?? null, targetValue: dpj.status?.value.name ?? null, result: "NOT_COMPARABLE", method: "DIRECT", evidenceRefs: [], ruleRef: "R-AL-004", note: "status not in mapping" });
  }

  ruleRefs.add("R-AL-007");
  const parentA = aha.parent?.value.id;
  const parentX = dpj.parent?.value.refInTitle;
  comparisons.push(parentA && parentX ? compare("hierarchy", parentA, parentX, "DIRECT", "R-AL-007", (p, q) => p === q) : { field: "hierarchy", sourceValue: parentA ?? null, targetValue: parentX ?? null, result: "NOT_COMPARABLE", method: "DIRECT", evidenceRefs: [], ruleRef: "R-AL-007", note: "a parent identifier is missing on one side" });

  ruleRefs.add("R-AL-008");
  const typeA = aha.recordType?.value;
  const typeX = dpj.recordType?.value?.toLowerCase();
  const expectedType = typeA ? config.typeEquivalence[typeA] : undefined;
  comparisons.push(expectedType && typeX ? compare("recordType", expectedType, typeX, "DIRECT", "R-AL-008", (p, q) => p === q) : { field: "recordType", sourceValue: typeA ?? null, targetValue: typeX ?? null, result: "NOT_COMPARABLE", method: "DIRECT", evidenceRefs: [], ruleRef: "R-AL-008", note: "no type equivalence configured" });

  const different = comparisons.filter((c) => c.result === "DIFFERENT");
  const contradictoryFields = new Set(["description", "hierarchy", "status"]);
  let status: AlignmentStatus;
  if (different.some((c) => contradictoryFields.has(c.field))) status = "CONTRADICTORY";
  else if (different.length > 0) status = "PARTIALLY_ALIGNED";
  else if (comparisons.some((c) => c.result === "EQUAL")) status = "ALIGNED";
  else status = "NOT_EVALUATED";
  ruleRefs.add("R-AL-009");
  return {
    status,
    comparisons,
    ruleRefs: [...ruleRefs].sort(),
    explanation: `${different.length} field(s) differ: ${different.map((c) => c.field).join(", ") || "none"}. ${comparisons.filter((c) => c.result === "NOT_COMPARABLE").length} field(s) not comparable. Identity is evaluated separately.`,
  };
}

function compare(field: string, a: string, b: string, method: FieldComparison["method"], ruleRef: string, eq: (x: string, y: string) => boolean): FieldComparison {
  if (!a || !b) return { field, sourceValue: a || null, targetValue: b || null, result: "NOT_COMPARABLE", method, evidenceRefs: [], ruleRef, note: "one side is empty" };
  return { field, sourceValue: a, targetValue: b, result: eq(a, b) ? "EQUAL" : "DIFFERENT", method, evidenceRefs: [], ruleRef };
}
