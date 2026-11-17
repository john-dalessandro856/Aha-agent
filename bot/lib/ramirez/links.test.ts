import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ahaRefFromTitle, parseFigmaUrls, parseMuralUrls, resolveMuralId } from "./links";

describe("parseFigmaUrls", () => {
  test("extracts fileKey and nodeId from a design URL", () => {
    const hits = parseFigmaUrls(
      "Mock: https://www.figma.com/design/Mfpvi8EkGRio9wuSXi5ZzS/Product-Profiles?node-id=2588-718438",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.fileKey, "Mfpvi8EkGRio9wuSXi5ZzS");
    assert.equal(hits[0]?.nodeId, "2588:718438");
    assert.equal(hits[0]?.fileName, "Product-Profiles");
  });

  test("dedupes the same fileKey+node", () => {
    const url = "https://www.figma.com/design/Mfpvi8EkGRio9wuSXi5ZzS/X?node-id=1-2";
    assert.equal(parseFigmaUrls(`${url} and again ${url}`).length, 1);
  });
});

describe("parseMuralUrls", () => {
  test("maps member URL to workspace.numeric mural id", () => {
    const hits = parseMuralUrls("Board https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650 end");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.muralId, "bayer1789.1771356982650");
    assert.equal(hits[0]?.workspaceId, "bayer1789");
  });
});

describe("ahaRefFromTitle", () => {
  test("returns the first Aha reference", () => {
    assert.equal(ahaRefFromTitle("VEL-E-3599 — Portfolio Main"), "VEL-E-3599");
  });

  test("returns undefined when none", () => {
    assert.equal(ahaRefFromTitle("Portfolio Main"), undefined);
  });
});

describe("resolveMuralId", () => {
  test("accepts a bare mural id", () => {
    assert.equal(resolveMuralId("bayer1789.1771356982650"), "bayer1789.1771356982650");
  });

  test("parses a member URL", () => {
    assert.equal(resolveMuralId("https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650"), "bayer1789.1771356982650");
  });
});
