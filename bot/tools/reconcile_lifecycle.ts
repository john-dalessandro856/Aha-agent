import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG, withVerifiedConventions, type VerifiableConventionKind } from "../lib/ramirez/config";
import { reconcileLifecycle } from "../lib/ramirez/reconcile-lifecycle";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, createMuralMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcileLifecycleResult = ReconciliationResult & { report: string };

const verifyKind = z.enum([
  "aha_description_mural_url",
  "aha_custom_field_mural_url",
  "mural_title_aha_ref",
  "mural_description_figma_url",
  "aha_description_figma_url",
  "aha_custom_field_figma_url",
  "figma_title_aha_ref",
]);

const figmaEvidence = z.object({
  fileKey: z.string().min(10),
  fileName: z.string().optional(),
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  pages: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  url: z.string().url().optional(),
  note: z.string().max(2000).optional(),
  retrievedAt: z.string().datetime().optional(),
});

export default defineTool({
  description:
    "Phase 5 lifecycle reconcile: run independent Mural↔Aha and/or Figma↔Aha hops, stitch shared Aha paths, and optionally assess Mural↔Figma. Figma evidence must be IDE-supplied. Present the report field as the reply.",
  inputSchema: z
    .object({
      muralIds: z.array(z.string().min(3)).max(3).optional().describe("Mural ids or member URLs."),
      ahaReferences: z
        .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/))
        .max(5)
        .optional(),
      figma: z.array(figmaEvidence).max(5).optional().describe("IDE-supplied Figma evidence (no agent Figma MCP)."),
      expectPlanningCounterpart: z.boolean().default(false),
      expectDesignCounterpart: z.boolean().default(true),
      includeStickyExcerpts: z.boolean().default(false),
      includeMuralFigmaHop: z.boolean().default(true).describe("Assess direct mural↔Figma when both are in scope."),
      verifyConventions: z.array(verifyKind).optional(),
    })
    .refine((v) => (v.muralIds?.length ?? 0) + (v.figma?.length ?? 0) > 0, "name at least one mural or supply Figma evidence"),
  effect: "read",
  async execute(input, ctx): Promise<ReconcileLifecycleResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const verified = (input.verifyConventions ?? []) as VerifiableConventionKind[];
    const config = withVerifiedConventions(DEFAULT_CONFIG, verified);
    const result = await reconcileLifecycle(
      {
        muralIds: input.muralIds ?? [],
        ahaRefs: input.ahaReferences ?? [],
        figma: input.figma ?? [],
        expectPlanningCounterpart: input.expectPlanningCounterpart,
        expectDesignCounterpart: input.expectDesignCounterpart,
        includeStickyExcerpts: input.includeStickyExcerpts,
        includeMuralFigmaHop: input.includeMuralFigmaHop,
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
