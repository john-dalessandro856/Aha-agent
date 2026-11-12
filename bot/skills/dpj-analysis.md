---
description: Use when the user wants a deep analysis of DPJ (OpenProject) work packages — insights across a topic, project, or version; open questions; duplicates or overlap; gaps; dependencies; or a comparison with Aha/Mural.
---

# DPJ work package analysis

Bayer DPJ is OpenProject at `https://dpj.int.bayer.com`. Prefer DPJ MCP tools
for every claim. Do not invent work package IDs, subjects, or statuses.

## 1. Scope the evidence

1. Restate the scope in one line: a topic, a project, a version/sprint, an
   assignee, or specific work package IDs (numeric or display IDs).
2. Resolve projects with `search_projects` when the user names a product or
   team. Resolve types and statuses with `list_types` / `list_statuses` when
   those names matter to the question.
3. Search with `search_work_packages` using 2–4 phrasings (synonyms, product
   names, acronyms). One search misses records.
4. When there are more than 5 candidates, triage from the result list first
   (subject, type, status, assignee, dates). Then search by ID for at most 6
   shortlisted packages. List the rest as "triaged, not read".
5. If the request has no scope and hits span many projects, ask the user to
   narrow (project, version, type, assignee, or specific IDs) before deep
   reads.

## 2. Follow links

For each shortlisted package, use the fields `search_work_packages` returns:
parent, version, assignee, priority, and status. Resolve a version with
`search_versions` and a person with `search_users`. The DPJ tools do not
return comments or relations; say so when the question needs them.

## 3. Find unanswered questions

Check each package for these signals. Report each hit as a question, not a
verdict.

| Signal | Example question |
| --- | --- |
| A question in the description or comments with no later reply | "Who owns data retention for X? (asked on WP 123, no answer)" |
| TBD, TBC, "to be decided", "pending", "open item", "?" | "Which region launches first? (WP 40 says TBD)" |
| No acceptance criteria, or criteria that cannot be tested | "What does 'fast' mean for WP 7?" |
| Empty key fields: assignee, version, due date, estimate | "WP 9 has no version. When does it ship?" |
| Need stated, but no child or related package covers it | "Which task delivers the audit need in WP 3?" |
| Packages that contradict each other | "WP 5 says SSO only; WP 8 adds passwords. Which holds?" |
| A dependency named but not linked or not scheduled | "WP 4 needs the API from team Y. Is it planned?" |
| Status out of step with content | "WP 2 is Closed, but comments raise an unresolved edge case." |

Rank questions by impact: blocks delivery > changes scope > clarifies detail.

## 4. Draw insights

- **Overlap:** similar subjects or descriptions. Say whether they are
  duplicates or complementary.
- **Gaps:** need versus implementation.
- **Dependencies:** linked relations versus inferred-from-text only.
- **Existing functionality:** cite a closed/shipped package when the ask may
  already be done.
- **Themes:** repeated asks, blockers, overloaded assignees.

## 5. Report

Use the output shape in the instructions. Cite every finding with the DPJ
work package ID (and subject). For each unanswered question, give the ID, a
short evidence quote or field state, and a suggested owner when one is named.

End with a short **Coverage** line: searches run, candidates triaged,
packages read in detail, and anything you could not access.

When comparing with Aha or Mural, pull each system with its own tools and
label which system each finding came from. Figma is not available here —
use the IDE Figma plugin instead.
