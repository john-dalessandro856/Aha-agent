import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withVerifiedConventions } from "./config";
import { aha, config, fake, fakeMural, mural, NOW } from "./fixtures";
import { reconcileMural } from "./reconcile-mural";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";

describe("reconcileMural", () => {
  test("Aha mural URL + matching board is PROBABLE until verified", async () => {
    const board = mural({ id: "bayer1789.1771356982650", title: "MMC Bi-Weekly" });
    const record = aha({
      ref: "VEL-E-100",
      title: "MMC planning",
      description: `Workshop https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650`,
    });
    const result = await reconcileMural(
      { muralIds: [board.sourceId], ahaRefs: ["VEL-E-100"], expectPlanningCounterpart: false, includeStickyExcerpts: false },
      {
        aha: fake({ system: "aha", records: [record] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    const rel = result.relationships.find((r) => r.source === board.key);
    assert.equal(rel?.status, "PROBABLE");
    assert.equal(rel?.score, 85);
    assert.equal(rel?.method, "DETERMINISTIC");
    assert.ok(rel?.ruleRefs.includes("R-ID-003"));
    assert.equal(result.scope.options.transition, "mural_aha");
    assert.equal(result.proposals.length, 0);
    assert.match(renderReport(result), /Mural bayer1789\.1771356982650 ↔ Aha VEL-E-100: PROBABLE/);
  });

  test("verifyConventions confirms mural URL identity at 92", async () => {
    const board = mural({ id: "bayer1789.1771356982650", title: "MMC Bi-Weekly" });
    const record = aha({
      ref: "VEL-E-101",
      title: "MMC planning",
      description: `Workshop https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650`,
    });
    const result = await reconcileMural(
      { muralIds: [board.sourceId], ahaRefs: ["VEL-E-101"], expectPlanningCounterpart: false, includeStickyExcerpts: false },
      {
        aha: fake({ system: "aha", records: [record] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: withVerifiedConventions(config(), ["aha_description_mural_url"]),
        now: () => NOW,
      },
    );
    const rel = result.relationships.find((r) => r.target === "aha:VEL-E-101");
    assert.equal(rel?.status, "CONFIRMED");
    assert.equal(rel?.score, 92);
  });

  test("mural title Aha ref pairs with the named record", async () => {
    const board = mural({ id: "bayer1789.2", title: "VEL-E-200 discovery" });
    const record = aha({ ref: "VEL-E-200", title: "Discovery epic" });
    const result = await reconcileMural(
      { muralIds: [board.sourceId], ahaRefs: [], expectPlanningCounterpart: false, includeStickyExcerpts: false },
      {
        aha: fake({ system: "aha", records: [record] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.relationships.some((r) => r.source === board.key && r.target === "aha:VEL-E-200" && r.status === "PROBABLE"));
  });

  test("expectPlanningCounterpart with no Aha link yields ORPHAN_RESEARCH_EVIDENCE", async () => {
    const board = mural({ id: "bayer1789.3", title: "Unlinked workshop" });
    const result = await reconcileMural(
      { muralIds: [board.sourceId], ahaRefs: [], expectPlanningCounterpart: true, includeStickyExcerpts: false },
      {
        aha: fake({ system: "aha", records: [] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "ORPHAN_RESEARCH_EVIDENCE"));
    assert.ok(!result.relationships.some((r) => r.status === "MISSING"));
  });

  test("sticky excerpts never create identity and are noted as limitations", async () => {
    const board = mural({ id: "bayer1789.4", title: "Plain board" });
    const muralAdapter = fakeMural({
      records: [board],
      stickyExcerpts: { "bayer1789.4": "Discuss VEL-E-999 tomorrow" },
    });
    const result = await reconcileMural(
      { muralIds: [board.sourceId], ahaRefs: ["VEL-E-999"], expectPlanningCounterpart: false, includeStickyExcerpts: true },
      {
        aha: fake({ system: "aha", records: [aha({ ref: "VEL-E-999", title: "Other" })] }),
        mural: muralAdapter,
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(muralAdapter.calls.includes("sticky:bayer1789.4"));
    assert.ok(result.limitations.some((l) => /Sticky excerpts/.test(l)));
    assert.ok(!result.relationships.some((r) => r.method === "DETERMINISTIC" && r.target === "aha:VEL-E-999"));
  });

  test("member URL input resolves to mural id", async () => {
    const board = mural({ id: "bayer1789.5", title: "URL board" });
    const result = await reconcileMural(
      {
        muralIds: ["https://app.mural.co/t/bayer1789/m/bayer1789/5"],
        ahaRefs: [],
        expectPlanningCounterpart: false,
        includeStickyExcerpts: false,
      },
      {
        aha: fake({ system: "aha", records: [] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.deepEqual(result.scope.mural, ["bayer1789.5"]);
  });
});
