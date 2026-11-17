import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { withVerifiedConventions } from "./config";
import { aha, config, fake, NOW } from "./fixtures";
import { figmaFileKey, linkMatchesFigma, reconcileFigma } from "./reconcile-figma";
import { normalizeFigmaNode } from "./adapters/figma";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";

const FILE = "Mfpvi8EkGRio9wuSXi5ZzS";

describe("linkMatchesFigma", () => {
  test("matches fileKey and fileKey:nodeId links", () => {
    const fig = normalizeFigmaNode({ fileKey: FILE, nodeId: "2588:718438", nodeName: "Portfolio Main" }, NOW);
    assert.equal(figmaFileKey(fig), FILE);
    assert.equal(
      linkMatchesFigma(
        {
          targetSystem: "figma",
          targetId: FILE,
          kind: "aha_description_figma_url",
          claimsIdentity: true,
          provenance: fig.externalIds[0]!.provenance,
        },
        fig,
      ),
      true,
    );
    assert.equal(
      linkMatchesFigma(
        {
          targetSystem: "figma",
          targetId: `${FILE}:2588:718438`,
          kind: "aha_description_figma_url",
          claimsIdentity: true,
          provenance: fig.externalIds[0]!.provenance,
        },
        fig,
      ),
      true,
    );
  });
});

describe("reconcileFigma", () => {
  test("Aha Figma URL + matching evidence is PROBABLE until verified", async () => {
    const record = aha({
      ref: "VEL-E-300",
      title: "Portfolio parentage",
      description: `Design https://www.figma.com/design/${FILE}/Product-Profiles?node-id=2588-718438`,
    });
    const result = await reconcileFigma(
      {
        ahaRefs: ["VEL-E-300"],
        figma: [{ fileKey: FILE, fileName: "Product-Profiles", nodeId: "2588:718438", nodeName: "Portfolio Main" }],
        expectDesignCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    const rel = result.relationships.find((r) => r.target === "aha:VEL-E-300");
    assert.equal(rel?.status, "PROBABLE");
    assert.equal(rel?.score, 85);
    assert.equal(result.scope.options.transition, "figma_aha");
    assert.ok(result.limitations.some((l) => /Figma was not queried by Ramirez/.test(l)));
    assert.match(renderReport(result), /Figma .* ↔ Aha VEL-E-300: PROBABLE/);
  });

  test("verifyConventions confirms Figma URL identity at 92", async () => {
    const record = aha({
      ref: "VEL-E-301",
      title: "Portfolio",
      description: `https://www.figma.com/design/${FILE}/X`,
    });
    const result = await reconcileFigma(
      {
        ahaRefs: ["VEL-E-301"],
        figma: [{ fileKey: FILE, fileName: "X" }],
        expectDesignCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: withVerifiedConventions(config(), ["aha_description_figma_url"]),
        now: () => NOW,
      },
    );
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-301")?.status, "CONFIRMED");
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-301")?.score, 92);
  });

  test("figma title Aha ref pairs without a URL on Aha", async () => {
    const record = aha({ ref: "VEL-E-302", title: "Discovery" });
    const result = await reconcileFigma(
      {
        ahaRefs: [],
        figma: [{ fileKey: FILE, nodeName: "VEL-E-302 — Main" }],
        expectDesignCounterpart: false,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.relationships.some((r) => r.target === "aha:VEL-E-302" && r.status === "PROBABLE"));
  });

  test("expectDesignCounterpart with no Aha yields ORPHAN_DESIGN_EVIDENCE", async () => {
    const result = await reconcileFigma(
      {
        ahaRefs: [],
        figma: [{ fileKey: FILE, nodeName: "Orphan frame" }],
        expectDesignCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "ORPHAN_DESIGN_EVIDENCE"));
    assert.ok(!result.relationships.some((r) => r.status === "MISSING"));
  });

  test("Aha linked to a different fileKey than evidence raises STALE_DESIGN_LINK when also paired", async () => {
    const record = aha({
      ref: "VEL-E-303",
      title: "VEL-E-303 Portfolio",
      description: `https://www.figma.com/design/AAAAAAAAAAAAAAAAAAAAAA/Old`,
    });
    // Title ref on Figma evidence pairs with Aha; Aha URL points at another file → stale
    const result = await reconcileFigma(
      {
        ahaRefs: ["VEL-E-303"],
        figma: [{ fileKey: FILE, nodeName: "VEL-E-303 Portfolio" }],
        expectDesignCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "STALE_DESIGN_LINK"));
  });

  test("Aha without design pair under expectation yields PLANNING_ABSENT_FROM_DESIGN", async () => {
    const record = aha({ ref: "VEL-E-304", title: "No design link" });
    const result = await reconcileFigma(
      {
        ahaRefs: ["VEL-E-304"],
        figma: [{ fileKey: FILE, nodeName: "Unrelated frame" }],
        expectDesignCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "PLANNING_ABSENT_FROM_DESIGN"));
  });
});
