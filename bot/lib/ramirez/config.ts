import type { LinkKind, SystemId } from "./types";

export type AuthorityRule = {
  field: string;
  authoritativeSystem: SystemId;
  targetSystem: SystemId;
  basis: string;
};

/** Operator-controlled identity convention. Unverified → max PROBABLE. */
export type ConventionFlag = { enabled: boolean; verified: boolean; source: string };

export type NamedFieldConvention = ConventionFlag & { fieldNames: string[] };

export type RamirezConfig = {
  aha: { baseUrl: string };
  dpj: { baseUrl: string; ahaReferenceCustomFields: string[] };
  /**
   * Identity conventions. The operator (person running the agent) sets
   * `verified` when they trust that link type for CONFIRMED identity —
   * per local config or per-run `verifyConventions` overrides.
   */
  conventions: {
    dpjSubjectBracketRef: ConventionFlag;
    dpjDescriptionAhaUrl: ConventionFlag;
    ahaDescriptionFigmaUrl: ConventionFlag;
    ahaCustomFieldFigmaUrl: NamedFieldConvention;
    figmaTitleAhaRef: ConventionFlag;
    ahaDescriptionMuralUrl: ConventionFlag;
    ahaCustomFieldMuralUrl: NamedFieldConvention;
    muralTitleAhaRef: ConventionFlag;
    /** Figma URL pasted on a mural board description (research → design). */
    muralDescriptionFigmaUrl: ConventionFlag;
  };
  /** Aha status category or name → shared bucket. Null: status equivalence unknown. */
  statusMapping: { aha: Record<string, string>; dpj: Record<string, string>; completeBuckets: string[] } | null;
  /** Aha record type → DPJ type name. */
  typeEquivalence: Record<string, string>;
  authority: AuthorityRule[];
  metadataSearchLimit: number;
  semanticFallback: boolean;
};

/** Link kinds the operator may mark verified for a single run. */
export type VerifiableConventionKind = Extract<
  LinkKind,
  | "dpj_subject_bracket_ref"
  | "dpj_description_aha_url"
  | "aha_description_figma_url"
  | "aha_custom_field_figma_url"
  | "figma_title_aha_ref"
  | "aha_description_mural_url"
  | "aha_custom_field_mural_url"
  | "mural_title_aha_ref"
  | "mural_description_figma_url"
>;

const OPERATOR = "operator (person running the agent)";

export const DEFAULT_CONFIG: RamirezConfig = {
  aha: { baseUrl: "https://bayer.aha.io" },
  dpj: { baseUrl: "https://dpj.int.bayer.com", ahaReferenceCustomFields: [] },
  conventions: {
    dpjSubjectBracketRef: {
      enabled: true,
      verified: false,
      source: ".cursor/skills/dpj-write-records/SKILL.md plan example ([AHA-REF] subject prefix)",
    },
    dpjDescriptionAhaUrl: {
      enabled: true,
      verified: false,
      source: ".cursor/skills/dpj-write-records/SKILL.md plan example (Aha: <url> description line)",
    },
    ahaDescriptionFigmaUrl: { enabled: true, verified: false, source: OPERATOR },
    ahaCustomFieldFigmaUrl: { enabled: true, verified: false, fieldNames: [], source: OPERATOR },
    figmaTitleAhaRef: { enabled: true, verified: false, source: OPERATOR },
    ahaDescriptionMuralUrl: { enabled: true, verified: false, source: OPERATOR },
    ahaCustomFieldMuralUrl: { enabled: true, verified: false, fieldNames: [], source: OPERATOR },
    muralTitleAhaRef: { enabled: true, verified: false, source: OPERATOR },
    muralDescriptionFigmaUrl: { enabled: true, verified: false, source: OPERATOR },
  },
  statusMapping: null,
  typeEquivalence: { epic: "epic", master_feature: "epic", feature: "feature", initiative: "initiative" },
  authority: [],
  metadataSearchLimit: 5,
  semanticFallback: true,
};

export type RamirezConfigOverrides = Omit<Partial<RamirezConfig>, "aha" | "dpj" | "conventions"> & {
  aha?: Partial<RamirezConfig["aha"]>;
  dpj?: Partial<RamirezConfig["dpj"]>;
  conventions?: Partial<RamirezConfig["conventions"]>;
};

export function withConfig(overrides: RamirezConfigOverrides = {}): RamirezConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    aha: { ...DEFAULT_CONFIG.aha, ...overrides.aha },
    dpj: { ...DEFAULT_CONFIG.dpj, ...overrides.dpj },
    conventions: { ...DEFAULT_CONFIG.conventions, ...overrides.conventions },
  };
}

/** Marks listed link kinds verified for this run without mutating global defaults. */
export function withVerifiedConventions(config: RamirezConfig, kinds: readonly VerifiableConventionKind[]): RamirezConfig {
  if (kinds.length === 0) return config;
  const set = new Set(kinds);
  const c = { ...config.conventions };
  const mark = <T extends ConventionFlag>(flag: T, kind: VerifiableConventionKind): T =>
    set.has(kind) ? { ...flag, enabled: true, verified: true } : flag;
  return {
    ...config,
    conventions: {
      dpjSubjectBracketRef: mark(c.dpjSubjectBracketRef, "dpj_subject_bracket_ref"),
      dpjDescriptionAhaUrl: mark(c.dpjDescriptionAhaUrl, "dpj_description_aha_url"),
      ahaDescriptionFigmaUrl: mark(c.ahaDescriptionFigmaUrl, "aha_description_figma_url"),
      ahaCustomFieldFigmaUrl: mark(c.ahaCustomFieldFigmaUrl, "aha_custom_field_figma_url"),
      figmaTitleAhaRef: mark(c.figmaTitleAhaRef, "figma_title_aha_ref"),
      ahaDescriptionMuralUrl: mark(c.ahaDescriptionMuralUrl, "aha_description_mural_url"),
      ahaCustomFieldMuralUrl: mark(c.ahaCustomFieldMuralUrl, "aha_custom_field_mural_url"),
      muralTitleAhaRef: mark(c.muralTitleAhaRef, "mural_title_aha_ref"),
      muralDescriptionFigmaUrl: mark(c.muralDescriptionFigmaUrl, "mural_description_figma_url"),
    },
  };
}

/** Whether a link kind is verified identity under this config. */
export function conventionVerified(config: RamirezConfig, kind: LinkKind): boolean {
  switch (kind) {
    case "dpj_subject_bracket_ref":
      return config.conventions.dpjSubjectBracketRef.verified;
    case "dpj_description_aha_url":
      return config.conventions.dpjDescriptionAhaUrl.verified;
    case "aha_description_figma_url":
      return config.conventions.ahaDescriptionFigmaUrl.verified;
    case "aha_custom_field_figma_url":
      return config.conventions.ahaCustomFieldFigmaUrl.verified;
    case "figma_title_aha_ref":
      return config.conventions.figmaTitleAhaRef.verified;
    case "aha_description_mural_url":
      return config.conventions.ahaDescriptionMuralUrl.verified;
    case "aha_custom_field_mural_url":
      return config.conventions.ahaCustomFieldMuralUrl.verified;
    case "mural_title_aha_ref":
      return config.conventions.muralTitleAhaRef.verified;
    case "mural_description_figma_url":
      return config.conventions.muralDescriptionFigmaUrl.verified;
    default:
      return false;
  }
}
