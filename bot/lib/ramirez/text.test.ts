import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AHA_REF, bracketPrefixRef, calendarDate, comparableDescription, isAhaRef, jaccard, normalizeTitle, stripIdentityPrefix, tokens } from "./text";

describe("text helpers", () => {
  test("Aha references are recognized in free text and validated exactly", () => {
    const found = [...("see VEL-E-3599 and MMC-1 and ABC-123-4 but not hello-world".matchAll(AHA_REF))].map((m) => m[0]);
    assert.deepEqual(found, ["VEL-E-3599", "MMC-1", "ABC-123-4"]);
    assert.ok(isAhaRef("VEL-E-3599"));
    assert.ok(!isAhaRef("vel-e-3599"));
    assert.ok(!isAhaRef("work package 42"));
  });

  test("a bracketed reference prefix is read only when it is an Aha reference", () => {
    assert.equal(bracketPrefixRef("[VEL-E-1] Program epic"), "VEL-E-1");
    assert.equal(bracketPrefixRef("[urgent] Program epic"), undefined);
    assert.equal(bracketPrefixRef("Program epic"), undefined);
  });

  test("titles normalize identity prefixes, case, accents, and punctuation", () => {
    assert.equal(normalizeTitle("[VEL-E-1] Programme Épic: Phase-2!"), "programme epic phase 2");
    assert.equal(stripIdentityPrefix("[VEL-E-1]   Title"), "Title");
  });

  test("Jaccard similarity is 0 for empty sets and exact for overlaps", () => {
    assert.equal(jaccard(new Set(), new Set(["a"])), 0);
    assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
    assert.equal(jaccard(tokens("data integration"), tokens("Data Integration")), 1);
  });

  test("calendar dates compare by day only", () => {
    assert.equal(calendarDate("2026-06-30T10:00:00Z"), "2026-06-30");
    assert.equal(calendarDate(undefined), null);
  });

  test("comparable descriptions drop markup and identity lines", () => {
    const text = "<p>Scope A</p>\nAha: https://bayer.aha.io/epics/VEL-E-1\n<b>Done</b>";
    assert.equal(comparableDescription(text).replace(/\s+/g, " "), "Scope A Done");
  });
});
