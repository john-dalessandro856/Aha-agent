// Reconciliation rules. Every assessment cites the rule ids it applied, so a
// conclusion can be reproduced from its evidence and these definitions.

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
} as const;

export type RuleId = keyof typeof RULES;

export function describeRules(ids: Iterable<string>): Array<{ id: string; description: string }> {
  return [...new Set(ids)].sort().map((id) => ({ id, description: RULES[id as RuleId] ?? "unknown rule" }));
}
