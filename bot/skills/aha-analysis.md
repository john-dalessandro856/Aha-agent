---
description: Use when the user wants a deep analysis of Aha records — insights across a topic, release, or epic; open or unanswered questions; duplicates or overlap; requirement gaps; dependencies; or a comparison of related items.
---

# Aha record analysis

## 1. Scope the evidence

1. Restate the scope in one line: a topic, a release, a workspace, or
   specific reference numbers.
2. Search Aha with 2–4 phrasings of the topic (synonyms, product names,
   acronyms). One search misses records.
3. Fetch the full detail of each relevant record. Include its parent, its
   children, linked records, and comments.
4. Stop at about 25 records. If more match, say how you narrowed the set.

## 2. Find unanswered questions

Check each record for these signals. Report each hit as a question, not a
verdict.

| Signal | Example question |
| --- | --- |
| A question in the description or comments with no later reply | "Who owns data retention for X? (asked in ABC-12, no answer)" |
| TBD, TBC, "to be decided", "pending", "open item", "?" | "Which region launches first? (ABC-40 says TBD)" |
| No acceptance criteria, or criteria that cannot be tested | "What does 'fast' mean for ABC-7?" |
| Empty key fields: owner, release, due date, estimate, business value | "ABC-9 has no release. When does it ship?" |
| Business need stated, but no feature or requirement covers it | "Which feature delivers the audit need in INIT-3?" |
| Records that contradict each other | "ABC-5 says SSO only; ABC-8 adds passwords. Which holds?" |
| A dependency that is named but not linked or not scheduled | "ABC-4 needs the API from team Y. Is it planned?" |
| Status out of step with content (shipped but open questions remain) | "ABC-2 is Done, but its comments raise an unresolved edge case." |

Rank questions by impact: blocks delivery > changes scope > clarifies
detail.

## 3. Draw insights

- **Overlap:** records with similar goals or descriptions. Explain what is
  the same and what differs. Say whether they are duplicates or
  complementary.
- **Gaps:** need versus implementation. Name what the business asks for
  and what no record yet delivers.
- **Dependencies:** cross-team or cross-record. Note which are linked in
  Aha and which you inferred from text.
- **Existing functionality:** when a request may already be delivered by a
  shipped record, cite that record.
- **Themes:** patterns across records (repeated customer asks, recurring
  blockers, owners with too much work).

## 4. Report

Use the output shape in the instructions. For each unanswered question,
give the reference number, the evidence (a short quote or a field state),
and a suggested owner when a record names one.

End with a short **Coverage** line: records reviewed, searches run, and
anything you could not access.
