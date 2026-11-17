import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeMuralBoard, normalizeMuralSearchHit, overviewFromCanvas } from "./mural";

const NOW = "2026-11-17T14:00:00.000Z";

describe("normalizeMuralBoard", () => {
  test("maps get_mural_info + overview into an AVAILABLE mural artifact", () => {
    const a = normalizeMuralBoard(
      {
        id: "bayer1789.1771356982650",
        title: "MMC Bi-Weekly",
        member_url: "https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650",
        workspace_id: "bayer1789",
        workspace_name: "Bayer",
        last_updated: 1794413322056,
        description: "",
      },
      NOW,
      overviewFromCanvas({
        total_widgets: 1110,
        by_type: { sticky_note: 725, area: 31 },
        top_level_count: 44,
        areas: [
          { widget_id: "57-1785874106127", title: "MMC Lean Coffee - November 11" },
          { widget_id: "1-1785874109792", title: "DEMO DAY - DECEMBER" },
        ],
      }),
    );
    assert.equal(a.key, "mural:bayer1789.1771356982650");
    assert.equal(a.system, "mural");
    assert.equal(a.retrievalState, "AVAILABLE");
    assert.equal(a.title?.value, "MMC Bi-Weekly");
    assert.match(a.description?.value ?? "", /widgets=1110/);
    assert.match(a.description?.value ?? "", /November 11/);
    assert.equal(a.url?.value, "https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650");
    assert.equal(a.tags?.value.length, 2);
  });
});

describe("normalizeMuralSearchHit", () => {
  test("maps a search_murals hit", () => {
    const a = normalizeMuralSearchHit(
      {
        mural_id: "bayer1789.1771356982650",
        title: "MMC Bi-Weekly",
        status: "active",
        workspace_id: "bayer1789",
        workspace_name: "Bayer",
        updated_on: 1794413322056,
        member_url: "https://app.mural.co/t/bayer1789/m/bayer1789/1771356982650",
      },
      NOW,
    );
    assert.equal(a.sourceId, "bayer1789.1771356982650");
    assert.equal(a.status?.value.name, "active");
    assert.equal(a.project?.value.id, "bayer1789");
  });
});
