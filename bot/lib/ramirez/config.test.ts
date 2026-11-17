import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { conventionVerified, DEFAULT_CONFIG, withVerifiedConventions } from "./config";

describe("withVerifiedConventions", () => {
  test("marks listed kinds verified without changing other flags", () => {
    const cfg = withVerifiedConventions(DEFAULT_CONFIG, ["aha_description_figma_url", "mural_title_aha_ref"]);
    assert.equal(cfg.conventions.ahaDescriptionFigmaUrl.verified, true);
    assert.equal(cfg.conventions.muralTitleAhaRef.verified, true);
    assert.equal(cfg.conventions.dpjSubjectBracketRef.verified, false);
    assert.equal(conventionVerified(cfg, "aha_description_figma_url"), true);
    assert.equal(conventionVerified(cfg, "dpj_subject_bracket_ref"), false);
  });

  test("empty list returns the same config object", () => {
    assert.equal(withVerifiedConventions(DEFAULT_CONFIG, []), DEFAULT_CONFIG);
  });
});
