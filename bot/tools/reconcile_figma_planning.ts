import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG, withVerifiedConventions, type VerifiableConventionKind } from "../lib/ramirez/config";
import { reconcileFigma } from "../lib/ramirez/reconcile-figma";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcileFigmaPlanningResult = ReconciliationResult & { report: string };

const figmaVerify = z.enum(["aha_description_figma_url", "aha_custom_field_figma_url", "figma_title_aha_ref"]);

const figmaEvidence = z.object({
  fileKey: z.string().min(10).describe("Figma file key from the design URL"),
  fileName: z.string().optional(),
  nodeId: z.string().optional().describe("Node id such as 2588:718438"),
  nodeName: z.string().optional(),
  pages: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  url: z.string().url().optional(),
  note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
  retrievedAt: z.string().datetime().optional(),
});

export default defineTool({
  description:
    "Reconcile operator/IDE-supplied Figma evidence with Aha records. Read-only. Ramirez never opens Figma MCP — pass file/node metadata from the IDE Figma plugin. Present the report field as the reply.",
  inputSchema: z.object({
    ahaReferences: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/, "expected an Aha reference such as VEL-E-3599"))
      .max(5)
      .describe("Aha reference numbers, at most 5 per call."),
    figma: z.array(figmaEvidence).min(1).max(5).describe("Figma evidence collected via the IDE plugin (not by this agent)."),
    expectDesignCounterpart: z
      .boolean()
      .default(true)
      .describe("True when the operator expects each planning record / design node to have a counterpart."),
    verifyConventions: z
      .array(figmaVerify)
      .optional()
      .describe("Operator: treat these link types as verified identity for this run (CONFIRMED-eligible)."),
  }),
  effect: "read",
  async execute(input, ctx): Promise<ReconcileFigmaPlanningResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const verified = (input.verifyConventions ?? []) as VerifiableConventionKind[];
    const config = withVerifiedConventions(DEFAULT_CONFIG, verified);
    const result = await reconcileFigma(
      {
        ahaRefs: input.ahaReferences,
        figma: input.figma,
        expectDesignCounterpart: input.expectDesignCounterpart,
      },
      {
        aha: createAhaMcpAdapter(mcp, config),
        session,
        config,
        now: () => new Date().toISOString(),
      },
    );
    return { ...result, report: renderReport(result) };
  },
});
