import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withVerifiedConventions } from "./config";
import { aha, config, fake, fakeMural, mural, NOW } from "./fixtures";
import { buildLifecyclePaths, reconcileLifecycle } from "./reconcile-lifecycle";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";

const FILE = "Mfpvi8EkGRio9wuSXi5ZzS";

describe("buildLifecyclePaths", () => {
  test("emits a path only when the same Aha is target of mural and figma hops", () => {
    const paths = buildLifecyclePaths([
      {
        id: "R-1",
        source: "mural:bayer1789.1",
        target: "aha:VEL-E-1",
        targetSystem: "aha",
        status: "PROBABLE",
        method: "DETERMINISTIC",
        score: 85,
        scoreBasis: { baseline: 85, capsApplied: [], components: [] },
        evidenceRefs: [],
        contradictoryEvidenceRefs: [],
        missingEvidence: [],
        targetRetrievalState: "AVAILABLE",
        ruleRefs: [],
        explanation: "m",
        wouldRaiseConfidence: [],
        wouldLowerConfidence: [],
      },
      {
        id: "R-2",
        source: "figma:FILE",
        target: "aha:VEL-E-1",
        targetSystem: "aha",
        status: "CONFIRMED",
        method: "DETERMINISTIC",
        score: 92,
        scoreBasis: { baseline: 92, capsApplied: [], components: [] },
        evidenceRefs: [],
        contradictoryEvidenceRefs: [],
        missingEvidence: [],
        targetRetrievalState: "AVAILABLE",
        ruleRefs: [],
        explanation: "f",
        wouldRaiseConfidence: [],
        wouldLowerConfidence: [],
      },
    ]);
    assert.equal(paths.length, 1);
    assert.equal(paths[0]?.ahaKey, "aha:VEL-E-1");
    assert.equal(paths[0]?.muralStatus, "PROBABLE");
    assert.equal(paths[0]?.figmaStatus, "CONFIRMED");
  });
});

describe("reconcileLifecycle", () => {
  test("stitches mural↔Aha and Figma↔Aha through a shared Aha record", async () => {
    const board = mural({
      id: "bayer1789.10",
      title: "VEL-E-410 workshop",
      description: `Mockups https://www.figma.com/design/${FILE}/Product-Profiles`,
    });
    const record = aha({
      ref: "VEL-E-410",
      title: "Parentage epic",
      description: [
        `Workshop https://app.mural.co/t/bayer1789/m/bayer1789/10`,
        `Design https://www.figma.com/design/${FILE}/Product-Profiles`,
      ].join("\n"),
    });
    const result = await reconcileLifecycle(
      {
        muralIds: [board.sourceId],
        ahaRefs: ["VEL-E-410"],
        figma: [{ fileKey: FILE, fileName: "Product-Profiles", nodeName: "Portfolio Main" }],
        expectPlanningCounterpart: false,
        expectDesignCounterpart: true,
        includeStickyExcerpts: false,
        includeMuralFigmaHop: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.equal(result.scope.options.transition, "lifecycle");
    assert.ok(result.lifecyclePaths.some((p) => p.ahaKey === "aha:VEL-E-410"));
    assert.ok(result.relationships.some((r) => r.source.startsWith("mural:") && r.target === "aha:VEL-E-410"));
    assert.ok(result.relationships.some((r) => r.source.startsWith("figma:") && r.target === "aha:VEL-E-410"));
    assert.ok(result.relationships.some((r) => r.source.startsWith("mural:") && r.targetSystem === "figma"));
    assert.match(renderReport(result), /Lifecycle paths/);
    assert.match(renderReport(result), /Transition: Lifecycle/);
  });

  test("verified mural_description_figma_url confirms mural→Figma", async () => {
    const board = mural({
      id: "bayer1789.11",
      title: "Research board",
      description: `https://www.figma.com/design/${FILE}/X`,
    });
    const result = await reconcileLifecycle(
      {
        muralIds: [board.sourceId],
        ahaRefs: [],
        figma: [{ fileKey: FILE, fileName: "X" }],
        expectPlanningCounterpart: false,
        expectDesignCounterpart: false,
        includeStickyExcerpts: false,
        includeMuralFigmaHop: true,
      },
      {
        aha: fake({ system: "aha", records: [] }),
        mural: fakeMural({ records: [board] }),
        session: new RetrievalSession(() => NOW),
        config: withVerifiedConventions(config(), ["mural_description_figma_url"]),
        now: () => NOW,
      },
    );
    const mf = result.relationships.find((r) => r.source === board.key && r.targetSystem === "figma");
    assert.equal(mf?.status, "CONFIRMED");
    assert.equal(mf?.score, 92);
  });

  test("figma-only lifecycle still runs the Figma hop", async () => {
    const record = aha({
      ref: "VEL-E-411",
      title: "Design only",
      description: `https://www.figma.com/design/${FILE}/Y`,
    });
    const result = await reconcileLifecycle(
      {
        muralIds: [],
        ahaRefs: ["VEL-E-411"],
        figma: [{ fileKey: FILE }],
        expectPlanningCounterpart: false,
        expectDesignCounterpart: true,
        includeStickyExcerpts: false,
        includeMuralFigmaHop: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        mural: fakeMural({ records: [] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.equal(result.lifecyclePaths.length, 0);
    assert.ok(result.relationships.some((r) => r.target === "aha:VEL-E-411"));
    assert.ok(result.limitations.some((l) => /No mural was named/.test(l)));
  });
});
