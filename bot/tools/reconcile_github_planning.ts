import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { DEFAULT_CONFIG, withVerifiedConventions, type VerifiableConventionKind } from "../lib/ramirez/config";
import { reconcileGithub } from "../lib/ramirez/reconcile-github";
import { renderReport } from "../lib/ramirez/report";
import { createAhaMcpAdapter, RetrievalSession } from "../lib/ramirez/retrieval";
import type { ReconciliationResult } from "../lib/ramirez/types";

export type ReconcileGithubPlanningResult = ReconciliationResult & { report: string };

const githubVerify = z.enum(["aha_description_github_url", "aha_custom_field_github_url", "github_title_aha_ref"]);

const githubEvidence = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    kind: z.enum(["issue", "pr", "commit"]),
    number: z.number().int().positive().optional().describe("Issue or PR number"),
    sha: z.string().min(7).optional().describe("Commit SHA when kind=commit"),
    title: z.string().optional(),
    state: z.string().optional(),
    url: z.string().url().optional(),
    body: z.string().max(4000).optional(),
    note: z.string().max(2000).optional().describe("Short operator/IDE summary; not free-form authority"),
    branch: z.string().optional(),
    retrievedAt: z.string().datetime().optional(),
  })
  .refine((v) => (v.kind === "commit" ? !!v.sha : v.number !== undefined), "commit requires sha; issue/pr require number");

const ahaRef = z.string().regex(/^[A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\d+(?:-\d+)?$/, "expected an Aha reference such as VEL-E-3599");

export default defineTool({
  description:
    "Reconcile operator/IDE-supplied GitHub issue/PR/commit evidence with Aha records. Read-only. Ramirez never opens GitHub MCP — pass metadata yourself. Present the report field as the reply.",
  inputSchema: z
    .object({
      ahaReferences: z.array(ahaRef).max(5).optional().describe("Aha reference numbers, at most 5 per call."),
      github: z.array(githubEvidence).min(1).max(5).describe("GitHub evidence collected by the operator/IDE (not by this agent)."),
      expectImplementationCounterpart: z
        .boolean()
        .default(true)
        .describe("True when the operator expects each planning record / GitHub artifact to have a counterpart."),
      verifyConventions: z
        .array(githubVerify)
        .optional()
        .describe("Operator: treat these link types as verified identity for this run (CONFIRMED-eligible)."),
    })
    .refine(
      (v) => (v.ahaReferences?.length ?? 0) > 0 || (v.github?.length ?? 0) > 0,
      "name at least one Aha reference or supply GitHub evidence",
    ),
  effect: "read",
  async execute(input, ctx): Promise<ReconcileGithubPlanningResult> {
    const session = new RetrievalSession();
    const mcp = ctx.host.mcp;
    const verified = (input.verifyConventions ?? []) as VerifiableConventionKind[];
    const config = withVerifiedConventions(DEFAULT_CONFIG, verified);
    const result = await reconcileGithub(
      {
        ahaRefs: input.ahaReferences ?? [],
        github: input.github,
        expectImplementationCounterpart: input.expectImplementationCounterpart,
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
