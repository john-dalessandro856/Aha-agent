import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_CHANNELS, FULL_CHANNELS, NOW, aha, config, dpj, fake, type FakeAdapter } from "./fixtures";
import { reconcile, type ReconcileInput } from "./reconcile";
import type { RamirezConfig } from "./config";
import { RetrievalSession } from "./retrieval";
import type { Artifact, RelationshipAssessment, RetrievalState } from "./types";
import { MUTATION_MODE } from "./types";

type DpjFakeOpts = Partial<{
  channels: Parameters<typeof fake>[0]["channels"];
  identifierHits: Artifact[];
  identifierState: RetrievalState;
  identifierTruncated: boolean;
  titleHits: Artifact[];
  titleState: RetrievalState;
  getByIdState: Record<string, RetrievalState>;
}>;

type Setup = {
  aha: Artifact[];
  ahaRefs: string[];
  dpjRecords?: Artifact[];
  dpj?: DpjFakeOpts;
  cfg?: RamirezConfig;
  expect?: boolean;
  dpjIds?: string[];
};

async function run(s: Setup) {
  const cfg = s.cfg ?? config();
  const ahaAdapter = fake({ system: "aha", records: s.aha });
  const dpjAdapter: FakeAdapter = fake({ system: "dpj", records: s.dpjRecords ?? [], channels: DEFAULT_CHANNELS, ...(s.dpj ?? {}) });
  const input: ReconcileInput = { ahaRefs: s.ahaRefs, dpjIds: s.dpjIds ?? [], expectDpjCounterpart: s.expect ?? true };
  const result = await reconcile(input, {
    aha: ahaAdapter,
    dpj: dpjAdapter,
    session: new RetrievalSession(() => NOW),
    config: cfg,
    now: () => NOW,
  });
  return { result, ahaAdapter, dpjAdapter };
}

const toDpj = (key: string) => `dpj:${key}`;
const relTo = (rels: RelationshipAssessment[], target: string) => rels.filter((r) => r.target === target);
const DPJ_URL = (id: string) => `https://dpj.int.bayer.com/work_packages/${id}`;

describe("deterministic identity", () => {
  test("explicit link on both records confirms identity at baseline 92 by R-ID-001", async () => {
    const a = aha({ ref: "VEL-E-1", title: "Program epic", description: `See ${DPJ_URL("101")}` });
    const d = dpj({ id: "101", subject: "[VEL-E-1] Program epic", description: "Aha: https://bayer.aha.io/epics/VEL-E-1" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-1"], dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.ok(rel, "relationship exists");
    assert.equal(rel.status, "CONFIRMED");
    assert.equal(rel.method, "DETERMINISTIC");
    assert.equal(rel.score, 92);
    assert.ok(rel.ruleRefs.includes("R-ID-001"));
    assert.ok(rel.evidenceRefs.length >= 2, "both directions cited as evidence");
  });

  test("one-directional explicit link stays PROBABLE at 85 (R-ID-003), never CONFIRMED", async () => {
    const a = aha({ ref: "VEL-E-2", title: "Other epic", description: `Tracked in ${DPJ_URL("102")}` });
    const d = dpj({ id: "102", subject: "Unlabelled subject" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-2"], dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.status, "PROBABLE");
    assert.equal(rel.score, 85);
    assert.ok(rel.ruleRefs.includes("R-ID-003"));
  });

  test("unverified subject convention caps the link at PROBABLE 85", async () => {
    const a = aha({ ref: "VEL-E-3", title: "Convention epic" });
    const d = dpj({ id: "103", subject: "[VEL-E-3] Convention epic" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-3"], dpj: { identifierHits: [d] }, dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.status, "PROBABLE");
    assert.equal(rel.score, 85);
  });

  test("verified subject convention confirms identity at 92", async () => {
    const a = aha({ ref: "VEL-E-4", title: "Verified epic" });
    const d = dpj({ id: "104", subject: "[VEL-E-4] Verified epic" });
    const cfg = config({ conventions: { dpjSubjectBracketRef: { enabled: true, verified: true, source: "test" }, dpjDescriptionAhaUrl: { enabled: true, verified: false, source: "test" } } });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-4"], dpj: { identifierHits: [d] }, dpjRecords: [d], cfg });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.status, "CONFIRMED");
    assert.equal(rel.score, 92);
  });

  test("explicit link that does not resolve raises POTENTIAL_BROKEN_LINK and confirms nothing", async () => {
    const a = aha({ ref: "VEL-E-5", title: "Broken", description: DPJ_URL("999") });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-5"], dpj: { getByIdState: {} } });
    assert.ok(result.discrepancies.some((d) => d.kind === "POTENTIAL_BROKEN_LINK"));
    assert.equal(result.relationships.filter((r) => r.status === "CONFIRMED" || r.status === "PROBABLE").length, 0);
  });

  test("an inaccessible explicit target is a limitation, not a broken link", async () => {
    const a = aha({ ref: "VEL-E-6", title: "Blocked", description: DPJ_URL("998") });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-6"], dpj: { getByIdState: { "998": "INACCESSIBLE" } }, expect: false });
    assert.equal(result.discrepancies.filter((d) => d.kind === "POTENTIAL_BROKEN_LINK").length, 0);
    assert.ok(result.limitations.some((l) => l.includes("INACCESSIBLE")));
  });

  test("a DPJ record that names a different Aha reference is CONTRADICTORY, not averaged", async () => {
    const a = aha({ ref: "VEL-E-7", title: "Contra", description: `${DPJ_URL("701")} ${DPJ_URL("702")}` });
    const d1 = dpj({ id: "701", subject: "Plain" });
    const d2 = dpj({ id: "702", subject: "[VEL-E-7] Contra" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-7"], dpjRecords: [d1, d2] });
    const contra = relTo(result.relationships, d2.key)[0];
    assert.equal(contra.status, "CONTRADICTORY");
    assert.equal(contra.score, null);
    assert.ok(contra.ruleRefs.includes("R-ID-004"));
    assert.equal(relTo(result.relationships, d1.key)[0].status, "PROBABLE");
    assert.equal(result.relationships.filter((r) => r.status === "CONFIRMED").length, 0);
  });

  test("two deterministic identity claims make each pair AMBIGUOUS and report DUPLICATE_MAPPING", async () => {
    const a = aha({ ref: "VEL-E-8", title: "Dup" });
    const d1 = dpj({ id: "801", subject: "[VEL-E-8] Dup" });
    const d2 = dpj({ id: "802", subject: "[VEL-E-8] Dup copy" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-8"], dpj: { identifierHits: [d1, d2] }, dpjRecords: [d1, d2] });
    assert.equal(relTo(result.relationships, d1.key)[0].status, "AMBIGUOUS");
    assert.equal(relTo(result.relationships, d2.key)[0].status, "AMBIGUOUS");
    assert.ok(result.discrepancies.some((d) => d.kind === "DUPLICATE_MAPPING"));
  });

  test("candidate discovery is recorded but does not establish a relationship", async () => {
    const a = aha({ ref: "VEL-E-9", title: "Mentioned" });
    const mention = dpj({ id: "901", subject: "Unrelated work", description: "Follow-up to VEL-E-9 discussion" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-9"], dpj: { identifierHits: [mention] }, dpjRecords: [mention] });
    assert.ok(result.candidateSets[0].candidates.includes(toDpj("901")));
    assert.ok(!result.relationships.some((r) => r.target === mention.key && (r.status === "CONFIRMED" || r.status === "PROBABLE")));
  });
});

describe("metadata and semantic fallback", () => {
  test("metadata fallback never confirms: exact title plus two corroborations is PROBABLE 80", async () => {
    const a = aha({ ref: "VEL-E-10", title: "Program epic", owner: "Alex Owner", start: "2026-01-01" });
    const d = dpj({ id: "1001", subject: "Program epic", owner: "Alex Owner", start: "2026-01-01" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-10"], dpj: { titleHits: [d] }, dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.method, "METADATA");
    assert.equal(rel.status, "PROBABLE");
    assert.equal(rel.score, 80);
    assert.ok(rel.ruleRefs.includes("R-MD-001"));
  });

  test("title-only evidence is capped at 49 and stays POSSIBLE", async () => {
    const cfg = config({ typeEquivalence: {} });
    const a = aha({ ref: "VEL-E-11", title: "Title only", owner: "Alex Owner" });
    const d = dpj({ id: "1101", subject: "Title only", owner: "Someone Else" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-11"], dpj: { titleHits: [d] }, dpjRecords: [d], cfg });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.status, "POSSIBLE");
    assert.equal(rel.score, 49);
    assert.ok(rel.scoreBasis.capsApplied.some((c) => c.includes("title-only")));
  });

  test("shared keywords alone are capped at 39", async () => {
    const a = aha({ ref: "VEL-E-12", title: "Data integration platform for planning" });
    const d = dpj({ id: "1201", subject: "Data integration reporting for finance" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-12"], dpj: { titleHits: [d] }, dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.ok(rel.score !== null && rel.score <= 39, `score ${rel.score}`);
    assert.notEqual(rel.status, "PROBABLE");
    assert.notEqual(rel.status, "CONFIRMED");
  });

  test("multiple high-scoring metadata candidates within 10 points are AMBIGUOUS with score cap 60", async () => {
    const a = aha({ ref: "VEL-E-13", title: "Program epic", owner: "Alex Owner", start: "2026-01-01" });
    const d1 = dpj({ id: "1301", subject: "Program epic", owner: "Alex Owner", start: "2026-01-01" });
    const d2 = dpj({ id: "1302", subject: "Program epic", owner: "Alex Owner", start: "2026-01-01" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-13"], dpj: { titleHits: [d1, d2] }, dpjRecords: [d1, d2] });
    for (const d of [d1, d2]) {
      const [rel] = relTo(result.relationships, d.key);
      assert.equal(rel.status, "AMBIGUOUS");
      assert.ok(rel.score !== null && rel.score <= 60);
      assert.ok(rel.ruleRefs.includes("R-MD-005"));
    }
  });

  test("semantic fallback runs only when metadata is unresolved, is capped, and never confirms", async () => {
    const a = aha({ ref: "VEL-E-14", title: "Partner onboarding automation", description: "partners onboarding automation workflow approvals documents signatures" });
    const d = dpj({ id: "1401", subject: "Workflow approvals", description: "partners onboarding automation workflow approvals documents signatures" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-14"], dpj: { titleHits: [d] }, dpjRecords: [d] });
    const [rel] = relTo(result.relationships, d.key);
    assert.equal(rel.method, "SEMANTIC");
    assert.equal(rel.status, "POSSIBLE");
    assert.ok(rel.score !== null && rel.score <= 74);
    assert.ok(rel.score !== null && rel.score <= 39);
  });
});

describe("alignment is evaluated independently of identity", () => {
  test("confirmed identity with contradictory description reports CONFIRMED and CONTRADICTORY alignment", async () => {
    const a = aha({ ref: "VEL-E-20", title: "SSO login", description: `Partner SSO login with audit trail. ${DPJ_URL("2001")}` });
    const d = dpj({ id: "2001", subject: "[VEL-E-20] SSO login", description: "Aha: https://bayer.aha.io/epics/VEL-E-20\nPayments reconciliation for finance close only." });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-20"], dpjRecords: [d] });
    const rel = relTo(result.relationships, d.key)[0];
    assert.equal(rel.status, "CONFIRMED");
    const al = result.alignments.find((x) => x.relationshipRef === rel.id);
    assert.equal(al?.status, "CONTRADICTORY");
    assert.ok(result.discrepancies.some((x) => x.kind === "SCOPE_DRIFT" && x.relationshipRef === rel.id));
  });

  test("title, owner, and due-date differences produce their discrepancy kinds with provenance", async () => {
    const a = aha({ ref: "VEL-E-21", title: "Program epic", owner: "Alex Owner", due: "2026-06-30", description: DPJ_URL("2101") });
    const d = dpj({ id: "2101", subject: "[VEL-E-21] Program epic v2", owner: "Jamie Other", due: "2026-09-30", description: "Aha: https://bayer.aha.io/epics/VEL-E-21" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-21"], dpjRecords: [d] });
    const kinds = new Map(result.discrepancies.map((x) => [x.kind, x]));
    assert.ok(kinds.has("TITLE_CONFLICT"));
    assert.equal(kinds.get("OWNERSHIP_CONFLICT")?.severity, "HIGH");
    assert.equal(kinds.get("DATE_CONFLICT")?.severity, "HIGH");
    for (const x of result.discrepancies) {
      assert.ok(x.values.some((v) => v.provenance !== undefined), `${x.kind} keeps field provenance`);
    }
    const sources = new Set(result.discrepancies.flatMap((x) => x.values.map((v) => v.provenance?.sourceRecordId)));
    assert.ok(sources.has("VEL-E-21") && sources.has("2101"));
  });
});

describe("discrepancies and omissions", () => {
  test("expected counterpart absent from a subject-only DPJ search is POTENTIAL_MIGRATION_OMISSION, never MISSING", async () => {
    const a = aha({ ref: "VEL-E-30", title: "Lonely epic" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-30"], dpj: { channels: DEFAULT_CHANNELS } });
    assert.ok(result.discrepancies.some((x) => x.kind === "POTENTIAL_MIGRATION_OMISSION"));
    assert.equal(result.discrepancies.filter((x) => x.kind === "MIGRATION_OMISSION").length, 0);
    assert.ok(result.relationships.every((r) => r.status !== "MISSING"));
  });

  test("MISSING is reached only when every enabled identity channel is searchable and the search completed", async () => {
    const a = aha({ ref: "VEL-E-31", title: "Really missing epic" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-31"], dpj: { channels: FULL_CHANNELS } });
    assert.ok(result.discrepancies.some((x) => x.kind === "MIGRATION_OMISSION" && x.severity === "HIGH"));
    assert.ok(result.relationships.some((r) => r.status === "MISSING"));
  });

  test("a truncated identifier search cannot conclude absence", async () => {
    const a = aha({ ref: "VEL-E-32", title: "Truncated" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-32"], dpj: { channels: FULL_CHANNELS, identifierTruncated: true } });
    assert.equal(result.relationships.filter((r) => r.status === "MISSING").length, 0);
    assert.equal(result.discrepancies.filter((x) => x.kind === "MIGRATION_OMISSION").length, 0);
  });

  test("expectDpjCounterpart false never reports an omission", async () => {
    const a = aha({ ref: "VEL-E-33", title: "Out of scope" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-33"], dpj: { channels: FULL_CHANNELS }, expect: false });
    assert.equal(result.discrepancies.filter((x) => x.kind.includes("OMISSION")).length, 0);
    assert.equal(result.relationships.filter((r) => r.status === "MISSING").length, 0);
  });
});

describe("proposals are proposal-only and need configured authority", () => {
  const titleAuthority = config({
    authority: [{ field: "title", authoritativeSystem: "aha", targetSystem: "dpj", basis: "test fixture: Aha is the title source for this migration" }],
  });

  test("without configured authority no proposal is generated and the value is preserved", async () => {
    const a = aha({ ref: "VEL-E-40", title: "Title A", description: DPJ_URL("4001") });
    const d = dpj({ id: "4001", subject: "[VEL-E-40] Title B", description: "Aha: https://bayer.aha.io/epics/VEL-E-40" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-40"], dpjRecords: [d] });
    assert.equal(result.proposals.length, 0);
    const t = result.discrepancies.find((x) => x.kind === "TITLE_CONFLICT");
    assert.equal(t?.authority, "UNKNOWN");
    assert.ok(t?.values.some((v) => v.value === "Title A") && t?.values.some((v) => v.value === "Title B"));
  });

  test("with configured authority a CONFIRMED discrepancy yields one unapplied proposal with fingerprint and approval requirement", async () => {
    const a = aha({ ref: "VEL-E-41", title: "Title A", description: DPJ_URL("4101") });
    const d = dpj({ id: "4101", subject: "[VEL-E-41] Title B", description: "Aha: https://bayer.aha.io/epics/VEL-E-41" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-41"], dpjRecords: [d], cfg: titleAuthority });
    assert.equal(result.proposals.length, 1);
    const p = result.proposals[0];
    assert.equal(p.applied, false);
    assert.equal(p.status, "PROPOSED");
    assert.equal(p.proposedValue, "Title A");
    assert.equal(p.existingValue, "Title B");
    assert.ok(p.ruleRefs.includes("R-PROP-002"));
    assert.match(p.approvalRequirement, new RegExp(p.proposalId));
    assert.match(p.baseStateFingerprint, /^[0-9a-f]{8}$/);
  });

  test("a PROBABLE discrepancy never produces a proposal even with authority", async () => {
    const a = aha({ ref: "VEL-E-42", title: "Title A", description: DPJ_URL("4201") });
    const d = dpj({ id: "4201", subject: "Title B" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-42"], dpjRecords: [d], cfg: titleAuthority });
    assert.equal(result.proposals.length, 0);
  });
});

describe("result envelope and retrieval discipline", () => {
  test("every result states PROPOSAL_ONLY and that nothing was applied", async () => {
    const a = aha({ ref: "VEL-E-50", title: "Envelope" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-50"] });
    assert.equal(result.mutationMode, MUTATION_MODE);
    assert.match(result.statement, /No changes have been applied/);
    assert.ok(result.systemsNotQueried.some((s) => s.system === "azure_devops"));
  });

  test("a repeated DPJ lookup of the same record is served from the session cache", async () => {
    const a = aha({ ref: "VEL-E-51", title: "Cache", description: DPJ_URL("5101") });
    const d = dpj({ id: "5101", subject: "[VEL-E-51] Cache", description: "Aha: https://bayer.aha.io/epics/VEL-E-51" });
    // Selecting the DPJ record and the Aha record that links to it asks for the same DPJ lookup twice.
    const { dpjAdapter, result } = await run({ aha: [a], ahaRefs: ["VEL-E-51"], dpjIds: ["5101"], dpjRecords: [d], dpj: { identifierHits: [d] } });
    assert.equal(dpjAdapter.calls.filter((c) => c === "get:5101").length, 1);
    assert.ok(result.retrievalLog.some((l) => l.cached), "second lookup is served from cache and logged");
  });

  test("downstream Azure DevOps links from Aha integration fields are reported NOT_RETRIEVED, not queried", async () => {
    const a = aha({ ref: "VEL-E-52", title: "Downstream", integrations: [{ service: "vsts", id: "778", url: "https://dev.azure.com/x/_workitems/edit/778" }] });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-52"] });
    const ado = result.downstreamLinks.find((l) => l.targetSystem === "azure_devops");
    assert.equal(ado?.retrievalState, "NOT_RETRIEVED");
    assert.ok(!result.systemsQueried.includes("azure_devops"));
  });

  test("a DPJ anchor with an Aha identity claim pulls in the Aha record it names", async () => {
    const a = aha({ ref: "VEL-E-53", title: "From DPJ" });
    const d = dpj({ id: "5301", subject: "[VEL-E-53] From DPJ" });
    const { result } = await run({ aha: [a], ahaRefs: [], dpjIds: ["5301"], dpjRecords: [d], dpj: { identifierHits: [d] } });
    assert.ok(result.artifacts.some((x) => x.key === "aha:VEL-E-53"));
    assert.ok(result.artifacts.some((x) => x.key === d.key));
    assert.equal(relTo(result.relationships, d.key)[0]?.status, "PROBABLE");
  });

  test("scope echoes the selected references and options", async () => {
    const a = aha({ ref: "VEL-E-54", title: "Scope" });
    const { result } = await run({ aha: [a], ahaRefs: ["VEL-E-54"], expect: false });
    assert.deepEqual(result.scope.aha, ["VEL-E-54"]);
    assert.equal(result.scope.options.expectDpjCounterpart, false);
  });
});
