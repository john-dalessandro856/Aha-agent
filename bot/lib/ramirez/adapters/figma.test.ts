import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeFigmaNode, pagesFromMetadataListing, parseFigmaUrl } from "./figma";

const NOW = "2026-11-17T14:00:00.000Z";

describe("parseFigmaUrl", () => {
  test("parses design URLs with node-id", () => {
    const p = parseFigmaUrl(
      "https://www.figma.com/design/Mfpvi8EkGRio9wuSXi5ZzS/Product-Profiles?node-id=2588-718438",
    );
    assert.deepEqual(p, {
      fileKey: "Mfpvi8EkGRio9wuSXi5ZzS",
      fileName: "Product-Profiles",
      nodeId: "2588:718438",
    });
  });

  test("parses legacy /file/ URLs", () => {
    const p = parseFigmaUrl("https://www.figma.com/file/Mfpvi8EkGRio9wuSXi5ZzS/Product-Profiles?node-id=250-554914");
    assert.equal(p?.fileKey, "Mfpvi8EkGRio9wuSXi5ZzS");
    assert.equal(p?.nodeId, "250:554914");
  });
});

describe("normalizeFigmaNode", () => {
  test("builds a file artifact with page tags", () => {
    const pages = pagesFromMetadataListing(`
- 250:554914:      - Profile Main
- 2588:718438:       - Portfolio Main
- 4873:281259: 📁 Portfolio (Products & Parentage)
`);
    const a = normalizeFigmaNode(
      {
        fileKey: "Mfpvi8EkGRio9wuSXi5ZzS",
        fileName: "Product-Profiles",
        nodeId: "2588:718438",
        nodeName: "Portfolio Main",
        pages,
        note: "Aha parentage epics link this file; no layer titled Product Parentage Outline.",
      },
      NOW,
    );
    assert.equal(a.key, "figma:Mfpvi8EkGRio9wuSXi5ZzS:2588:718438");
    assert.equal(a.system, "figma");
    assert.equal(a.title?.value, "Portfolio Main");
    assert.match(a.url?.value ?? "", /node-id=2588-718438/);
    assert.equal(a.externalIds[0]?.scheme, "figma_file_key");
    assert.ok(a.tags?.value.some((t) => /Portfolio Main/.test(t)));
  });
});
