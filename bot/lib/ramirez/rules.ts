// Reconciliation rules. Every assessment cites the rule ids it applied, so a
// conclusion can be reproduced from its evidence and these definitions.
import type { DiscrepancyKind, Severity } from "./types";

export const SCORE = {
  migrationIdUnique: 95,
  explicitVerifiedUnique: 92,
  explicitUnverifiedConvention: 85,
  metadataStrong: 80,
  metadataTitlePlusOne: 70,
  metadataSimilarTitleStrong: 65,
  metadataAmbiguous: 60,
  capSemanticOnly: 74,
  capTitleOnly: 49,
  capSharedKeyword: 39,
  candidateFloor: 25,
  ambiguityWindow: 10,
} as const;

export const RULES = {
  "R-ID-001": "Unique explicit identity link whose target resolves and is corroborated in both directions, or comes from a verified convention: baseline 92, CONFIRMED.",
  "R-ID-002": "Unique match on a configured migration/external-ID field: baseline 95, CONFIRMED.",
  "R-ID-003": "One-directional identity link (explicit link on one side only, or a subject/description convention not marked verified): baseline 85, PROBABLE.",
  "R-ID-004": "Deterministic identifiers that point to different records: CONTRADICTORY. Never averaged away.",
  "R-ID-005": "More than one record carries a deterministic identity link to the same source: each pair AMBIGUOUS, report DUPLICATE_MAPPING.",
  "R-ID-006": "Explicit link whose target cannot be resolved: NOT_EVALUATED. NOT_FOUND by exact-ID lookup raises POTENTIAL_BROKEN_LINK; INACCESSIBLE/NOT_RETRIEVED is a limitation only.",
  "R-ID-007": "A text mention of another record's identifier is context, not identity evidence.",
  "R-MD-001": "Metadata match: exact normalized title plus at least two corroborating fields (type, owner, start, due): baseline 80.",
  "R-MD-002": "Exact normalized title plus one corroborating field: 70. Similar title plus at least two: 65.",
  "R-MD-003": "Title-only evidence is capped at 49.",
  "R-MD-004": "Shared keywords/theme alone is capped at 39.",
  "R-MD-005": "Two or more candidates scoring at least 50 within 10 points of each other: AMBIGUOUS, score capped at 60.",
  "R-MD-006": "Metadata evidence never yields CONFIRMED. At least 75 with no rival is PROBABLE; 25-74 is POSSIBLE; below 25 is rejected.",
  "R-MD-007": "Contradictory metadata (incompatible record type) limits status to POSSIBLE and is reported, not subtracted.",
  "R-SEM-001": "Semantic comparison runs only when deterministic and metadata evidence leave the question unresolved. Capped at 74; never yields CONFIRMED or authority.",
  "R-MISS-001": "MISSING only when (a) a counterpart is expected by user-declared migration scope, (b) every enabled identity channel for the Aha reference is searchable by the connector, (c) each identifier search completed without error or truncation, and (d) no identity or metadata candidate survived. Searching descriptions or custom fields is not possible with the current DPJ search tool, so DPJ omissions cannot reach MISSING.",
  "R-MISS-002": "Expected counterpart not found but the MISSING criteria are not met: NOT_EVALUATED with NOT_FOUND_WITHIN_QUERIED_SCOPE, reported as POTENTIAL_MIGRATION_OMISSION.",
  "R-MISS-003": "Identifier search error or truncation: NOT_EVALUATED with the classified retrieval state. Not a migration omission.",
  "R-AL-001": "Alignment is evaluated only for CONFIRMED or PROBABLE relationships.",
  "R-AL-002": "Titles compared after normalization and removal of identity prefixes.",
  "R-AL-003": "Descriptions compared after removal of markup and identity lines; low lexical overlap is a SEMANTIC_INFERENCE of drift.",
  "R-AL-004": "Status compared only through a configured status mapping; otherwise NOT_COMPARABLE.",
  "R-AL-005": "Start and due dates compared by calendar date.",
  "R-AL-006": "Owners compared by normalized name tokens; emails are not used.",
  "R-AL-007": "Hierarchy compared through the parent's explicit identifier; a parent with no identifier is NOT_COMPARABLE.",
  "R-AL-008": "Record types compared through the configured type equivalence.",
  "R-AL-009": "Any DIFFERENT on description, hierarchy, or mapped status makes alignment CONTRADICTORY; other differences make it PARTIALLY_ALIGNED.",
  "R-PROP-001": "A proposal requires a CONFIRMED relationship, a DIFFERENT field, and configured authority for that field and direction.",
  "R-PROP-002": "Proposals are never applied. A future apply requires approval naming the proposal ID and a re-read that matches baseStateFingerprint.",
  "R-LF-001": "Aha description or named custom-field Figma URL is an identity claim when that convention is enabled; CONFIRMED only when the operator marked it verified.",
  "R-LF-002": "Aha description or named custom-field Mural URL is an identity claim when that convention is enabled; CONFIRMED only when verified.",
  "R-LF-003": "Aha reference in a Figma file/page/frame name is an identity claim when figmaTitleAhaRef is enabled; never from comments alone (R-ID-007).",
  "R-LF-004": "Aha reference in a Mural board title is an identity claim when muralTitleAhaRef is enabled; sticky/area text is never identity.",
  "R-LF-005": "DESIGN_PLANNING_MISMATCH: CONFIRMED or PROBABLE Aha↔Figma pair with material title/description/scope disagreement.",
  "R-LF-006": "RESEARCH_ABSENT_FROM_PLANNING: mural theme/board expected in planning and no Aha candidate survived under expectation rules.",
  "R-LF-007": "PLANNING_ABSENT_FROM_DESIGN: Aha in scope with expectDesignCounterpart and no matching Figma evidence.",
  "R-LF-008": "STALE_DESIGN_LINK: Aha Figma URL resolves to a different fileKey than supplied design evidence.",
  "R-LF-009": "ORPHAN_DESIGN_EVIDENCE / ORPHAN_RESEARCH_EVIDENCE: evidence supplied with expectation true and no planning candidate — NOT MISSING unless R-MISS-001 holds.",
  "R-LF-010": "INTRA_AHA_CONTRADICTION / INTRA_AHA_DUPLICATE: two Aha records related under operator scope with conflicting or duplicate scope.",
  "R-LF-011": "Lifecycle path: the same Aha record participates in independent mural↔Aha and Figma↔Aha assessments; each hop keeps its own status.",
  "R-LF-012": "Figma URL on a mural description is an identity claim when muralDescriptionFigmaUrl is enabled; CONFIRMED only when verified.",
  "R-LF-013": "RESEARCH_DESIGN_MISMATCH: CONFIRMED or PROBABLE mural↔Figma pair with material title/description disagreement.",
  "R-LF-014": "Aha vsts integration field or description/custom-field ADO URL is an identity claim when enabled; CONFIRMED only when verified.",
  "R-LF-015": "Aha reference in an ADO work-item title is an identity claim when adoTitleAhaRef is enabled; never from comments alone (R-ID-007).",
  "R-LF-016": "ENGINEERING_PLANNING_MISMATCH: CONFIRMED or PROBABLE Aha↔ADO pair with material title/description/state disagreement.",
  "R-LF-017": "PLANNING_ABSENT_FROM_ENGINEERING: Aha in scope with expectEngineeringCounterpart and no matching ADO evidence.",
  "R-LF-018": "STALE_ADO_LINK: Aha ADO URL/id does not match the supplied work-item evidence.",
  "R-LF-019": "ORPHAN_ENGINEERING_EVIDENCE: ADO evidence supplied with expectation true and no planning candidate — NOT MISSING unless R-MISS-001 holds.",
  "R-LF-020": "Aha description or named custom-field GitHub URL is an identity claim when enabled; CONFIRMED only when verified.",
  "R-LF-021": "Aha reference in a GitHub issue/PR title is an identity claim when githubTitleAhaRef is enabled; commit/branch refs are never identity by default.",
  "R-LF-022": "IMPLEMENTATION_PLANNING_MISMATCH: CONFIRMED or PROBABLE Aha↔GitHub pair with material title/description/state disagreement.",
  "R-LF-023": "PLANNING_ABSENT_FROM_IMPLEMENTATION: Aha in scope with expectImplementationCounterpart and no matching GitHub evidence.",
  "R-LF-024": "ORPHAN_IMPLEMENTATION_EVIDENCE: GitHub evidence supplied with expectation true and no planning candidate — NOT MISSING unless R-MISS-001 holds.",
  "R-LF-025": "UNSUPPORTED_COMPLETION_CLAIM: planning marked complete while supplied GitHub PR/issue evidence is still open or unmerged.",
} as const;

/** Severity for Phase 4 lifecycle discrepancy kinds (rule-mediated). */
export const LIFECYCLE_DISCREPANCY: Partial<
  Record<DiscrepancyKind, { severity: Severity; impact: string; ruleRefs: string[] }>
> = {
  DESIGN_PLANNING_MISMATCH: {
    severity: "HIGH",
    impact: "Planning and design describe different scope; users may be built the wrong experience.",
    ruleRefs: ["R-LF-005"],
  },
  RESEARCH_ABSENT_FROM_PLANNING: {
    severity: "MEDIUM",
    impact: "Research findings on the mural are not reflected in planning records.",
    ruleRefs: ["R-LF-006"],
  },
  PLANNING_ABSENT_FROM_DESIGN: {
    severity: "MEDIUM",
    impact: "A planning record in scope has no matching design evidence.",
    ruleRefs: ["R-LF-007"],
  },
  STALE_DESIGN_LINK: {
    severity: "HIGH",
    impact: "The Figma link on the planning record does not match the design evidence under review.",
    ruleRefs: ["R-LF-008"],
  },
  ORPHAN_DESIGN_EVIDENCE: {
    severity: "MEDIUM",
    impact: "Design evidence was supplied with no planning counterpart in the queried scope.",
    ruleRefs: ["R-LF-009"],
  },
  ORPHAN_RESEARCH_EVIDENCE: {
    severity: "MEDIUM",
    impact: "A mural was named with no planning counterpart in the queried scope.",
    ruleRefs: ["R-LF-009"],
  },
  INTRA_AHA_CONTRADICTION: {
    severity: "HIGH",
    impact: "Related Aha records disagree on material scope or requirements.",
    ruleRefs: ["R-LF-010"],
  },
  INTRA_AHA_DUPLICATE: {
    severity: "MEDIUM",
    impact: "Two Aha records likely describe the same work; risk of double funding or drift.",
    ruleRefs: ["R-LF-010"],
  },
  RESEARCH_DESIGN_MISMATCH: {
    severity: "HIGH",
    impact: "Research board and design mockup disagree on material scope; users may see the wrong experience.",
    ruleRefs: ["R-LF-013"],
  },
  ENGINEERING_PLANNING_MISMATCH: {
    severity: "HIGH",
    impact: "Planning and engineering describe different scope; delivery may build the wrong work.",
    ruleRefs: ["R-LF-016"],
  },
  PLANNING_ABSENT_FROM_ENGINEERING: {
    severity: "MEDIUM",
    impact: "A planning record in scope has no matching Azure DevOps evidence.",
    ruleRefs: ["R-LF-017"],
  },
  STALE_ADO_LINK: {
    severity: "HIGH",
    impact: "The Azure DevOps link on the planning record does not match the work item under review.",
    ruleRefs: ["R-LF-018"],
  },
  ORPHAN_ENGINEERING_EVIDENCE: {
    severity: "MEDIUM",
    impact: "ADO evidence was supplied with no planning counterpart in the queried scope.",
    ruleRefs: ["R-LF-019"],
  },
  IMPLEMENTATION_PLANNING_MISMATCH: {
    severity: "HIGH",
    impact: "Planning and implementation describe different scope; code may not match the plan.",
    ruleRefs: ["R-LF-022"],
  },
  PLANNING_ABSENT_FROM_IMPLEMENTATION: {
    severity: "MEDIUM",
    impact: "A planning record in scope has no matching GitHub evidence.",
    ruleRefs: ["R-LF-023"],
  },
  ORPHAN_IMPLEMENTATION_EVIDENCE: {
    severity: "MEDIUM",
    impact: "GitHub evidence was supplied with no planning counterpart in the queried scope.",
    ruleRefs: ["R-LF-024"],
  },
  UNSUPPORTED_COMPLETION_CLAIM: {
    severity: "HIGH",
    impact: "Planning claims completion while implementation evidence is still open or unmerged.",
    ruleRefs: ["R-LF-025"],
  },
};

export type RuleId = keyof typeof RULES;

export function describeRules(ids: Iterable<string>): Array<{ id: string; description: string }> {
  return [...new Set(ids)].sort().map((id) => ({ id, description: RULES[id as RuleId] ?? "unknown rule" }));
}
