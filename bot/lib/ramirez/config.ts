import type { SystemId } from "./types";

export type AuthorityRule = {
  field: string;
  authoritativeSystem: SystemId;
  targetSystem: SystemId;
  basis: string;
};

export type RamirezConfig = {
  aha: { baseUrl: string };
  dpj: { baseUrl: string; ahaReferenceCustomFields: string[] };
  /**
   * DPJ↔Aha identity conventions. `verified` stays false until a migration
   * owner confirms the convention; unverified links cap at PROBABLE.
   */
  conventions: {
    dpjSubjectBracketRef: { enabled: boolean; verified: boolean; source: string };
    dpjDescriptionAhaUrl: { enabled: boolean; verified: boolean; source: string };
  };
  /** Aha status category or name → shared bucket. Null: status equivalence unknown. */
  statusMapping: { aha: Record<string, string>; dpj: Record<string, string>; completeBuckets: string[] } | null;
  /** Aha record type → DPJ type name. */
  typeEquivalence: Record<string, string>;
  authority: AuthorityRule[];
  metadataSearchLimit: number;
  semanticFallback: boolean;
};

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
  },
  statusMapping: null,
  typeEquivalence: { epic: "epic", master_feature: "epic", feature: "feature", initiative: "initiative" },
  authority: [],
  metadataSearchLimit: 5,
  semanticFallback: true,
};

export function withConfig(overrides: Partial<RamirezConfig> = {}): RamirezConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    aha: { ...DEFAULT_CONFIG.aha, ...overrides.aha },
    dpj: { ...DEFAULT_CONFIG.dpj, ...overrides.dpj },
    conventions: { ...DEFAULT_CONFIG.conventions, ...overrides.conventions },
  };
}
