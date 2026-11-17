import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG } from "../lib/ramirez/config";
import { reconcile } from "../lib/ramirez/reconcile";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, createDpjMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcilePlanningResult = ReconciliationResult & { report: string };

export default defineTool({
  description:
    "Reconcile selected Aha records with DPJ (OpenProject) work packages. Read-only. Returns the structured result and a report that copies it. Never writes to Aha or DPJ. Use only when the user names Aha references or DPJ work package IDs. Present the report field as the reply.",
  inputSchema: z
    .object({
      ahaReferences: z
        .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/, "expected an Aha reference such as VEL-E-3599"))
        .max(5)
        .optional()
        .describe("Aha reference numbers, at most 5 per call."),
      dpjWorkPackageIds: z.array(z.number().int().positive()).max(5).optional().describe("Numeric DPJ work package IDs, at most 5 per call."),
      expectDpjCounterpart: z
        .boolean()
        .default(true)
        .describe("True when the Aha records are in migration scope and should have a DPJ counterpart."),
    })
    .refine((v) => (v.ahaReferences?.length ?? 0) + (v.dpjWorkPackageIds?.length ?? 0) > 0, "select at least one Aha reference or DPJ work package ID"),
  effect: "read",
  async execute(input, ctx): Promise<ReconcilePlanningResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const config = DEFAULT_CONFIG;
    const result = await reconcile(
      {
        ahaRefs: input.ahaReferences ?? [],
        dpjIds: (input.dpjWorkPackageIds ?? []).map(String),
        expectDpjCounterpart: input.expectDpjCounterpart,
      },
      {
        aha: createAhaMcpAdapter(mcp, config),
        dpj: createDpjMcpAdapter(mcp, config),
        session,
        config,
        now: () => new Date().toISOString(),
      },
    );
    return { ...result, report: renderReport(result) };
  },
});
