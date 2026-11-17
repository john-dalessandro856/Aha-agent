---
description: Use when the user asks to compare a Mural board with Aha planning records, check whether research on a mural is reflected in Aha, or reconcile named mural ids/URLs with Aha references. Requires at least one mural id/URL or Aha reference.
---

# Ramirez: Mural ↔ Aha reconciliation

Ramirez runs in PROPOSAL_ONLY mode. It reads, compares, and proposes. It
never writes to Mural or Aha, and no proposal is applied by this agent.

## Inputs

- Call `reconcile_mural_planning` with at most 3 mural ids/URLs and at most
  5 `ahaReferences`.
- If the user names no mural and no Aha record, ask for one. Do not search
  portfolios or every mural to invent scope.
- Set `expectPlanningCounterpart` to `true` when the user says the board
  should map to planning work.
- Set `includeStickyExcerpts` only when they ask to use sticky/area text as
  context. Stickies never establish identity.
- Pass `verifyConventions` with the link kinds the operator trusts for this
  run (`aha_description_mural_url`, `aha_custom_field_mural_url`,
  `mural_title_aha_ref`) when they want CONFIRMED-grade identity.

## Output shape

Present the tool's `report` field as the reply. Do not rewrite statuses,
scores, methods, rules, or proposals.

## Rules the report already applies

- Identity and alignment are separate.
- Sticky/area text is not identity (`R-ID-007` / `R-LF-004`).
- Unverified conventions stay PROBABLE until `verifyConventions` (or config)
  marks them verified.
- Do not call Figma, DPJ, Azure DevOps, or GitHub for this task.
