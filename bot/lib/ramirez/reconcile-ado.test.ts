import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeAdoWorkItem } from "./adapters/ado";
import { withVerifiedConventions } from "./config";
import { aha, config, fake, NOW } from "./fixtures";
import { adoWorkItemId, linkMatchesAdo, reconcileAdo } from "./reconcile-ado";
import { renderReport } from "./report";
import { RetrievalSession } from "./retrieval";

describe("linkMatchesAdo", () => {
  test("matches work-item id links", () => {
    const item = normalizeAdoWorkItem({ workItemId: "12345", title: "Work" }, NOW);
    assert.equal(adoWorkItemId(item), "12345");
    assert.equal(
      linkMatchesAdo(
        {
          targetSystem: "azure_devops",
          targetId: "12345",
          kind: "aha_description_ado_url",
          claimsIdentity: true,
          provenance: item.externalIds[0]!.provenance,
        },
        item,
      ),
      true,
    );
  });
});

describe("reconcileAdo", () => {
  test("Aha vsts id + matching evidence is PROBABLE until verified", async () => {
    const record = aha({
      ref: "VEL-E-400",
      title: "Engineering twin",
      integrations: [{ service: "vsts", id: "12345", url: "https://dev.azure.com/bayer/proj/_workitems/edit/12345" }],
    });
    const result = await reconcileAdo(
      {
        ahaRefs: ["VEL-E-400"],
        ado: [{ workItemId: "12345", title: "Engineering twin", org: "bayer", project: "proj" }],
        expectEngineeringCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    const rel = result.relationships.find((r) => r.target === "aha:VEL-E-400");
    assert.equal(rel?.status, "PROBABLE");
    assert.equal(rel?.score, 85);
    assert.equal(result.scope.options.transition, "ado_aha");
    assert.ok(result.limitations.some((l) => /ADO was not queried by Ramirez/.test(l)));
    assert.match(renderReport(result), /ADO .* ↔ Aha VEL-E-400: PROBABLE/);
  });

  test("Aha description ADO URL pairs and verifies with convention flag", async () => {
    const record = aha({
      ref: "VEL-E-401",
      title: "Linked",
      description: "Track in https://dev.azure.com/bayer/Velocity/_workitems/edit/999",
    });
    const result = await reconcileAdo(
      {
        ahaRefs: ["VEL-E-401"],
        ado: [{ workItemId: "999", title: "Linked" }],
        expectEngineeringCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: withVerifiedConventions(config(), ["aha_description_ado_url"]),
        now: () => NOW,
      },
    );
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-401")?.status, "CONFIRMED");
    assert.equal(result.relationships.find((r) => r.target === "aha:VEL-E-401")?.score, 92);
  });

  test("ADO title Aha ref pairs without a URL on Aha", async () => {
    const record = aha({ ref: "VEL-E-402", title: "Discovery" });
    const result = await reconcileAdo(
      {
        ahaRefs: [],
        ado: [{ workItemId: "55", title: "VEL-E-402 — Implement discovery" }],
        expectEngineeringCounterpart: false,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.relationships.some((r) => r.target === "aha:VEL-E-402" && r.status === "PROBABLE"));
  });

  test("expectEngineeringCounterpart with no Aha yields ORPHAN_ENGINEERING_EVIDENCE", async () => {
    const result = await reconcileAdo(
      {
        ahaRefs: [],
        ado: [{ workItemId: "1", title: "Orphan" }],
        expectEngineeringCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "ORPHAN_ENGINEERING_EVIDENCE"));
    assert.ok(!result.relationships.some((r) => r.status === "MISSING"));
  });

  test("Aha linked to a different work item raises STALE_ADO_LINK when also paired", async () => {
    const record = aha({
      ref: "VEL-E-403",
      title: "VEL-E-403 Portfolio",
      description: "https://dev.azure.com/bayer/Velocity/_workitems/edit/111",
    });
    const result = await reconcileAdo(
      {
        ahaRefs: ["VEL-E-403"],
        ado: [{ workItemId: "222", title: "VEL-E-403 Portfolio" }],
        expectEngineeringCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "STALE_ADO_LINK"));
  });

  test("Aha without engineering pair under expectation yields PLANNING_ABSENT_FROM_ENGINEERING", async () => {
    const record = aha({ ref: "VEL-E-404", title: "No ADO link" });
    const result = await reconcileAdo(
      {
        ahaRefs: ["VEL-E-404"],
        ado: [{ workItemId: "77", title: "Unrelated work" }],
        expectEngineeringCounterpart: true,
      },
      {
        aha: fake({ system: "aha", records: [record] }),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(result.discrepancies.some((d) => d.kind === "PLANNING_ABSENT_FROM_ENGINEERING"));
  });
});
