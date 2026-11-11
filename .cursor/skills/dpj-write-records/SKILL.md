---
name: dpj-write-records
description: >-
  Create and update Bayer DPJ (OpenProject) work packages through the REST API:
  epics, features, user stories, tasks, test cases, parent/child trees,
  relations (blocks, relates, follows), comments, estimates, story points, and
  status changes. Use when the user asks to create, update, close, relate, or
  bulk-recreate DPJ records, because the DPJ MCP plugin is read-only.
---

# Write DPJ records

The `dpj-openproject` MCP plugin only searches and lists. All writes go through
`scripts/dpj.mjs` (Node 22+, no deps) against `https://dpj.int.bayer.com/api/v3`.

## Setup

- Token: `OPENPROJECT_API_KEY` in the environment or in `.env.local` in the
  current directory (gitignored). DPJ > Avatar > Account settings > Access
  tokens > API. Never echo it, pass it on argv, or read `.env.local` aloud.
- Run from the repo root so `.env.local` is found. Node needs
  `--use-system-ca` (already in `NODE_OPTIONS` on this machine) for Bayer's
  TLS proxy.
- Exit 5 means missing token, 401, or 403: stop and tell the user. Do not retry
  with other credentials.

## Workflow

1. **Resolve IDs read-only first.** Use the MCP plugin (`list_types`,
   `list_statuses`, `search_users`, `search_projects`) and
   `node .cursor/skills/dpj-write-records/scripts/dpj.mjs me`.
2. **Check the project form** for allowed types and writable fields such as
   `storyPoints` or `customFieldN`:
   `node .cursor/skills/dpj-write-records/scripts/dpj.mjs schema <projectId> <typeId>`
   If a needed type is not allowed, stop and report it; do not substitute.
3. **Write a plan file** (shape below), outside the repo or in the agent store.
4. **Dry run** and show the output to the user:
   `node .cursor/skills/dpj-write-records/scripts/dpj.mjs apply <plan.json>`
5. **Apply** only after the user approves:
   `node .cursor/skills/dpj-write-records/scripts/dpj.mjs apply <plan.json> --apply`
6. **Verify** with `dpj.mjs get <id>` or MCP `search_work_packages`, and report
   each created ID as `https://dpj.int.bayer.com/work_packages/<id>`.

`apply` is idempotent. It records created IDs and finished steps in
`<plan>.state.json` and skips them on rerun, so after a failure fix the plan
and rerun the same command.

## Plan file

```json
{
  "project": 178,
  "items": [
    { "key": "epic", "subject": "[VEL-E-1] Program epic", "type": 5,
      "assignee": 1979, "startDate": "2026-01-01", "dueDate": "2026-08-28",
      "description": "Aha: https://bayer.aha.io/epics/VEL-E-1", "status": 12 },
    { "key": "feat1", "subject": "[MMC-1] Feature", "type": 4, "parent": "@epic",
      "storyPoints": 5, "estimatedTime": 240, "remainingTime": 0, "status": 12 }
  ],
  "updates":   [ { "target": 1234, "fields": { "dueDate": "2026-09-01" } } ],
  "relations": [ { "from": "@epic", "type": "blocks", "to": 5678 } ],
  "comments":  [ { "on": "@feat1", "text": "Deferred to VEL-E-3851" } ]
}
```

- `items` are created in file order, so list parents before children.
  `parent`, `from`, `to`, `on`, and `target` take a numeric ID or `"@key"`.
- `type`, `status`, and `assignee` are numeric IDs. `estimatedTime` and
  `remainingTime` are hours (number) or ISO 8601 durations (`"PT8H"`).
- `fields` merges raw API fields (for example `"customField12": "x"`);
  `links` merges raw `_links` (for example `"version": { "href": "/api/v3/versions/9" }`).
- Items are created in the default status. Statuses are set after relations and
  comments, children first, so a parent never closes before its children.
- Relation types: `relates`, `blocks`, `blocked`, `precedes`, `follows`,
  `includes`, `partof`, `requires`, `required`, `duplicates`, `duplicated`.

## DPJ reference IDs

Types: Task 1, Milestone 2, Feature 4, Epic 5, User story 6, Bug 7,
Initiative 39, Enabler 41, Release 42, Test Case 45.
Statuses: New 1, In specification 2, Specified 3, Confirmed 4, In progress 7,
Developed 8, In testing 9, Tested 10, Test failed 11, Closed 12, On hold 13,
Rejected 14, Completed 67, In Review 70.
Re-check with MCP `list_types` / `list_statuses` if a write is rejected.

## Safety

- Write only what the user asked for. One plan per request scope; no edits
  outside it.
- Never delete work packages or relations unless the user explicitly asks.
- Aha, Mural, and Figma stay read-only.
- On 409 (stale `lockVersion`) the script re-reads before each PATCH; if it
  still fails, report it instead of looping.
- On 422, read the validation message (required field, disallowed type or
  status transition) and fix the plan.
