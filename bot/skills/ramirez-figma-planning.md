---
description: Use when the user asks to compare Figma mockups with Aha planning records. Requires Aha references plus Figma file/node evidence from the IDE Figma plugin (this agent has no Figma connection).
---

# Ramirez: Figma ↔ Aha reconciliation

Ramirez runs in PROPOSAL_ONLY mode. It never writes to Figma or Aha, and it
never opens Figma MCP. Design evidence must come from the IDE Figma plugin
in this chat (or from the operator).

## Before calling the tool

1. If the user gave a Figma URL, parse `fileKey` and optional `node-id`.
2. Use the IDE Figma plugin: `create_session` → `get_metadata` (pages /
   node). Optional `get_screenshot` is for human context only — do not treat
   OCR or screenshot text as identity.
3. Fill the `figma` array with `fileKey`, and when known `fileName`,
   `nodeId`, `nodeName`, `pages`, and a short `note`.

If Figma tools are unavailable, say so and stop. Do not invent file keys.

## Inputs

- Call `reconcile_figma_planning` with 1–5 Aha references and 1–5 Figma
  evidence objects.
- Set `expectDesignCounterpart` false when the operator says a record is
  out of design scope.
- Pass `verifyConventions` (`aha_description_figma_url`,
  `aha_custom_field_figma_url`, `figma_title_aha_ref`) when the operator
  trusts those link types for this run.

## Output shape

Present the tool's `report` field as the reply. Do not rewrite statuses,
scores, methods, rules, or proposals.

## Rules the report already applies

- Figma was not queried by Ramirez; evidence is operator/IDE-supplied.
- Unverified conventions stay PROBABLE until verified for the run.
- Do not call Mural, DPJ, Azure DevOps, or GitHub for this task.
