---
description: Use when the user asks to create, update, assign, comment on, relate, or otherwise change DPJ (OpenProject) work packages or time entries.
---

# DPJ create and update

Bayer DPJ is OpenProject at `https://dpj.int.bayer.com`. Use DPJ MCP write
tools only. Do not invent REST bodies when MCP covers the action. Aha, Mural,
and Figma stay read-only — refuse writes there.

## Before any write

1. Confirm the target: project (for create), work package ID (for update),
   and the fields to change. If the request is ambiguous, ask one clarifying
   question instead of guessing.
2. Resolve names to IDs with read tools first:
   - project → `search_projects`
   - type → `list_types`
   - status → `list_statuses`
   - assignee → `search_users`
   - version → `search_versions`
   - custom fields → `search_custom_fields` / `search_custom_field_items`
3. For updates, fetch the current package first so you have a current
   `lock_version` (or whatever the `update_work_package` schema requires).
   On conflict, re-fetch and retry once.
4. If the user did not explicitly ask to mutate ("create", "update", "assign",
   "comment", "close", "set status", …), do not write — analyze only.

## Create

Use `create_work_package` with at least project, subject, and type. Add
description, status, priority, assignee, dates, and custom fields only when
the user provided them or confirmed defaults.

After create, report the new work package ID, subject, project, and a link
shape `https://dpj.int.bayer.com/work_packages/<id>` when you have a numeric
id.

## Update

Use `update_work_package` for field changes. Prefer the smallest patch that
matches the request. Use `create_work_package_comment` for comments instead
of stuffing commentary into the description. Use relation tools for
depends/blocks/relates links.

## Safety

- One clear mutating intent per turn when possible. Summarize what you will
  change, then do it when the user already authorized those fields.
- Do not bulk-edit dozens of packages unless the user explicitly asked for
  that scope and named the selection rule.
- Do not delete relations or time entries unless the user explicitly asked.
- On 401/403, stop and tell the operator the API token lacks permission or
  MCP scope — do not retry with different credentials.
- Eval / dry-run sessions: if a write is stubbed or blocked, report that and
  do not pretend the change landed.

## Report

Under **Changes made**, list each create/update with ID, fields changed, and
any follow-up the user still needs to do in the DPJ UI.
