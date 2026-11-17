// Renders a ReconciliationResult. It copies fields and omits empty
// sections. It does not score, classify, or propose.
import type { AlignmentAssessment, ReconciliationResult, RelationshipAssessment } from "./types";

function label(key: string | undefined): string {
  if (!key) return "(none)";
  const split = key.indexOf(":");
  if (split < 0) return key;
  const system = key.slice(0, split);
  const id = key.slice(split + 1);
  if (system === "aha") return `Aha ${id}`;
  if (system === "dpj") return `DPJ ${id}`;
  return `${system} ${id}`;
}

function relationshipLine(rel: RelationshipAssessment): string {
  const score = rel.score === null ? "none" : String(rel.score);
  const rules = rel.ruleRefs.length ? rel.ruleRefs.join(", ") : "none";
  const identityNote = rel.method === "METADATA" || rel.method === "SEMANTIC" ? " This match is not identity." : "";
  const missing = rel.missingEvidence.length ? ` Missing evidence: ${rel.missingEvidence.join("; ")}.` : "";
  return `${label(rel.source)} ↔ ${label(rel.target)}: ${rel.status} (score ${score}, method ${rel.method}, rules ${rules}). ${rel.explanation}${identityNote}${missing}`;
}

function alignmentBlock(alignment: AlignmentAssessment, relationships: RelationshipAssessment[]): string {
  const rel = relationships.find((r) => r.id === alignment.relationshipRef);
  const pair = rel ? `${label(rel.source)} ↔ ${label(rel.target)}` : alignment.relationshipRef;
  const lines = alignment.comparisons
    .filter((c) => c.result !== "EQUAL")
    .map((c) => `- ${c.field}: ${c.result}. Aha ${JSON.stringify(c.sourceValue)}. DPJ ${JSON.stringify(c.targetValue)}.${c.note ? ` ${c.note}` : ""}`);
  return [`${pair}: ${alignment.status}`, ...lines, alignment.explanation].join("\n");
}

/** User-facing report. Every status, score, and proposal comes from `result`. */
export function renderReport(result: ReconciliationResult): string {
  const sections: string[] = [result.statement];

  const queried = result.systemsQueried.length ? result.systemsQueried.join(", ") : "none";
  const notQueried = result.systemsNotQueried.map((s) => `${s.system}: ${s.reason}`).join("\n");
  const requested = [
    result.scope.aha.length ? `Aha ${result.scope.aha.join(", ")}` : "",
    result.scope.dpj.length ? `DPJ ${result.scope.dpj.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  sections.push(["## Scope", `Records requested: ${requested || "none"}.`, `Systems queried: ${queried}.`, "Systems not queried:", notQueried].join("\n"));

  if (result.relationships.length) {
    sections.push(["## Relationships", ...result.relationships.map(relationshipLine)].join("\n"));
  }
  if (result.alignments.length) {
    sections.push(["## Alignment", ...result.alignments.map((a) => alignmentBlock(a, result.relationships))].join("\n\n"));
  }
  if (result.discrepancies.length) {
    const blocks = result.discrepancies.map((d) => {
      const values = d.values.map((v) => `- ${v.artifact} ${v.field} = ${v.value === null ? "null" : JSON.stringify(v.value)}`).join("\n");
      const authority = d.authority === "UNKNOWN" ? "UNKNOWN" : `${d.authority.system} (${d.authority.basis})`;
      return [`${d.id} ${d.kind} ${d.severity}`, values, `Authority: ${authority}.`, `Recommended resolution: ${d.recommendedResolution}`].filter(Boolean).join("\n");
    });
    sections.push(["## Discrepancies", ...blocks].join("\n\n"));
  }
  if (result.proposals.length) {
    const blocks = result.proposals.map(
      (p) =>
        `${p.proposalId}: target ${p.targetRecord}, field ${p.field}, existing ${JSON.stringify(p.existingValue)}, proposed ${JSON.stringify(p.proposedValue)}. applied: ${p.applied}. Approval: ${p.approvalRequirement}`,
    );
    sections.push(["## Proposals", "None of these proposals was applied.", ...blocks].join("\n"));
  }
  if (result.downstreamLinks.length) {
    const lines = result.downstreamLinks.map((l) => `${l.source} → ${l.targetSystem}${l.targetId ? ` ${l.targetId}` : ""}: ${l.retrievalState}. ${l.note}`);
    sections.push(["## Downstream links", ...lines].join("\n"));
  }
  if (result.limitations.length) {
    sections.push(["## Limitations", ...result.limitations.map((l) => `- ${l}`)].join("\n"));
  }

  return sections.join("\n\n");
}
