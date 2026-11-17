import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG, withVerifiedConventions, type VerifiableConventionKind } from "../lib/ramirez/config";
import { reconcileMural } from "../lib/ramirez/reconcile-mural";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, createMuralMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcileMuralPlanningResult = ReconciliationResult & { report: string };

const muralVerify = z.enum(["aha_description_mural_url", "aha_custom_field_mural_url", "mural_title_aha_ref"]);

export default defineTool({
  description:
    "Reconcile selected Mural boards with Aha records. Read-only. Sticky text is evidence context only, never identity. Returns the structured result and a report. Use when the user names mural ids/URLs and/or Aha references for research↔planning comparison. Present the report field as the reply.",
  inputSchema: z
    .object({
      muralIds: z
        .array(z.string().min(3))
        .max(3)
        .optional()
        .describe("Mural ids such as bayer1789.1771356982650, or member URLs."),
      ahaReferences: z
        .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/, "expected an Aha reference such as VEL-E-3599"))
        .max(5)
        .optional()
        .describe("Aha reference numbers, at most 5 per call."),
      expectPlanningCounterpart: z
        .boolean()
        .default(false)
        .describe("True when the operator expects the mural to map to named Aha work."),
      includeStickyExcerpts: z
        .boolean()
        .default(false)
        .describe("If true, fetch document_tree excerpts as context only (not identity)."),
      verifyConventions: z
        .array(muralVerify)
        .optional()
        .describe("Operator: treat these link types as verified identity for this run (CONFIRMED-eligible)."),
    })
    .refine((v) => (v.muralIds?.length ?? 0) + (v.ahaReferences?.length ?? 0) > 0, "name at least one mural or Aha reference"),
  effect: "read",
  async execute(input, ctx): Promise<ReconcileMuralPlanningResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const verified = (input.verifyConventions ?? []) as VerifiableConventionKind[];
    const config = withVerifiedConventions(DEFAULT_CONFIG, verified);
    const result = await reconcileMural(
      {
        muralIds: input.muralIds ?? [],
        ahaRefs: input.ahaReferences ?? [],
        expectPlanningCounterpart: input.expectPlanningCounterpart,
        includeStickyExcerpts: input.includeStickyExcerpts,
      },
      {
        aha: createAhaMcpAdapter(mcp, config),
        mural: createMuralMcpAdapter(mcp, config),
        session,
        config,
        now: () => new Date().toISOString(),
      },
    );
    return { ...result, report: renderReport(result) };
  },
});
