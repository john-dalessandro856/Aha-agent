// Ramirez domain model. The reconciliation engine works only on these
// normalized objects, never on raw connector payloads.

export const MUTATION_MODE = "PROPOSAL_ONLY" as const;
export const NO_CHANGES_STATEMENT = "No changes have been applied. Ramirez is operating in PROPOSAL_ONLY mode.";

export type SystemId = "aha" | "dpj" | "mural" | "figma" | "azure_devops" | "github";

export type RetrievalState =
  | "AVAILABLE"
  | "NOT_RETRIEVED"
  | "NOT_AVAILABLE"
  | "INACCESSIBLE"
  | "NOT_FOUND_WITHIN_QUERIED_SCOPE"
  | "NOT_APPLICABLE";

export type LifecyclePresence =
  | "PRESENT"
  | "NOT_STARTED"
  | "INTENTIONALLY_ABSENT"
  | "REPRESENTED_ELSEWHERE"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

export type EvidenceType =
  | "DIRECT_FACT"
  | "EXPLICIT_IDENTIFIER_LINK"
  | "METADATA_INFERENCE"
  | "SEMANTIC_INFERENCE"
  | "AGENT_RECOMMENDATION";

export type RelationshipStatus =
  | "CONFIRMED"
  | "PROBABLE"
  | "POSSIBLE"
  | "AMBIGUOUS"
  | "MISSING"
  | "CONTRADICTORY"
  | "NOT_APPLICABLE"
  | "NOT_EVALUATED";

export type AlignmentStatus = "ALIGNED" | "PARTIALLY_ALIGNED" | "CONTRADICTORY" | "NOT_EVALUATED";

export type MatchingMethod = "DETERMINISTIC" | "METADATA" | "SEMANTIC" | "NONE";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

export type Provenance = {
  system: SystemId;
  sourceRecordId: string;
  sourceField: string;
  retrievedAt: string;
  retrievalMethod: string;
  adapter: string;
  sourceUrl?: string;
  excerpt?: string;
};

/** A normalized value that keeps the source field it came from. */
export type Field<T> = { value: T; provenance: Provenance };

/**
 * How a cross-system reference was found. `identity` kinds claim the two
 * records are the same work; `mention` only says one text names the other.
 */
export type LinkKind =
  | "dpj_subject_bracket_ref"
  | "dpj_description_aha_url"
  | "dpj_custom_field_ref"
  | "aha_description_dpj_url"
  | "aha_custom_field_dpj_url"
  | "aha_integration_field"
  | "text_mention";

export type CrossSystemLink = {
  targetSystem: SystemId;
  targetId?: string;
  url?: string;
  kind: LinkKind;
  claimsIdentity: boolean;
  provenance: Provenance;
};

export type ParentRef = { system: SystemId; id?: string; title?: string; refInTitle?: string };

export type Artifact = {
  key: string;
  system: SystemId;
  sourceId: string;
  displayId?: string;
  retrievalState: RetrievalState;
  recordType?: Field<string>;
  url?: Field<string>;
  title?: Field<string>;
  description?: Field<string>;
  project?: Field<{ id?: string; name?: string; prefix?: string }>;
  owner?: Field<{ id?: string; name: string }>;
  status?: Field<{ name: string; category?: string }>;
  startDate?: Field<string>;
  dueDate?: Field<string>;
  release?: Field<{ id?: string; name: string }>;
  tags?: Field<string[]>;
  parent?: Field<ParentRef>;
  externalIds: Array<{ scheme: string; value: string; provenance: Provenance }>;
  links: CrossSystemLink[];
  lastModified?: Field<string>;
};

export type Evidence = {
  id: string;
  type: EvidenceType;
  role: "SUPPORTING" | "CONTRADICTORY" | "CONTEXT";
  subject: string;
  object?: string;
  fields: string[];
  provenance: Provenance[];
  value?: string;
  retrievalState: RetrievalState;
  note: string;
};

export type CandidateSet = {
  id: string;
  source: string;
  targetSystem: SystemId;
  candidates: string[];
  rejected: Array<{ key: string; reason: string }>;
  discoveryMethod: string;
  queriedScope: string;
  retrievalState: RetrievalState;
  truncated: boolean;
  ambiguityReason?: string;
  selected?: string;
  selectionBasis?: string;
};

export type ScoreBasis = { baseline: number | null; capsApplied: string[]; components: string[] };

export type RelationshipAssessment = {
  id: string;
  source: string;
  target?: string;
  targetSystem: SystemId;
  status: RelationshipStatus;
  method: MatchingMethod;
  score: number | null;
  scoreBasis: ScoreBasis;
  evidenceRefs: string[];
  contradictoryEvidenceRefs: string[];
  missingEvidence: string[];
  candidateSetRef?: string;
  targetRetrievalState: RetrievalState;
  ruleRefs: string[];
  explanation: string;
  wouldRaiseConfidence: string[];
  wouldLowerConfidence: string[];
};

export type FieldComparison = {
  field: string;
  sourceValue: string | null;
  targetValue: string | null;
  result: "EQUAL" | "DIFFERENT" | "NOT_COMPARABLE";
  method: "DIRECT" | "NORMALIZED" | "SEMANTIC";
  evidenceRefs: string[];
  ruleRef: string;
  note?: string;
};

export type AlignmentAssessment = {
  id: string;
  relationshipRef: string;
  status: AlignmentStatus;
  comparisons: FieldComparison[];
  evidenceRefs: string[];
  ruleRefs: string[];
  explanation: string;
};

export type DiscrepancyKind =
  | "MISSING_LINK"
  | "POTENTIAL_BROKEN_LINK"
  | "MIGRATION_OMISSION"
  | "POTENTIAL_MIGRATION_OMISSION"
  | "DUPLICATE_MAPPING"
  | "AMBIGUOUS_MAPPING"
  | "CONFLICTING_MAPPING"
  | "SCOPE_DRIFT"
  | "TITLE_CONFLICT"
  | "DESCRIPTION_CONFLICT"
  | "HIERARCHY_CONFLICT"
  | "OWNERSHIP_CONFLICT"
  | "STATUS_CONFLICT"
  | "DATE_CONFLICT"
  | "UNSUPPORTED_COMPLETION_CLAIM";

export type ConflictingValue = { artifact: string; field: string; value: string | null; provenance?: Provenance };

export type Discrepancy = {
  id: string;
  kind: DiscrepancyKind;
  severity: Severity;
  systems: SystemId[];
  records: string[];
  values: ConflictingValue[];
  businessImpact: string;
  evidenceRefs: string[];
  ruleRefs: string[];
  relationshipRef?: string;
  authority: "UNKNOWN" | { system: SystemId; basis: string };
  recommendedResolution: string;
};

export type ProposedChange = {
  proposalId: string;
  status: "PROPOSED";
  applied: false;
  targetSystem: SystemId;
  targetRecord: string;
  field: string;
  existingValue: string | null;
  proposedValue: string | null;
  evidenceRefs: string[];
  ruleRefs: string[];
  provenance: Provenance[];
  evidenceScore: number;
  risk: Severity;
  impact: string;
  approverOrOwner: string;
  baseStateFingerprint: string;
  approvalRequirement: string;
};

export type ConnectorCapability = {
  system: SystemId;
  connection: string | null;
  adapter: "PRODUCTION" | "INTERFACE_ONLY";
  verifiedReads: string[];
  unverifiedReads: string[];
  declaredButUnusedWrites: string[];
  notes: string[];
};

export type RetrievalLogEntry = {
  system: SystemId;
  operation: string;
  target: string;
  state: RetrievalState;
  question: string;
  cached: boolean;
  resultCount?: number;
  truncated?: boolean;
  at: string;
  note?: string;
};

export type ReconciliationResult = {
  mutationMode: typeof MUTATION_MODE;
  statement: string;
  scope: { aha: string[]; dpj: string[]; options: { expectDpjCounterpart: boolean; dpjProjectId: string | null } };
  systemsQueried: SystemId[];
  systemsNotQueried: Array<{ system: SystemId; reason: string }>;
  artifacts: Artifact[];
  evidence: Evidence[];
  candidateSets: CandidateSet[];
  relationships: RelationshipAssessment[];
  alignments: AlignmentAssessment[];
  discrepancies: Discrepancy[];
  proposals: ProposedChange[];
  downstreamLinks: Array<{ source: string; targetSystem: SystemId; targetId?: string; url?: string; retrievalState: RetrievalState; note: string }>;
  retrievalLog: RetrievalLogEntry[];
  limitations: string[];
  rulesApplied: Array<{ id: string; description: string }>;
};
