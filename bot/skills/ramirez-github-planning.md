---
description: Use when the user asks to compare GitHub issues/PRs/commits with Aha planning records. Requires Aha references plus GitHub evidence supplied by the operator/IDE (Ramirez never binds GitHub into agent MCP).
---

# Ramirez: GitHub ↔ Aha reconciliation

Ramirez runs in PROPOSAL_ONLY mode. It never writes to GitHub or Aha, and it
never opens GitHub MCP. Implementation evidence must come from the operator
or IDE.

## Before calling the tool

1. Collect issue/PR/commit metadata: `owner`, `repo`, `kind`, and
   `number` (issue/PR) or `sha` (commit). Add `title`, `state`, `url`,
   `body` / `note` when known.
2. If the user gave a github.com URL, parse owner/repo/kind/number or sha.
3. Fill the `github` array. Do not invent issue numbers or SHAs.
4. Commit messages and branch names are context only — never identity.

## Inputs

- Call `reconcile_github_planning` with 1–5 Aha references and/or 1–5
  GitHub evidence objects.
- Set `expectImplementationCounterpart` false when the operator says a
  record is out of implementation scope.
- Pass `verifyConventions` (`aha_description_github_url`,
  `aha_custom_field_github_url`, `github_title_aha_ref`) when the operator
  trusts those link types for this run.

## Output shape

Present the tool's `report` field as the reply. Do not rewrite statuses,
scores, methods, rules, or proposals.

## Rules the report already applies

- GitHub was not queried by Ramirez; evidence is operator/IDE-supplied.
- Unverified conventions stay PROBABLE until verified for the run.
- Do not call Mural, DPJ, Figma, or Azure DevOps for this task.
- Never add GitHub to `READ_TOOL_ALLOWLIST` or agent MCP connections.
