import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG, withVerifiedConventions, type VerifiableConventionKind } from "../lib/ramirez/config";
import { reconcileAdo } from "../lib/ramirez/reconcile-ado";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcileAdoPlanningResult = ReconciliationResult & { report: string };

const adoVerify = z.enum([
  "aha_integration_field",
  "aha_description_ado_url",
  "aha_custom_field_ado_url",
  "ado_title_aha_ref",
]);

const adoEvidence = z.object({
  org: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  workItemId: z.string().min(1),
  title: z.string().optional(),
  state: z.string().optional(),
  url: z.string().url().optional(),
  description: z.string().max(4000).optional(),
  note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
  assignedTo: z.string().optional(),
  iteration: z.string().optional(),
  retrievedAt: z.string().datetime().optional(),
});

const ahaRef = z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/, "expected an Aha reference such as VEL-E-3599");

export default defineTool({
  description:
    "Reconcile operator/IDE-supplied Azure DevOps work-item evidence with Aha records. Read-only. Ramirez never opens an ADO connector — pass work-item metadata yourself. Present the report field as the reply.",
  inputSchema: z
    .object({
      ahaReferences: z.array(ahaRef).max(5).optional().describe("Aha reference numbers, at most 5 per call."),
      ado: z.array(adoEvidence).min(1).max(5).describe("ADO evidence collected by the operator/IDE (not by this agent)."),
      expectEngineeringCounterpart: z
        .boolean()
        .default(true)
        .describe("True when the operator expects each planning record / work item to have a counterpart."),
      verifyConventions: z
        .array(adoVerify)
        .optional()
        .describe("Operator: treat these link types as verified identity for this run (CONFIRMED-eligible)."),
    })
    .refine((v) => (v.ahaReferences?.length ?? 0) > 0 || (v.ado?.length ?? 0) > 0, "name at least one Aha reference or supply ADO evidence"),
  effect: "read",
  async execute(input, ctx): Promise<ReconcileAdoPlanningResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const verified = (input.verifyConventions ?? []) as VerifiableConventionKind[];
    const config = withVerifiedConventions(DEFAULT_CONFIG, verified);
    const result = await reconcileAdo(
      {
        ahaRefs: input.ahaReferences ?? [],
        ado: input.ado,
        expectEngineeringCounterpart: input.expectEngineeringCounterpart,
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
