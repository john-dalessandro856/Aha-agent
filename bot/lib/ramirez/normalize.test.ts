import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aha, dpj } from "./fixtures";

describe("Aha normalization", () => {
  test("a DPJ URL in the Aha description is an identity claim with provenance", () => {
    const a = aha({ ref: "VEL-E-1", title: "T", description: "Tracked at https://dpj.int.bayer.com/projects/x/work_packages/77" });
    const link = a.links.find((l) => l.targetSystem === "dpj");
    assert.equal(link?.targetId, "77");
    assert.equal(link?.kind, "aha_description_dpj_url");
    assert.equal(link?.claimsIdentity, true);
    assert.equal(link?.provenance.sourceRecordId, "VEL-E-1");
  });

  test("a Visual Studio Team (vsts) integration field is an Azure DevOps link, not a DPJ link", () => {
    const a = aha({ ref: "VEL-E-2", title: "T", integrations: [{ service: "vsts", id: "778", url: "https://dev.azure.com/org/_workitems/edit/778" }] });
    const ado = a.links.find((l) => l.targetSystem === "azure_devops");
    assert.equal(ado?.targetId, "778");
    assert.ok(!a.links.some((l) => l.targetSystem === "dpj"));
  });

  test("every normalized field carries system, source record, field, adapter, and retrieval time", () => {
    const a = aha({ ref: "VEL-E-3", title: "T", owner: "Alex Owner", start: "2026-01-01", due: "2026-02-01", description: "d" });
    for (const f of ["title", "description", "owner", "startDate", "dueDate", "status", "recordType"] as const) {
      const p = a[f]?.provenance;
      assert.ok(p, `${f} has provenance`);
      assert.equal(p.system, "aha");
      assert.equal(p.sourceRecordId, "VEL-E-3");
      assert.ok(p.sourceField.length > 0, `${f} names its source field`);
      assert.match(p.adapter, /@1$/);
      assert.equal(p.retrievedAt, "2026-11-16T12:00:00.000Z");
    }
  });

  test("owner e-mail addresses from the source are not kept in the artifact", () => {
    const a = aha({ ref: "VEL-E-4", title: "T", owner: "Alex Owner" });
    // The adapter tag "aha-mcp-read_records@1" contains "@", so match an e-mail shape instead.
    assert.doesNotMatch(JSON.stringify(a), /[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });
});

describe("DPJ normalization", () => {
  test("a bracketed Aha reference in the subject is an identity claim", () => {
    const d = dpj({ id: "10", subject: "[VEL-E-1] Program epic" });
    const link = d.links.find((l) => l.targetSystem === "aha");
    assert.equal(link?.targetId, "VEL-E-1");
    assert.equal(link?.kind, "dpj_subject_bracket_ref");
    assert.equal(link?.claimsIdentity, true);
    assert.equal(link?.provenance.sourceField, "subject");
  });

  test("a labelled 'Aha:' line with an Aha URL is an identity claim", () => {
    const d = dpj({ id: "11", subject: "Plain", description: "Aha: https://bayer.aha.io/epics/VEL-E-9" });
    const link = d.links.find((l) => l.kind === "dpj_description_aha_url");
    assert.equal(link?.targetId, "VEL-E-9");
    assert.equal(link?.claimsIdentity, true);
  });

  test("a bare reference in prose is recorded as a text mention and does not claim identity", () => {
    const d = dpj({ id: "12", subject: "Plain", description: "Relates to VEL-E-7 discussion" });
    const link = d.links.find((l) => l.targetId === "VEL-E-7");
    assert.equal(link?.kind, "text_mention");
    assert.equal(link?.claimsIdentity, false);
  });

  test("DPJ parent link is kept with its title and any Aha reference in that title", () => {
    const d = dpj({ id: "13", subject: "Child", parentId: "9", parentTitle: "[VEL-E-1] Parent" });
    assert.equal(d.parent?.value.id, "9");
    assert.equal(d.parent?.value.refInTitle, "VEL-E-1");
  });
});
