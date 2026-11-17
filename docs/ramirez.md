# Ramirez

Ramirez reconciles selected Aha records with DPJ work packages. It reads,
compares, and proposes. It does not write to Aha or DPJ.

The reconciliation slice is still Aha ↔ DPJ only. Mural and Figma now have
evidence normalizers (and Mural has a production MCP adapter) so named boards
or Figma URLs can be read as evidence. They are not identity-matched to Aha
or DPJ yet. Azure DevOps and GitHub remain not queried.

## Mode

`PROPOSAL_ONLY`. Every result includes:

`No changes have been applied. Ramirez is operating in PROPOSAL_ONLY mode.`

A proposal is created only when the relationship is `CONFIRMED`, a field
differs, and `bot/lib/ramirez/config.ts` names an authority for that field.
The default config names no authority, so the default path creates no
proposals. `applied` is always `false`.

The DPJ write skill at `.cursor/skills/dpj-write-records/` stays on disk.
Ramirez does not import it.

## Flow

1. The user names at most five Aha references or five DPJ work package IDs.
2. `reconcile_planning` reads those records through the Aha and DPJ adapters.
3. `bot/lib/ramirez/reconcile.ts` decides relationship, alignment,
   discrepancy, and proposal. It cites evidence IDs and rule IDs from
   `bot/lib/ramirez/rules.ts`.
4. `bot/lib/ramirez/report.ts` copies that result into `report`. It does not
   score or classify.
5. The reply is the `report` field.

Matching order is fixed: deterministic identity, then metadata, then a
lexical fallback. Metadata and the lexical fallback never confirm identity.

## Identity conventions

Both conventions are enabled and not verified. A link that uses only one of
them stays `PROBABLE`.

| Convention | Where it is documented | Config flag |
| --- | --- | --- |
| `[AHA-REF]` at the start of the DPJ subject | `.cursor/skills/dpj-write-records/SKILL.md` plan example | `conventions.dpjSubjectBracketRef.verified = false` |
| A description line `Aha: https://bayer.aha.io/...` | same plan example | `conventions.dpjDescriptionAhaUrl.verified = false` |

A text mention of an Aha reference is not an identity claim.

## What a search can prove

DPJ `search_work_packages` filters on the subject. It does not search
descriptions or custom fields. When those channels are part of identity and
no candidate is found, the status is `NOT_EVALUATED`, not `MISSING`.

`MISSING` requires every enabled identity channel to be searchable, a
completed untruncated search, an expected counterpart, and no surviving
candidate. The current DPJ search cannot meet that bar.

## Connectors

| System | Adapter | Ramirez may call |
| --- | --- | --- |
| Aha | production | `read_records`, `search_records` |
| DPJ | production | `search_work_packages` |
| Mural | production (evidence) | `search_murals`, `get_mural_info`, `get_canvas_overview`, `get_document_tree`, `list_widgets` |
| Figma | interface only (IDE plugin) | none from the agent; `normalizeFigmaNode` / `parseFigmaUrl` normalize chat-side reads |
| Azure DevOps | none | nothing |
| GitHub | none | nothing |

`bot/lib/ramirez/capabilities.ts` refuses any other tool name before the
host calls it. Aha and DPJ links to Azure DevOps are reported as downstream
links with retrieval state `NOT_RETRIEVED`.

The shared Aha, DPJ, and Mural connections are not narrowed. Those
connections also serve the analysis agent. Narrowing them would remove
tools that agent uses. Ramirez's own calls stay on the allowlist above.

Verified live reads (2026-11-17): Mural `MMC Bi-Weekly`
(`bayer1789.1771356982650`); Figma Product-Profiles
(`Mfpvi8EkGRio9wuSXi5ZzS`) Portfolio Main / Profile Main. No Figma layer
titled "Product Parentage Outline" was found; Aha parentage epics link that
Product-Profiles file.

DPJ `search_work_packages` output has a static schema. A live search result
has not been observed by this code, so the normalizer follows that schema
and records the gap in `unverifiedReads`.

## Security

- Redaction in `bot/lib/ramirez/redact.ts` removes bearer tokens, API keys,
  JWTs, private keys, and email addresses from excerpts and logs.
- No secret is read from the environment by the reconciliation path.
- Write tools stay declared and unused. Ramirez does not call them and does
  not treat a tool name as proof that a write would succeed.

## Test

These commands use fixtures. They do not read a live Aha or DPJ record.

```bash
npm test
npm run check
npx agent-sdk validate --dir .
```

`npm test` runs `node --import tsx --test` on `bot/lib/ramirez/**/*.test.ts`.

A live reconciliation still needs an Aha reference or a DPJ work package ID
from the operator. Do not search for a record in order to test this path.
