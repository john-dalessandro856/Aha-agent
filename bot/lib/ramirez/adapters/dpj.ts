// Normalizes one DPJ (OpenProject) work package from `search_work_packages`.
// Field names follow the plugin's declared output schema (HAL `_links`).
import type { RamirezConfig } from "../config";
import { excerpt } from "../redact";
import { AHA_REF, bracketPrefixRef, isAhaRef } from "../text";
import type { Artifact, CrossSystemLink, Field, Provenance } from "../types";

type Obj = Record<string, unknown>;
const ADAPTER = "dpj-mcp-search_work_packages@1";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : undefined);
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const hrefId = (link: Obj | undefined): string | undefined => str(link?.href)?.split("/").filter(Boolean).pop();

export function ahaUrlPattern(config: RamirezConfig): RegExp {
  const host = config.aha.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\./g, "\\.");
  return new RegExp(`https?://${host}/[^\\s)"'<>]*?/([A-Z][A-Z0-9]{1,11}-(?:[A-Z]{1,3}-)?\\d+(?:-\\d+)?)\\b`, "g");
}

export function normalizeDpjWorkPackage(raw: unknown, config: RamirezConfig, retrievedAt: string, method = "search_work_packages"): Artifact {
  const w = obj(raw) ?? {};
  const links = obj(w._links) ?? {};
  const sourceId = str(w.id) ?? "unknown";
  const url = `${config.dpj.baseUrl.replace(/\/$/, "")}/work_packages/${sourceId}`;
  const prov = (field: string, value?: string): Provenance => ({
    system: "dpj",
    sourceRecordId: sourceId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    sourceUrl: url,
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  const subject = str(w.subject);
  const description = str(obj(w.description)?.raw) ?? (typeof w.description === "string" ? w.description : undefined);
  const displayId = str(w.displayId);
  const type = obj(links.type);
  const status = obj(links.status);
  const assignee = obj(links.assignee);
  const project = obj(links.project);
  const version = obj(links.version);
  const parent = obj(links.parent);

  const out: CrossSystemLink[] = [];
  const externalIds: Artifact["externalIds"] = [];
  const identityRefs = new Set<string>();

  if (subject && config.conventions.dpjSubjectBracketRef.enabled) {
    const ref = bracketPrefixRef(subject);
    if (ref) {
      identityRefs.add(ref);
      out.push({ targetSystem: "aha", targetId: ref, kind: "dpj_subject_bracket_ref", claimsIdentity: true, provenance: prov("subject", subject) });
    }
  }
  if (description) {
    const ahaUrl = ahaUrlPattern(config);
    for (const line of description.split(/\r?\n/)) {
      const labelled = /^\s*aha\s*:/i.test(line) && config.conventions.dpjDescriptionAhaUrl.enabled;
      for (const m of line.matchAll(ahaUrl)) {
        const ref = m[1]!;
        if (labelled) identityRefs.add(ref);
        out.push({
          targetSystem: "aha",
          targetId: ref,
          url: m[0],
          kind: labelled ? "dpj_description_aha_url" : "text_mention",
          claimsIdentity: labelled,
          provenance: prov("description", line),
        });
      }
    }
    const seen = new Set(out.map((l) => l.targetId));
    for (const m of description.matchAll(AHA_REF)) {
      const ref = m[0];
      if (seen.has(ref) || ref === displayId) continue;
      seen.add(ref);
      out.push({ targetSystem: "aha", targetId: ref, kind: "text_mention", claimsIdentity: false, provenance: prov("description", ref) });
    }
  }
  for (const cf of config.dpj.ahaReferenceCustomFields) {
    const value = str(w[cf]);
    if (value && isAhaRef(value.trim())) {
      externalIds.push({ scheme: "aha_ref", value: value.trim(), provenance: prov(cf, value) });
      out.push({ targetSystem: "aha", targetId: value.trim(), kind: "dpj_custom_field_ref", claimsIdentity: true, provenance: prov(cf, value) });
    }
  }

  const parentTitle = str(parent?.title);
  const parentId = hrefId(parent);
  const parentRef = parentTitle ? bracketPrefixRef(parentTitle) : undefined;

  return {
    key: `dpj:${sourceId}`,
    system: "dpj",
    sourceId,
    ...(displayId ? { displayId } : {}),
    retrievalState: "AVAILABLE",
    externalIds,
    links: out,
    url: field("self", url)!,
    ...(str(type?.title) ? { recordType: field("_links.type", str(type?.title)!, str(type?.title)) } : {}),
    ...(subject ? { title: field("subject", subject, subject) } : {}),
    ...(description ? { description: field("description.raw", description, description) } : {}),
    ...(project ? { project: field("_links.project", { id: hrefId(project), name: str(project.title) }, str(project.title)) } : {}),
    ...(str(assignee?.title) ? { owner: field("_links.assignee", { id: hrefId(assignee), name: str(assignee?.title)! }, str(assignee?.title)) } : {}),
    ...(str(status?.title) ? { status: field("_links.status", { name: str(status?.title)! }, str(status?.title)) } : {}),
    ...(str(w.startDate) ? { startDate: field("startDate", str(w.startDate)!, str(w.startDate)) } : {}),
    ...(str(w.dueDate) ? { dueDate: field("dueDate", str(w.dueDate)!, str(w.dueDate)) } : {}),
    ...(str(version?.title) ? { release: field("_links.version", { id: hrefId(version), name: str(version?.title)! }, str(version?.title)) } : {}),
    ...(parent && parentId
      ? { parent: field("_links.parent", { system: "dpj" as const, id: parentId, ...(parentTitle ? { title: parentTitle } : {}), ...(parentRef ? { refInTitle: parentRef } : {}) }, parentTitle) }
      : {}),
    ...(str(w.updatedAt) ? { lastModified: field("updatedAt", str(w.updatedAt)!) } : {}),
  };
}
