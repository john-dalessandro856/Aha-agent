import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_CHANNELS, FULL_CHANNELS, NOW, aha, config, fake } from "./fixtures";
import { reconcile } from "./reconcile";
import { RetrievalSession, classifyError } from "./retrieval";
import type { RetrievalState } from "./types";

/**
 * Retrieval, relationship, and omission must stay distinct. The five states below
 * are the ones the spec names; none of them may collapse into MISSING unless the
 * MISSING criteria hold.
 */
const STATES: RetrievalState[] = ["NOT_AVAILABLE", "INACCESSIBLE", "NOT_RETRIEVED", "NOT_FOUND_WITHIN_QUERIED_SCOPE"];

async function scenario(identifierState: RetrievalState, opts: { channels?: typeof DEFAULT_CHANNELS; expect?: boolean; truncated?: boolean } = {}) {
  const a = aha({ ref: "VEL-E-60", title: "State probe" });
  const result = await reconcile(
    { ahaRefs: ["VEL-E-60"], dpjIds: [], expectDpjCounterpart: opts.expect ?? true },
    {
      aha: fake({ system: "aha", records: [a] }),
      dpj: fake({ system: "dpj", channels: opts.channels ?? DEFAULT_CHANNELS, identifierState, identifierTruncated: opts.truncated }),
      session: new RetrievalSession(() => NOW),
      config: config(),
      now: () => NOW,
    },
  );
  return result;
}

describe("retrieval states remain distinct and never become MISSING by default", () => {
  for (const state of STATES) {
    test(`${state} does not produce MISSING or a migration omission`, async () => {
      const result = await scenario(state);
      assert.ok(result.relationships.every((r) => r.status !== "MISSING"), "no MISSING relationship");
      assert.equal(result.discrepancies.filter((d) => d.kind === "MIGRATION_OMISSION").length, 0);
      assert.ok(result.relationships.every((r) => r.status !== "CONFIRMED" && r.status !== "PROBABLE"));
    });
  }

  test("each state is carried through unchanged to the relationship that depends on it", async () => {
    const seen = new Map<RetrievalState, string>();
    for (const state of STATES) {
      const result = await scenario(state);
      const rel = result.relationships.find((r) => r.source === "aha:VEL-E-60");
      assert.ok(rel, `relationship for ${state}`);
      seen.set(state, rel.targetRetrievalState);
    }
    assert.equal(new Set(seen.values()).size, STATES.length, "four distinct retrieval states survive");
    for (const state of STATES) assert.equal(seen.get(state), state);
  });

  test("expectDpjCounterpart=false produces no omission and no MISSING, whatever the search state", async () => {
    const result = await scenario("NOT_FOUND_WITHIN_QUERIED_SCOPE", { expect: false });
    assert.equal(result.discrepancies.length, 0);
    assert.ok(result.relationships.every((r) => r.status !== "MISSING"));
  });

  test("a truncated search is never treated as absence, even with every channel searchable", async () => {
    const result = await scenario("NOT_FOUND_WITHIN_QUERIED_SCOPE", { channels: FULL_CHANNELS, truncated: true });
    assert.ok(result.relationships.every((r) => r.status !== "MISSING"));
  });

  test("NOT_FOUND within a fully searchable scope is the only path to MISSING", async () => {
    const result = await scenario("NOT_FOUND_WITHIN_QUERIED_SCOPE", { channels: FULL_CHANNELS });
    assert.ok(result.relationships.some((r) => r.status === "MISSING"));
  });
});

describe("error classification keeps states apart", () => {
  const cases: Array<[string, RetrievalState]> = [
    ["MCP connection \"aha\" needs authorization. Run agent-sdk mcp oauth aha.", "INACCESSIBLE"],
    ["HTTP 403 forbidden", "INACCESSIBLE"],
    ["HTTP 404 not found", "NOT_FOUND_WITHIN_QUERIED_SCOPE"],
    ["connection dpj not loaded (NOT_RETRIEVED)", "NOT_RETRIEVED"],
    ["socket hang up", "NOT_AVAILABLE"],
  ];
  for (const [message, expected] of cases) {
    test(`"${message.slice(0, 40)}…" → ${expected}`, () => {
      assert.equal(classifyError(message), expected);
    });
  }
});
