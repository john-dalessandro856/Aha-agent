---
description: Use when the user asks for a full lifecycle compare across Mural research, Aha planning, and Figma mockups in one pass — or to stitch mural→Aha→Figma paths. Requires at least a mural id/URL or IDE-supplied Figma evidence; Aha refs optional but recommended.
---

# Ramirez: lifecycle (Mural ↔ Aha ↔ Figma)

Ramirez runs in PROPOSAL_ONLY mode. Each hop is evaluated independently.
A CONFIRMED mural↔Aha link does not confirm Figma↔Aha or mural↔Figma.

## Before calling

1. Gather mural ids/URLs the user named.
2. Gather Aha references if named (or let mural title refs discover them).
3. For Figma: use the IDE Figma plugin (`create_session` → `get_metadata`)
   and fill the `figma` array. Never open Figma MCP from the agent.

## Inputs

- Call `reconcile_lifecycle` with mural ids and/or `figma` evidence (at
  least one side required), plus optional `ahaReferences`.
- `includeMuralFigmaHop` defaults true when both mural and Figma are
  present.
- Pass `verifyConventions` for any link kinds the operator trusts this run
  (includes `mural_description_figma_url` for research→design URLs).

## Output

Present the tool's `report` field as the reply. It includes **Lifecycle
paths** when the same Aha record appears in both mural and Figma hops.
Do not rewrite statuses or scores.

## Do not

- Call DPJ, Azure DevOps, or GitHub for this task.
- Treat sticky text or Figma screenshots as identity.
