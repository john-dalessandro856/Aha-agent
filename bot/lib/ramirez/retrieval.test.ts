import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAhaMcpAdapter, createDpjMcpAdapter, RetrievalSession, type McpCallResult, type McpClient } from "./retrieval";
import { config, NOW } from "./fixtures";
import { reconcile } from "./reconcile";
import { MUTATION_MODE } from "./types";

const ALLOWED = new Set(["read_records", "search_records", "search_work_packages"]);

/** Fake MCP host. Records every call; exposes write-capable tools so the gate is exercised. */
function fakeMcp(opts: { dpjLoaded?: boolean; dpjError?: string; ahaRecord?: Record<string, unknown>; dpjItems?: unknown[] } = {}) {
  const calls: Array<{ connection: string; tool: string }> = [];
  const tools: Record<string, string[]> = {
    aha: ["read_records", "search_records", "update_records", "create_records", "manage_report"],
    dpj: ["search_work_packages", "update_work_package", "create_work_package", "add_relation"],
  };
  const client: McpClient = {
    names: () => (opts.dpjLoaded === false ? ["aha"] : ["aha", "dpj"]),
    async listTools(connection) {
      return (tools[connection] ?? []).map((name) => ({ name }));
    },
    async callTool(connection, tool): Promise<McpCallResult> {
      calls.push({ connection, tool });
      if (connection === "dpj" && opts.dpjError) return { content: [{ type: "text", text: opts.dpjError }], isError: true };
      if (tool === "read_records") {
        return { content: [{ type: "text", text: JSON.stringify({ result: { results: opts.ahaRecord ? [opts.ahaRecord] : [] } }) }] };
      }
      if (tool === "search_records") return { content: [{ type: "text", text: JSON.stringify({ result: { results: [] } }) }] };
      if (tool === "search_work_packages") {
        return { content: [{ type: "text", text: JSON.stringify({ items: opts.dpjItems ?? [] }) }] };
      }
      return { content: [{ type: "text", text: "unexpected" }], isError: true };
    },
  };
  return { client, calls };
}

const AHA_RAW = {
  reference_num: "VEL-E-70",
  name: "Gateway epic",
  record_type: "epic",
  url: "https://bayer.aha.io/epics/VEL-E-70",
  description: "Gateway scope",
  workflow_status: { name: "In progress" },
  assigned_to_user: { name: "Alex Owner" },
  project: { name: "Velocity", reference_prefix: "VEL" },
  custom_fields: [],
  integration_fields: [],
};

describe("MCP-backed adapters", () => {
  test("the Aha adapter reads through read_records only and normalizes the result", async () => {
    const { client, calls } = fakeMcp({ ahaRecord: AHA_RAW });
    const adapter = createAhaMcpAdapter(client, config(), () => NOW);
    const session = new RetrievalSession(() => NOW);
    const res = await session.run("aha", "read_records", "VEL-E-70", "test", () => adapter.getById("VEL-E-70"));
    assert.equal(res.state, "AVAILABLE");
    assert.equal(res.value?.title?.value, "Gateway epic");
    assert.deepEqual(calls.map((c) => c.tool), ["read_records"]);
  });

  test("the DPJ adapter searches only with search_work_packages and returns candidate hits", async () => {
    const item = {
      id: 88,
      subject: "[VEL-E-70] Gateway epic",
      _links: { type: { title: "Epic" }, status: { title: "New" } },
      description: { raw: "" },
    };
    const { client, calls } = fakeMcp({ dpjItems: [item] });
    const adapter = createDpjMcpAdapter(client, config(), () => NOW);
    const session = new RetrievalSession(() => NOW);
    const res = await session.run("dpj", "search_work_packages", "subject~VEL-E-70", "test", () => adapter.searchByIdentifier("VEL-E-70"));
    assert.equal(res.state, "AVAILABLE");
    assert.equal(res.value?.[0]?.id, "88");
    assert.ok(res.value?.[0]?.artifact?.links.some((l) => l.targetId === "VEL-E-70" && l.claimsIdentity));
    assert.ok(calls.every((c) => ALLOWED.has(c.tool)));
  });

  test("a DPJ connector error is classified and not treated as absence", async () => {
    const { client } = fakeMcp({ dpjError: "MCP connection \"dpj\" needs authorization. Run npm run connect -- dpj." });
    const adapter = createDpjMcpAdapter(client, config(), () => NOW);
    const res = await new RetrievalSession(() => NOW).run("dpj", "search_work_packages", "subject~X", "t", () => adapter.searchByIdentifier("X"));
    assert.equal(res.state, "INACCESSIBLE");
  });

  test("an unloaded DPJ connection is NOT_RETRIEVED, not NOT_FOUND", async () => {
    const { client } = fakeMcp({ dpjLoaded: false });
    const adapter = createDpjMcpAdapter(client, config(), () => NOW);
    const res = await new RetrievalSession(() => NOW).run("dpj", "search_work_packages", "subject~X", "t", () => adapter.searchByIdentifier("X"));
    assert.equal(res.state, "NOT_RETRIEVED");
  });
});

describe("end-to-end reconciliation through real adapters never calls a write tool", () => {
  test("every MCP call is a read, and the result is proposal-only", async () => {
    const { client, calls } = fakeMcp({ ahaRecord: { ...AHA_RAW, description: "Scope" }, dpjItems: [] });
    const result = await reconcile(
      { ahaRefs: ["VEL-E-70"], dpjIds: [], expectDpjCounterpart: true },
      {
        aha: createAhaMcpAdapter(client, config(), () => NOW),
        dpj: createDpjMcpAdapter(client, config(), () => NOW),
        session: new RetrievalSession(() => NOW),
        config: config(),
        now: () => NOW,
      },
    );
    assert.ok(calls.length > 0, "adapters were exercised");
    assert.ok(calls.every((c) => ALLOWED.has(c.tool)), `non-read calls: ${calls.filter((c) => !ALLOWED.has(c.tool)).map((c) => c.tool).join(", ")}`);
    assert.equal(result.mutationMode, MUTATION_MODE);
    assert.ok(result.proposals.every((p) => p.applied === false));
  });
});
