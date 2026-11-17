import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aha, config, dpj, fake, NOW } from "./fixtures";
import { reconcile } from "./reconcile";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";
import type { ReconciliationResult } from "./types";

async function run(ahaRefs: string[], records: { aha: ReturnType<typeof aha>; dpj: ReturnType<typeof dpj> }, cfg = config()): Promise<ReconciliationResult> {
  const dpjAdapter = fake({ system: "dpj", records: [records.dpj] });
  return reconcile(
    { ahaRefs, dpjIds: [], expectDpjCounterpart: true },
    {
      aha: fake({ system: "aha", records: [records.aha] }),
      dpj: dpjAdapter,
      session: new RetrievalSession(() => NOW),
      config: cfg,
      now: () => NOW,
    },
  );
}

describe("renderReport copies the engine result", () => {
  test("a PROBABLE relationship stays PROBABLE in the report", async () => {
    const a = aha({ ref: "VEL-E-2", title: "Other epic", description: "Tracked in https://dpj.int.bayer.com/work_packages/102" });
    const d = dpj({ id: "102", subject: "Unlabelled subject" });
    const result = await run(["VEL-E-2"], { aha: a, dpj: d });
    const report = renderReport(result);
    const relationships = report.split("## Alignment")[0] ?? report;
    assert.match(relationships, /Aha VEL-E-2 ↔ DPJ 102: PROBABLE \(score 85, method DETERMINISTIC, rules R-ID-003\)/);
    assert.doesNotMatch(relationships, /CONFIRMED/);
    assert.equal(report.startsWith(result.statement), true);
    for (const limitation of result.limitations) assert.ok(report.includes(limitation), limitation);
    assert.doesNotMatch(report, /## Proposals/);
  });

  test("a proposal is copied with applied false and is not invented when absent", async () => {
    const authority = config({
      authority: [{ field: "title", authoritativeSystem: "aha", targetSystem: "dpj", basis: "test fixture" }],
    });
    const a = aha({ ref: "VEL-E-41", title: "Title A", description: "https://dpj.int.bayer.com/work_packages/4101" });
    const d = dpj({ id: "4101", subject: "[VEL-E-41] Title B", description: "Aha: https://bayer.aha.io/epics/VEL-E-41" });
    const result = await run(["VEL-E-41"], { aha: a, dpj: d }, authority);
    const proposal = result.proposals[0];
    assert.ok(proposal);
    const report = renderReport(result);
    assert.match(report, new RegExp(`${proposal.proposalId}: target ${proposal.targetRecord}`));
    assert.match(report, /applied: false/);
    assert.match(report, /None of these proposals was applied/);
    assert.equal(report.includes("Title A"), true);
    assert.equal(report.includes("Title B"), true);

    const without = await run(["VEL-E-2"], {
      aha: aha({ ref: "VEL-E-2", description: "Tracked in https://dpj.int.bayer.com/work_packages/102" }),
      dpj: dpj({ id: "102", subject: "Unlabelled subject" }),
    });
    assert.equal(without.proposals.length, 0);
    assert.doesNotMatch(renderReport(without), /## Proposals/);
  });
});
