// Normalizes one Aha `read_records` result record. Field names follow the
// shape observed in this repo's local traces; nothing else is assumed.
import type { RamirezConfig } from "../config";
import { excerpt } from "../redact";
import { isAhaRef, stripMarkup } from "../text";
import type { Artifact, CrossSystemLink, Field, Provenance } from "../types";

type Obj = Record<string, unknown>;
const ADAPTER = "aha-mcp-read_records@1";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : undefined);
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function dpjUrlPattern(config: RamirezConfig): RegExp {
  const host = config.dpj.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\./g, "\\.");
  return new RegExp(`https?://${host}/(?:projects/[^/\\s]+/)?work_packages/(\\d+)`, "g");
}

export function normalizeAhaRecord(raw: unknown, config: RamirezConfig, retrievedAt: string, method = "read_records"): Artifact {
  const r = obj(raw) ?? {};
  const sourceId = str(r.reference_num) ?? str(r.id) ?? "unknown";
  const url = str(r.url);
  const prov = (field: string, value?: string): Provenance => ({
    system: "aha",
    sourceRecordId: sourceId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    ...(url ? { sourceUrl: url } : {}),
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  const descriptionRaw = typeof r.description === "string" ? r.description : str(obj(r.description)?.body);
  const description = descriptionRaw !== undefined ? stripMarkup(descriptionRaw).trim() : undefined;
  const status = obj(r.workflow_status);
  const owner = obj(r.assigned_to_user);
  const project = obj(r.project);
  const release = obj(r.release);
  const recordType = str(r.record_type);
  const parentField = ["epic", "master_feature", "initiative", "feature"].find((k) => obj(r[k]) !== undefined);
  const parentObj = parentField ? obj(r[parentField]) : undefined;

  const links: CrossSystemLink[] = [];
  const externalIds: Artifact["externalIds"] = [];
  const dpjUrl = dpjUrlPattern(config);

  if (description) {
    for (const m of description.matchAll(dpjUrl)) {
      links.push({ targetSystem: "dpj", targetId: m[1], url: m[0], kind: "aha_description_dpj_url", claimsIdentity: true, provenance: prov("description", m[0]) });
    }
  }
  for (const cf of arr(r.custom_fields)) {
    const c = obj(cf);
    const value = str(c?.value);
    if (!c || !value) continue;
    for (const m of value.matchAll(dpjUrl)) {
      links.push({ targetSystem: "dpj", targetId: m[1], url: m[0], kind: "aha_custom_field_dpj_url", claimsIdentity: true, provenance: prov(`custom_fields.${str(c.name) ?? "?"}`, m[0]) });
    }
  }

  const byIntegration = new Map<string, Obj[]>();
  for (const f of arr(r.integration_fields)) {
    const o = obj(f);
    if (!o) continue;
    const key = `${str(o.service_name) ?? "unknown"}:${str(o.integration_id) ?? "0"}`;
    byIntegration.set(key, [...(byIntegration.get(key) ?? []), o]);
  }
  for (const [key, fields] of byIntegration) {
    const service = key.split(":")[0] ?? "unknown";
    const get = (name: string) => str(fields.find((f) => f.name === name)?.value);
    const id = get("id");
    const link = get("url");
    if (service === "vsts") {
      links.push({
        targetSystem: "azure_devops",
        ...(id ? { targetId: id } : {}),
        ...(link ? { url: link } : {}),
        kind: "aha_integration_field",
        claimsIdentity: true,
        provenance: prov(`integration_fields.${service}`, id),
      });
    } else if (id) {
      externalIds.push({ scheme: `aha_integration:${service}`, value: id, provenance: prov(`integration_fields.${service}.id`, id) });
    }
    if (link) for (const m of link.matchAll(dpjUrl)) {
      links.push({ targetSystem: "dpj", targetId: m[1], url: m[0], kind: "aha_integration_field", claimsIdentity: true, provenance: prov(`integration_fields.${service}.url`, m[0]) });
    }
  }

  const tags = arr(r.tags).map(str).filter((t): t is string => t !== undefined);
  const parentId = str(parentObj?.reference_num) ?? str(parentObj?.id);

  return {
    key: `aha:${sourceId}`,
    system: "aha",
    sourceId,
    displayId: sourceId,
    retrievalState: "AVAILABLE",
    externalIds,
    links,
    ...(recordType ? { recordType: field("record_type", recordType, recordType) } : {}),
    ...(url ? { url: field("url", url) } : {}),
    ...(str(r.name) ? { title: field("name", str(r.name)!, str(r.name)) } : {}),
    ...(description ? { description: field("description", description, description) } : {}),
    ...(project ? { project: field("project", { id: str(project.id), name: str(project.name), prefix: str(project.reference_prefix) }, str(project.name)) } : {}),
    ...(owner && str(owner.name) ? { owner: field("assigned_to_user", { id: str(owner.id), name: str(owner.name)! }, str(owner.name)) } : {}),
    ...(status && str(status.name)
      ? { status: field("workflow_status", { name: str(status.name)!, category: str(obj(status.workflow_status_category)?.name) }, str(status.name)) }
      : {}),
    ...(str(r.start_date) ? { startDate: field("start_date", str(r.start_date)!, str(r.start_date)) } : {}),
    ...(str(r.due_date) ? { dueDate: field("due_date", str(r.due_date)!, str(r.due_date)) } : {}),
    ...(release && str(release.name) ? { release: field("release", { id: str(release.reference_num) ?? str(release.id), name: str(release.name)! }, str(release.name)) } : {}),
    ...(tags.length ? { tags: field("tags", tags) } : {}),
    ...(parentObj && parentField && parentId
      ? { parent: field(parentField, { system: "aha" as const, id: parentId, title: str(parentObj.name), ...(isAhaRef(parentId) ? { refInTitle: parentId } : {}) }, parentId) }
      : {}),
    ...(str(r.updated_at) ? { lastModified: field("updated_at", str(r.updated_at)!) } : {}),
  };
}

/** Infers the Aha record type from a reference number only where the format is unambiguous. */
export function inferAhaRecordType(ref: string): "epic" | "feature" | "requirement" | undefined {
  if (/^[A-Z][A-Z0-9]{1,11}-E-\d+$/.test(ref)) return "epic";
  if (/^[A-Z][A-Z0-9]{1,11}-\d+-\d+$/.test(ref)) return "requirement";
  if (/^[A-Z][A-Z0-9]{1,11}-\d+$/.test(ref)) return "feature";
  return undefined;
}
