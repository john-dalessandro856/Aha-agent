# Ramirez Phase 4 — implementation checklist

Actionable enablement plan for lifecycle transitions beyond Aha ↔ DPJ.
Normative rules remain in [`ramirez-operating-plan.md`](ramirez-operating-plan.md).
Observed connector status remains in [`ramirez.md`](ramirez.md).

Ramirez is an **individual tool**. The person running the agent is the
operator: they name records, choose which conventions apply for the run,
and decide whether a link is trusted enough to treat as verified identity
or field authority. There is no separate organizational sign-off step.

**Freeze line (do not break while building Phase 4):**

- `MUTATION_MODE = PROPOSAL_ONLY`
- Figma stays IDE-plugin evidence only (no agent MCP / `ask` source)
- Azure DevOps stays operator/IDE-supplied evidence only (no agent MCP adapter)
- GitHub stays operator/IDE-supplied evidence permanently (never bind into
  Ramirez agent MCP / `READ_TOOL_ALLOWLIST`)
- Default Aha ↔ DPJ runs still do not query Figma, Mural, ADO, or GitHub
- Deterministic → metadata → lexical matching order
- No invented connector semantics; DECLARED + SHAPE-OBSERVED minimum

**Delivery order:** Phase 3 config/tool flags → 4a Mural↔Aha → 4b Figma↔Aha →
**4c ADO↔Aha** → **4d GitHub↔Aha** → Aha↔Aha mode (if the operator wants the
engine) → Phase 5 lifecycle stitch (Mural→Figma done; ADO/GitHub hops later).

Observed status in [`ramirez.md`](ramirez.md) updates only when Sprint F/G
implementation lands — not as part of this plan-doc pass.

---

## 0. Phase 3 gates (unblock useful Aha ↔ DPJ before Phase 4)

The operator sets these in config and/or per-run tool input. Until set,
Phase 4 pairs also lack `CONFIRMED` + proposals for most fields.

| # | Item | Operator chooses | Config / code | Done when |
| --- | --- | --- | --- | --- |
| 3.1 | DPJ subject `[AHA-REF]` prefix | Treat as verified identity for this workspace/run | `conventions.dpjSubjectBracketRef.verified = true` (or per-run override) | Operator marks it verified |
| 3.2 | DPJ description `Aha: <url>` line | Verify, leave probable, or disable | `conventions.dpjDescriptionAhaUrl` | Same |
| 3.3 | Status equivalence | Supply Aha↔DPJ status map they trust | `statusMapping` non-null | Status leaves `NOT_COMPARABLE` |
| 3.4 | Field authority | Which system wins per field for proposals | `authority: AuthorityRule[]` | Proposals appear for CONFIRMED + DIFFERENT |
| 3.5 | DPJ Aha-ref custom field | Name the field if they use one | `dpj.ahaReferenceCustomFields` | Gap cleared from `unverifiedReads` |
| 3.6 | Live DPJ search shape | Run one live search while using the tool | Fixture + capability note | `unverifiedReads` no longer claims “not observed” |

Do not treat metadata-only Phase 4 pairs as CONFIRMED. The operator must
enable at least one deterministic convention (3.1, 3.2, or an explicit
URL/ref link) when they want confirmation-grade identity.

---

## 1. Identity conventions (operator-selected)

Each convention needs: **where it lives**, **claimsIdentity yes/no**,
**verified** (operator says this link type is trustworthy for CONFIRM),
**LinkKind / scheme name**. Unverified → max PROBABLE (baseline 85).

Prefer **per-run flags** on the Phase 4 tools (and optional defaults in
`config.ts`) so the operator can trust a convention for one analysis
without editing global config.

### 1A — Aha ↔ Figma (Phase 4b)

| ID | Convention | Where it shows up | Operator meaning when verified | `claimsIdentity` | LinkKind / scheme (proposed) |
| --- | --- | --- | --- | --- | --- |
| F-ID-1 | Full Figma design URL on Aha description | Pasted URLs; not extracted yet | “This URL is the mockup for this record” | yes if verified | `aha_description_figma_url` |
| F-ID-2 | Figma URL in named Aha custom field | Operator names the field | “This field is the design link” | yes if verified | `aha_custom_field_figma_url` |
| F-ID-3 | Aha reference in Figma file/page/frame name | e.g. `VEL-E-3599 — Portfolio` | “Names carry the Aha ref on purpose” | yes if verified | `figma_title_aha_ref` |
| F-ID-4 | Aha reference in Figma comment / description | Weak; easy false positive | Leave as context only | **no** (R-ID-007) | `text_mention` |
| F-ID-5 | Shared product attachment / integration | Only if present | Trust integration id/url | yes if verified | `aha_integration_field` |

**Defaults:** extractors for F-ID-1 and F-ID-3 `enabled: true, verified: false`
(PROBABLE only) until the operator verifies them for the run. Never CONFIRM
from title similarity alone.

**Cardinality (operator choice per run or default):**

- One primary design node per Aha record, extra nodes listed as evidence, or
- Explicit 1:n pairs (needs a mapping rule; plan currently defers 1:n)

### 1B — Mural ↔ Aha (Phase 4a)

| ID | Convention | Where it shows up | Operator meaning when verified | `claimsIdentity` | LinkKind / scheme (proposed) |
| --- | --- | --- | --- | --- | --- |
| M-ID-1 | Mural member URL on Aha description | Pasted URLs | “This board is research for this record” | yes if verified | `aha_description_mural_url` |
| M-ID-2 | Mural URL in named Aha custom field | Operator names the field | “This field is the board link” | yes if verified | `aha_custom_field_mural_url` |
| M-ID-3 | Aha ref in mural title | Title search works | “Board titles carry the Aha ref on purpose” | yes if verified | `mural_title_aha_ref` |
| M-ID-4 | Aha ref on a sticky / area title | Document tree text | Too noisy — keep off identity | **no** by default | evidence excerpt only |
| M-ID-5 | Board ↔ workspace/product map | Optional operator config | Registry is authoritative only if they say so | metadata unless verified map | config map, not link |

**Defaults:** M-ID-1 + M-ID-3 unverified-enabled; sticky text is
`SEMANTIC_INFERENCE` / report context, never identity.

### 1C — Aha ↔ Aha (optional mode)

| ID | Operator choice | Implication |
| --- | --- | --- |
| A-ID-1 | Want structured Aha↔Aha reconcile, or keep using `aha-analysis`? | Skill-only → **no engine work** |
| A-ID-2 | Which pairs: parent/child, siblings, related links, explicit set only? | CandidateSet generation |
| A-ID-3 | When two Aha records conflict, which side wins for proposals? | No authority → discrepancies only |

**Default:** keep soft analysis on `aha-analysis`; add
`reconcile_aha_consistency` only if the operator wants `evidenceRefs` /
`ruleRefs` reproducibility.

### 1D — Mural → Figma (Phase 5)

| ID | Operator choice | If skipped |
| --- | --- | --- |
| MF-1 | Any naming/URL habit linking boards to files? | Lexical only |
| MF-2 | Apply design updates themselves in the IDE | Ramirez still proposes only |
| MF-3 | Include Mural→Figma this round? | Out of Phase 4 |

### 1E — Aha ↔ Azure DevOps (Phase 4c)

| ID | Convention | Where it shows up | Operator meaning when verified | `claimsIdentity` | LinkKind / scheme (proposed) |
| --- | --- | --- | --- | --- | --- |
| ADO-ID-1 | Aha `vsts` integration field (id/url) | Already extracted as `aha_integration_field` | “This ADO work item is the engineering twin” | yes if verified | `aha_integration_field` (ADO target) |
| ADO-ID-2 | `dev.azure.com` / `visualstudio.com` work-item URL on Aha description | Pasted URLs | “This URL is the engineering work item” | yes if verified | `aha_description_ado_url` |
| ADO-ID-3 | Same URL/id in named Aha custom field | Operator names the field | “This field is the ADO link” | yes if verified | `aha_custom_field_ado_url` |
| ADO-ID-4 | Aha reference in ADO work-item title | Supplied evidence `title` | “Titles carry the Aha ref on purpose” | yes if verified | `ado_title_aha_ref` |
| ADO-ID-5 | Aha reference in ADO description / comments | Supplied `description` / note | Leave as context only | **no** (R-ID-007) | `text_mention` |

**Defaults:** ADO-ID-1–4 `enabled: true, verified: false` (PROBABLE only)
until the operator verifies them for the run. Never CONFIRM from title
similarity alone. Aha↔DPJ runs still record `vsts` links as
`NOT_RETRIEVED` and do not evaluate them.

**Cardinality (operator choice per run or default):**

- One primary ADO work item per Aha record, extras as evidence, or
- Explicit 1:n pairs (deferred until a verified mapping rule exists)

### 1F — Aha ↔ GitHub (Phase 4d)

| ID | Convention | Where it shows up | Operator meaning when verified | `claimsIdentity` | LinkKind / scheme (proposed) |
| --- | --- | --- | --- | --- | --- |
| GH-ID-1 | GitHub issue/PR URL on Aha description | Pasted URLs | “This issue/PR implements this record” | yes if verified | `aha_description_github_url` |
| GH-ID-2 | Same in named Aha custom field | Operator names the field | “This field is the GitHub link” | yes if verified | `aha_custom_field_github_url` |
| GH-ID-3 | Aha reference in issue/PR title | Supplied evidence `title` | “Titles carry the Aha ref on purpose” | yes if verified | `github_title_aha_ref` |
| GH-ID-4 | Aha reference in commit message | Supplied commit evidence | Too noisy — keep off identity | **no** by default | evidence excerpt only |
| GH-ID-5 | Branch name containing Aha ref | Supplied branch metadata | Metadata unless operator verifies | metadata unless verified | config / metadata only |

**Defaults:** GH-ID-1–3 `enabled: true, verified: false`; commits/branches
never CONFIRM alone. GitHub is never opened by Ramirez MCP.

---

## 2. Tool schemas

### 2.1 Extend vs split tools

| Option | Pros | Cons | Recommendation |
| --- | --- | --- | --- |
| A. Widen `reconcile_planning` | One report shape | Mixes migration with design/research; harder allowlisting | Avoid for v1 |
| B. New tools per transition | Clear scope; Phase 2 path unchanged | More skills | **Prefer** |
| C. One `reconcile_lifecycle` with `transition` enum | Single entry | Easy to over-query | Acceptable later |

**Prefer (B):**

| Tool | Transition | Who retrieves |
| --- | --- | --- |
| `reconcile_planning` | Aha ↔ DPJ (existing) | Agent MCP |
| `reconcile_mural_planning` | Mural ↔ Aha (optional DPJ later) | Agent MCP (mural + aha) |
| `reconcile_figma_planning` | Figma ↔ Aha | **Caller supplies Figma evidence**; agent reads Aha only |
| `reconcile_ado_planning` | ADO ↔ Aha (Phase 4c) | **Caller supplies ADO evidence**; agent reads Aha only |
| `reconcile_github_planning` | GitHub ↔ Aha (Phase 4d) | **Caller supplies GitHub evidence**; agent reads Aha only |
| `reconcile_aha_consistency` | Aha ↔ Aha (if operator wants it) | Agent MCP (aha) |

### 2.2 `reconcile_mural_planning` (Phase 4a)

```ts
// bot/tools/reconcile_mural_planning.ts — proposed inputSchema
z.object({
  muralIds: z
    .array(z.string().min(3))
    .max(3)
    .optional()
    .describe("Mural ids such as bayer1789.1771356982650"),
  muralUrls: z
    .array(z.string().url())
    .max(3)
    .optional()
    .describe("Member URLs; adapter parses mural_id"),
  ahaReferences: z
    .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/))
    .max(5)
    .optional(),
  expectPlanningCounterpart: z
    .boolean()
    .default(false)
    .describe("True only when user says the board should map to named Aha work"),
  includeStickyExcerpts: z
    .boolean()
    .default(false)
    .describe("If true, get_document_tree for area titles/sticky text as evidence context (not identity)"),
  verifyConventions: z
    .array(z.enum(["aha_description_mural_url", "aha_custom_field_mural_url", "mural_title_aha_ref"]))
    .optional()
    .describe("Operator: treat these link types as verified identity for this run (CONFIRMED-eligible)"),
})
.refine(
  (v) =>
    (v.muralIds?.length ?? 0) + (v.muralUrls?.length ?? 0) + (v.ahaReferences?.length ?? 0) > 0,
  "name at least one mural or Aha reference",
);
```

**Retrieval allowlist (already mostly present):**

- Mural: `search_murals`, `get_mural_info`, `get_canvas_overview`,
  `get_document_tree` (when `includeStickyExcerpts`), not writes
- Aha: `read_records`, `search_records` only via existing planning adapter

**Wire-up:**

1. Resolve mural id from URL if needed
2. `createMuralMcpAdapter` → board artifact
3. Optional document_tree → evidence excerpts on the artifact description/tags
4. Parse Aha links from mural title (M-ID-3); parse mural URLs from Aha (M-ID-1)
5. Run pair logic (reuse score/rules; new pair builder)
6. `renderReport` with transition-specific limitations

**Skill:** `bot/skills/ramirez-mural-planning.md` — require named mural or Aha
ref; present `report`; do not call Figma/ADO/GitHub.

### 2.3 `reconcile_figma_planning` (Phase 4b)

Figma is never opened by the agent. The **host chat** (or a thin wrapper)
reads Figma via the IDE plugin, then passes normalized evidence.

```ts
// bot/tools/reconcile_figma_planning.ts — proposed inputSchema
const figmaEvidence = z.object({
  fileKey: z.string().min(10),
  fileName: z.string().optional(),
  nodeId: z.string().optional().describe("e.g. 2588:718438"),
  nodeName: z.string().optional(),
  pages: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  url: z.string().url().optional(),
  note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
  retrievedAt: z.string().datetime().optional(),
});

z.object({
  ahaReferences: z
    .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/))
    .max(5),
  figma: z.array(figmaEvidence).min(1).max(5),
  expectDesignCounterpart: z.boolean().default(true),
  verifyConventions: z
    .array(z.enum(["aha_description_figma_url", "aha_custom_field_figma_url", "figma_title_aha_ref"]))
    .optional()
    .describe("Operator: treat these link types as verified identity for this run"),
});
```

**Execution:**

1. Skill/instructions: IDE `create_session` → `get_metadata` (and optional
   `get_screenshot` for human context only) → fill `figma[]`
2. Tool: `normalizeFigmaNode` each entry → Artifact `AVAILABLE`
3. Aha adapter: `read_records` for refs; extract Figma URLs from description /
   custom fields (new normalizer paths)
4. Match + align + report
5. Limitations always include: “Figma was not queried by Ramirez; evidence was
   supplied by the operator/IDE”

**Do not:** bind Figma MCP into agent connections; add Figma to `ask` sources;
treat screenshot OCR as identity.

### 2.4 `reconcile_ado_planning` (Phase 4c)

Azure DevOps is never opened by the agent. The **host chat** (or operator)
supplies work-item evidence; Ramirez normalizes and pairs with Aha.

```ts
// bot/tools/reconcile_ado_planning.ts — proposed inputSchema
const adoEvidence = z.object({
  org: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  workItemId: z.string().min(1),
  title: z.string().optional(),
  state: z.string().optional(),
  url: z.string().url().optional(),
  description: z.string().max(4000).optional(),
  note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
  assignedTo: z.string().optional(),
  iteration: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});

z.object({
  ahaReferences: z
    .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/))
    .max(5)
    .optional(),
  ado: z.array(adoEvidence).min(1).max(5),
  expectEngineeringCounterpart: z.boolean().default(true),
  verifyConventions: z
    .array(
      z.enum([
        "aha_integration_field",
        "aha_description_ado_url",
        "aha_custom_field_ado_url",
        "ado_title_aha_ref",
      ]),
    )
    .optional()
    .describe("Operator: treat these link types as verified identity for this run"),
})
.refine(
  (v) => (v.ahaReferences?.length ?? 0) > 0 || (v.ado?.length ?? 0) > 0,
  "name at least one Aha reference or supply ADO evidence",
);
```

**Execution:**

1. Skill/instructions: operator or IDE gathers work-item metadata → fill `ado[]`
2. Tool: `normalizeAdoWorkItem` each entry → Artifact `AVAILABLE`
3. Aha adapter: `read_records` for refs; match `vsts` integration links
   (ADO-ID-1) and extract ADO URLs from description / custom fields
4. Match + align + report
5. Limitations always include: “ADO was not queried by Ramirez; evidence was
   supplied by the operator/IDE.”

**Do not:** invent an Azure DevOps MCP/REST adapter for coverage; add ADO to
`ask` sources; call ADO from default Aha↔DPJ reconciliation.

### 2.5 `reconcile_github_planning` (Phase 4d)

GitHub is never opened by Ramirez. Operator/IDE supplies issue/PR/commit
evidence permanently — do not bind the GitHub IDE plugin into agent MCP.

```ts
// bot/tools/reconcile_github_planning.ts — proposed inputSchema
const githubEvidence = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  kind: z.enum(["issue", "pr", "commit"]),
  number: z.number().int().positive().optional().describe("Issue or PR number"),
  sha: z.string().min(7).optional().describe("Commit SHA when kind=commit"),
  title: z.string().optional(),
  state: z.string().optional(),
  url: z.string().url().optional(),
  body: z.string().max(4000).optional(),
  note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
  branch: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});

z.object({
  ahaReferences: z
    .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/))
    .max(5)
    .optional(),
  github: z.array(githubEvidence).min(1).max(5),
  expectImplementationCounterpart: z.boolean().default(true),
  verifyConventions: z
    .array(
      z.enum([
        "aha_description_github_url",
        "aha_custom_field_github_url",
        "github_title_aha_ref",
      ]),
    )
    .optional()
    .describe("Operator: treat these link types as verified identity for this run"),
})
.refine(
  (v) => (v.ahaReferences?.length ?? 0) > 0 || (v.github?.length ?? 0) > 0,
  "name at least one Aha reference or supply GitHub evidence",
);
```

**Execution:**

1. Skill/instructions: operator/IDE gathers issue/PR/commit metadata → fill `github[]`
2. Tool: `normalizeGithubArtifact` each entry → Artifact `AVAILABLE`
3. Aha adapter: `read_records`; extract github.com URLs from description /
   custom fields
4. Match + align + report
5. Limitations always include: “GitHub was not queried by Ramirez; evidence was
   supplied by the operator/IDE.”

**Do not:** add GitHub to `READ_TOOL_ALLOWLIST` or agent MCP connections;
treat commit-message / branch refs as identity by default; query GitHub
from Aha↔DPJ or other Phase 4 paths.

### 2.6 `reconcile_aha_consistency` (only if A-ID-1 = engine)

```ts
z.object({
  ahaReferences: z.array(z.string().regex(...)).min(2).max(8),
  mode: z.enum(["linked_only", "siblings_under_parent", "explicit_set"]).default("explicit_set"),
});
```

Pairs only among supplied / discovered Aha artifacts. No DPJ/Mural/Figma/ADO/GitHub.

### 2.7 Config extensions (`bot/lib/ramirez/config.ts`)

```ts
conventions: {
  // existing dpj / figma / mural…
  ahaDescriptionFigmaUrl: { enabled: boolean; verified: boolean; source: string };
  ahaCustomFieldFigmaUrl: { enabled: boolean; verified: boolean; fieldNames: string[]; source: string };
  figmaTitleAhaRef: { enabled: boolean; verified: boolean; source: string };
  ahaDescriptionMuralUrl: { enabled: boolean; verified: boolean; source: string };
  ahaCustomFieldMuralUrl: { enabled: boolean; verified: boolean; fieldNames: string[]; source: string };
  muralTitleAhaRef: { enabled: boolean; verified: boolean; source: string };
  // Phase 4c / 4d
  ahaDescriptionAdoUrl: { enabled: boolean; verified: boolean; source: string };
  ahaCustomFieldAdoUrl: { enabled: boolean; verified: boolean; fieldNames: string[]; source: string };
  adoTitleAhaRef: { enabled: boolean; verified: boolean; source: string };
  ahaDescriptionGithubUrl: { enabled: boolean; verified: boolean; source: string };
  ahaCustomFieldGithubUrl: { enabled: boolean; verified: boolean; fieldNames: string[]; source: string };
  githubTitleAhaRef: { enabled: boolean; verified: boolean; source: string };
};
```

Defaults: enabled mirrors today’s DPJ pattern; **verified: false** until
the operator verifies that convention for the run (tool flag) or in their
local config. Existing `aha_integration_field` for `vsts` remains the
ADO-ID-1 path (no separate convention flag required beyond verifying that
link kind when supplied).

### 2.8 Adapter / type work

| File | Change |
| --- | --- |
| `types.ts` `LinkKind` | Add mural/figma kinds from §1; add `aha_description_ado_url`, `aha_custom_field_ado_url`, `ado_title_aha_ref`, `aha_description_github_url`, `aha_custom_field_github_url`, `github_title_aha_ref` |
| `types.ts` `DiscrepancyKind` | Add kinds from §3 (design/research + engineering/implementation) |
| `adapters/aha.ts` | Extract figma.com + mural.co + ADO + github.com URLs; optional custom fields; keep `vsts` → azure_devops |
| `adapters/mural.ts` | Parse Aha refs from title; optional sticky excerpt helper |
| `adapters/figma.ts` | Parse Aha refs from `nodeName` / `fileName` when convention enabled |
| `adapters/ado.ts` (new) | `normalizeAdoWorkItem` / `parseAdoUrls` — interface only |
| `adapters/github.ts` (new) | `normalizeGithubArtifact` / `parseGithubUrls` — interface only |
| `retrieval.ts` | URL→mural id helper; keep Figma/ADO/GitHub out of MCP adapters |
| `reconcile-mural.ts` / `reconcile-figma.ts` / `reconcile-ado.ts` / `reconcile-github.ts` | Pair builders; do not overload Aha↔DPJ `reconcile.ts` forever |
| `rules.ts` | New rule ids `R-LF-*` (lifecycle) citing identity/alignment for design/research/engineering/implementation |
| `report.ts` | Transition label in executive summary |
| `capabilities.ts` | Notes only; no Figma/ADO/GitHub allowlist entries |

---

## 3. Discrepancy kinds and severity

Reuse existing kinds where the semantics match. Add only what Phase 4 needs.

### 3.1 Reuse as-is

| Kind | Phase 4 use |
| --- | --- |
| `TITLE_CONFLICT` | Aha title vs Figma frame/page name; Aha vs mural title; Aha vs ADO/GitHub title |
| `DESCRIPTION_CONFLICT` | Aha description vs mural theme summary / Figma note / ADO or GitHub body note |
| `SCOPE_DRIFT` | Low lexical overlap after identity stripped |
| `DUPLICATE_MAPPING` / `AMBIGUOUS_MAPPING` / `CONFLICTING_MAPPING` | Multiple design, board, ADO, or GitHub candidates |
| `MISSING_LINK` | Expected counterpart with searchable channels + no candidate (strict) |
| `POTENTIAL_BROKEN_LINK` | Explicit Figma/Mural/ADO/GitHub URL on Aha that does not match supplied evidence |
| `POTENTIAL_MIGRATION_OMISSION` | Prefer **not** for design/research/engineering; use new kinds below |
| `UNSUPPORTED_COMPLETION_CLAIM` | Aha/ADO marked done but open PR / no merge evidence (when GitHub evidence supports) |

### 3.2 New kinds (proposed)

| Kind | When | Severity | Authority default |
| --- | --- | --- | --- |
| `DESIGN_PLANNING_MISMATCH` | CONFIRMED/PROBABLE Aha↔Figma pair; material scope/title/description disagree | HIGH if scope; MEDIUM if label-only | UNKNOWN until the operator sets Figma vs Aha authority |
| `RESEARCH_ABSENT_FROM_PLANNING` | Mural theme/area expected in Aha; no planning candidate after search | MEDIUM (or HIGH if user set `expectPlanningCounterpart`) | UNKNOWN — proposal only with authority |
| `PLANNING_ABSENT_FROM_DESIGN` | Aha in scope; expected design node missing / not supplied | MEDIUM | N/A for Figma create unless IDE path later |
| `STALE_DESIGN_LINK` | Aha Figma URL resolves to different file than title/convention claims | HIGH | Prefer explicit URL if verified |
| `ORPHAN_DESIGN_EVIDENCE` | Figma evidence supplied with no Aha candidate and expectation true | MEDIUM | — |
| `ORPHAN_RESEARCH_EVIDENCE` | Mural board with no Aha candidate and expectation true | MEDIUM | — |
| `INTRA_AHA_CONTRADICTION` | Two Aha records CONFIRMED-related; conflicting scope/requirements | HIGH | Per A-ID-3 |
| `INTRA_AHA_DUPLICATE` | Two Aha records likely same work (metadata) | MEDIUM | — |
| `ENGINEERING_PLANNING_MISMATCH` | CONFIRMED/PROBABLE Aha↔ADO; title/scope/state disagree | HIGH if scope; MEDIUM if label-only | UNKNOWN until operator sets ADO vs Aha authority |
| `PLANNING_ABSENT_FROM_ENGINEERING` | Aha in scope; expected ADO work item missing / not supplied | MEDIUM | N/A for ADO create |
| `ORPHAN_ENGINEERING_EVIDENCE` | ADO evidence with no Aha candidate and expectation true | MEDIUM | — |
| `STALE_ADO_LINK` | Aha ADO URL/id ≠ supplied work item | HIGH | Prefer explicit URL/integration id if verified |
| `IMPLEMENTATION_PLANNING_MISMATCH` | CONFIRMED/PROBABLE Aha↔GitHub; material title/scope/state disagree | HIGH if scope; MEDIUM if label-only | UNKNOWN until operator sets GitHub vs Aha authority |
| `PLANNING_ABSENT_FROM_IMPLEMENTATION` | Aha in scope; expected issue/PR missing / not supplied | MEDIUM | N/A for GitHub create |
| `ORPHAN_IMPLEMENTATION_EVIDENCE` | GitHub evidence with no Aha candidate and expectation true | MEDIUM | — |

Wire each kind to a **named rule** (`R-LF-001` …) in `rules.ts`. Severity is
rule-mediated, not model-judged (operating plan).

### 3.3 Alignment fields by transition

| Transition | Compare | Skip / NOT_COMPARABLE |
| --- | --- | --- |
| Mural ↔ Aha | title; optional description vs area/sticky excerpt aggregate | status, owner, dates, hierarchy (unless config says otherwise) |
| Figma ↔ Aha | title (frame/page vs Aha name); description vs `note`/page list | Figma has no Aha status/owner — do not invent |
| ADO ↔ Aha | title; optional description/note; state vs Aha status when operator supplies a status map | owner/hierarchy equivalence — do not invent |
| GitHub ↔ Aha | title (issue/PR vs Aha name); optional body/note; state when comparable | commit/branch alone; inventing merge policy |
| Aha ↔ Aha | title, description, owner, dates, status, hierarchy, type | release quirks per workspace conventions in instructions |

### 3.4 Proposal policy (Phase 4)

| Proposal target | Allowed under PROPOSAL_ONLY? | Requires |
| --- | --- | --- |
| Aha field text from Figma/Mural/ADO/GitHub | Propose only | CONFIRMED + authority rule |
| DPJ from Aha (existing) | Propose only | Existing R-PROP-* |
| Create Figma nodes / edit mural | **Never via Ramirez** | IDE plugin / humans |
| Create/update ADO work items | **Never via Ramirez** | Humans / other tools |
| Create/update GitHub issues/PRs | **Never via Ramirez** | Humans / other tools |
| Add link field on Aha | Propose URL string only | Authority + CONFIRMED |

Always keep: `No changes have been applied. Ramirez is operating in PROPOSAL_ONLY mode.`

---

## 4. Implementation checklist (engineering)

### Sprint A — Foundations (operator flags + extractors)

- [x] Per-run `withVerifiedConventions` helper; defaults in `config.ts` (tool `verifyConventions` on 4a/4b still pending)
- [x] Note operator-driven model in `docs/ramirez.md`
- [x] Extend `LinkKind` + Aha URL extractors (figma.com, app.mural.co) via `links.ts`
- [x] Extend mural/figma normalizers for Aha-ref-in-title when enabled
- [x] Add discrepancy kinds + `LIFECYCLE_DISCREPANCY` + `R-LF-*` rules
- [x] Unit tests: URL parse, link extraction, title refs, `withVerifiedConventions`
- [x] Existing Product-Profiles / MMC fixtures continue to cover normalize paths

### Sprint B — Phase 4a Mural ↔ Aha

- [x] `reconcile_mural_planning` tool + skill
- [x] Pair engine module (`reconcile-mural.ts`)
- [x] Emit `RESEARCH_ABSENT_FROM_PLANNING` / `ORPHAN_RESEARCH_EVIDENCE` under expectation rules
- [x] Report limitations: sticky content not identity; DPJ/Figma not queried on this path
- [x] Mocked tests: mural URL on Aha → PROBABLE/CONFIRMED; stickies non-identity
- [x] Update `docs/ramirez.md` observed status only (not the operating plan)

### Sprint C — Phase 4b Figma ↔ Aha

- [x] `reconcile_figma_planning` tool + skill (IDE evidence handoff documented)
- [x] Instructions: when user asks Figma vs Aha, use IDE Figma plugin then this tool
- [x] Pair engine: fileKey/nodeId vs Aha links; title conventions (`reconcile-figma.ts`)
- [x] Emit `DESIGN_PLANNING_MISMATCH`, `PLANNING_ABSENT_FROM_DESIGN`, `STALE_DESIGN_LINK`, `ORPHAN_DESIGN_EVIDENCE`
- [x] Tests with `normalizeFigmaNode` fixtures; never mock a Figma MCP connection
- [x] AGENTS.md / `ask` still exclude Figma as a source (unchanged)

### Sprint D — Aha ↔ Aha (optional)

- [ ] Operator chooses A-ID-1 (engine vs `aha-analysis`)
- [ ] If engine: tool + sibling/linked candidate discovery + `INTRA_AHA_*` kinds
- [ ] If skill-only: document that in instructions; no engine work

### Sprint E — Phase 5 lifecycle (research ↔ design)

- [x] `reconcile_lifecycle` tool + `ramirez-lifecycle` skill
- [x] Independent mural↔Aha and Figma↔Aha hops merged with remapped ids
- [x] Lifecycle paths when the same Aha is in both hops (`R-LF-011`)
- [x] Direct mural↔Figma via `mural_description_figma_url` + title metadata
- [x] `RESEARCH_DESIGN_MISMATCH` for material mural↔Figma description drift
- [x] Operator `verifyConventions` includes `mural_description_figma_url`
- [x] Report section **Lifecycle paths**; tests for stitch + confirmed mural→Figma
- [ ] Later: optional ADO/GitHub hops in lifecycle stitch (after Sprint F/G)

### Sprint F — Phase 4c ADO ↔ Aha

- [ ] `parseAdoUrls` + `normalizeAdoWorkItem` (`adapters/ado.ts` / `links.ts`)
- [ ] Extend Aha extractors for description/custom-field ADO URLs; keep `vsts`
- [ ] LinkKinds + conventions + `withVerifiedConventions` for ADO-ID-*
- [ ] `reconcile_ado_planning` tool + `ramirez-ado-planning` skill
- [ ] Pair engine (`reconcile-ado.ts`)
- [ ] Emit `ENGINEERING_PLANNING_MISMATCH`, `PLANNING_ABSENT_FROM_ENGINEERING`,
      `ORPHAN_ENGINEERING_EVIDENCE`, `STALE_ADO_LINK`
- [ ] Tests with fixtures only — never mock an ADO MCP connection
- [ ] Update `docs/ramirez.md` observed status only when this sprint ships

### Sprint G — Phase 4d GitHub ↔ Aha

- [ ] `parseGithubUrls` + `normalizeGithubArtifact` (`adapters/github.ts` / `links.ts`)
- [ ] Extend Aha extractors for github.com issue/PR URLs
- [ ] LinkKinds + conventions + `withVerifiedConventions` for GH-ID-*
- [ ] `reconcile_github_planning` tool + `ramirez-github-planning` skill
- [ ] Pair engine (`reconcile-github.ts`)
- [ ] Emit `IMPLEMENTATION_PLANNING_MISMATCH`,
      `PLANNING_ABSENT_FROM_IMPLEMENTATION`, `ORPHAN_IMPLEMENTATION_EVIDENCE`;
      reuse `UNSUPPORTED_COMPLETION_CLAIM` when evidence supports
- [ ] Tests with fixtures; assert GitHub never on `READ_TOOL_ALLOWLIST`
- [ ] Update `docs/ramirez.md` observed status only when this sprint ships

---

## 5. Test matrix (minimum)

| Case | Expect |
| --- | --- |
| Aha description has Figma URL; matching `fileKey` in evidence | Deterministic link; PROBABLE until verified |
| Aha Figma URL; supplied evidence different fileKey | CONTRADICTORY or `STALE_DESIGN_LINK` |
| Figma evidence only; `expectDesignCounterpart` true; no Aha hit | `ORPHAN_DESIGN_EVIDENCE` / NOT_EVALUATED — not MISSING unless criteria met |
| Mural title contains Aha ref; Aha reads OK | Convention path; score per verified |
| Sticky text mentions Aha ref | Not identity (`R-ID-007`) |
| Aha `vsts` id matches supplied ADO `workItemId` | Deterministic; PROBABLE until verified |
| Aha ADO URL; supplied evidence different work-item id | CONTRADICTORY or `STALE_ADO_LINK` |
| ADO evidence only; `expectEngineeringCounterpart` true; no Aha hit | `ORPHAN_ENGINEERING_EVIDENCE` / NOT_EVALUATED |
| Aha description has GitHub PR URL; matching owner/repo/number | Deterministic; PROBABLE until verified |
| Commit message mentions Aha ref | Not identity by default |
| Aha↔DPJ `reconcile_planning` unchanged | Still lists Figma/Mural/ADO/GitHub as not queried |
| Any write-shaped mural/figma tool name | `MutationBlockedError` / not called |
| GitHub/ADO tool name on MCP allowlist | Must remain absent |
| Proposal without authority | Discrepancy only, `proposals: []` |

Core tests stay credential-free (mocked adapters / fixtures).

---

## 6. Definition of done — Phase 4a / 4b / 4c / 4d

Phase 4a **done** when:

- Named mural + optional Aha refs produce a structured report with
  relationship, alignment, discrepancies, limitations
- Identity never confirmed from stickies alone
- Mocked tests cover deterministic mural URL and title-ref paths
- `docs/ramirez.md` states LIVE/SHAPE status honestly

Phase 4b **done** when:

- Operator-supplied Figma evidence + Aha refs produce the same report shape
- Ramirez process never opens Figma MCP
- Design/planning mismatch kinds emit with rule refs
- Product-Profiles-style fixture passes offline

Phase 4c **done** when:

- Operator-supplied ADO evidence + Aha refs produce the same report shape
- Ramirez never opens an Azure DevOps connector
- Engineering/planning mismatch and stale-ADO kinds emit with rule refs
- Fixture tests cover `vsts` + description URL paths offline
- `docs/ramirez.md` updated for observed ADO interface status

Phase 4d **done** when:

- Operator-supplied GitHub evidence + Aha refs produce the same report shape
- Ramirez never binds GitHub into agent MCP / allowlist
- Implementation/planning mismatch kinds emit with rule refs
- Commit/branch refs do not confirm identity by default
- `docs/ramirez.md` updated for observed GitHub interface status

Phase 4a/4b are implemented. Phase 4c/4d are planned here and trail until
Sprint F/G land. Full Phase 4 is complete only when 4c and 4d DoD above are
met (Aha↔Aha optional remains operator-gated).

---

## 7. Operator choices (per run or local defaults)

The person running the agent sets these when they call the tool (or once in
their config):

1. Which of F-ID-1…F-ID-3 / M-ID-1…M-ID-3 / ADO-ID-1…ADO-ID-4 / GH-ID-1…GH-ID-3
   are **enabled** and **verified** for this run.
2. Aha↔Figma cardinality: one primary node, or 1:n pairs.
3. Field authority: on design vs planning conflicts, does Aha or Figma win
   for title / description (only needed if they want proposals).
4. Research vs planning: Mural as authority on any field, or only flag
   `RESEARCH_ABSENT_FROM_PLANNING`.
5. Aha↔Aha: use the engine tool, or stick to `aha-analysis`.
6. Whether Mural→Figma is in scope yet.
7. Expect engineering counterpart (`expectEngineeringCounterpart`) and which
   ADO conventions are verified; Aha vs ADO authority if proposals wanted.
8. Expect implementation counterpart (`expectImplementationCounterpart`) and
   which GitHub conventions are verified; Aha vs GitHub authority if proposals
   wanted.
9. Whether Phase 5 lifecycle stitch should include ADO/GitHub hops later.

**Ship defaults:** extractors on, `verified: false`, conservative
`expect*Counterpart` / `NOT_EVALUATED` / MEDIUM orphan findings — never
silent CONFIRM + propose until the operator verifies the convention.
