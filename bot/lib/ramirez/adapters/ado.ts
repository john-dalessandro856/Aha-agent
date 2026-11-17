// Normalizes operator/IDE-supplied Azure DevOps work-item metadata.
// Ramirez never opens an Azure DevOps connector.
import type { RamirezConfig } from "../config";
import { DEFAULT_CONFIG } from "../config";
import { ahaRefFromTitle, parseAdoUrls } from "../links";
import { excerpt } from "../redact";
import type { Artifact, CrossSystemLink, Field, Provenance } from "../types";

const ADAPTER = "ado-operator-evidence@1";

export type AdoWorkItemInput = {
  workItemId: string;
  org?: string;
  project?: string;
  title?: string;
  state?: string;
  url?: string;
  description?: string;
  note?: string;
  assignedTo?: string;
  iteration?: string;
};

/**
 * Builds an Artifact for an Azure DevOps work item from operator/IDE evidence.
 */
export function normalizeAdoWorkItem(
  input: AdoWorkItemInput,
  retrievedAt: string,
  method = "operator_ide_evidence",
  config: RamirezConfig = DEFAULT_CONFIG,
): Artifact {
  const workItemId = String(input.workItemId).trim();
  const url =
    input.url ??
    (input.org && input.project
      ? `https://dev.azure.com/${input.org}/${encodeURIComponent(input.project)}/_workitems/edit/${workItemId}`
      : undefined);
  const title = input.title ?? `Work item ${workItemId}`;
  const descriptionParts = [input.description, input.note, input.iteration ? `iteration=${input.iteration}` : undefined].filter(Boolean);

  const prov = (field: string, value?: string): Provenance => ({
    system: "azure_devops",
    sourceRecordId: workItemId,
    sourceField: field,
    retrievedAt,
    retrievalMethod: method,
    adapter: ADAPTER,
    ...(url ? { sourceUrl: url } : {}),
    ...(value !== undefined ? { excerpt: excerpt(value, 120) } : {}),
  });
  const field = <T>(name: string, value: T | undefined, shown?: string): Field<T> | undefined =>
    value === undefined ? undefined : { value, provenance: prov(name, shown) };

  const links: CrossSystemLink[] = [];
  if (config.conventions.adoTitleAhaRef.enabled) {
    const ref = ahaRefFromTitle(title);
    if (ref) {
      links.push({
        targetSystem: "aha",
        targetId: ref,
        kind: "ado_title_aha_ref",
        claimsIdentity: true,
        provenance: prov("title", ref),
      });
    }
  }

  return {
    key: `azure_devops:${workItemId}`,
    system: "azure_devops",
    sourceId: workItemId,
    displayId: workItemId,
    retrievalState: "AVAILABLE",
    recordType: field("record_type", "work_item", "work_item"),
    ...(url ? { url: field("url", url, url) } : {}),
    title: field("title", title, title),
    ...(descriptionParts.length
      ? { description: field("description", descriptionParts.join(" | "), descriptionParts.join(" | ")) }
      : {}),
    ...(input.org || input.project
      ? { project: field("project", { id: input.project, name: input.project ?? input.org, prefix: input.org }) }
      : {}),
    ...(input.assignedTo ? { owner: field("assignedTo", { name: input.assignedTo }, input.assignedTo) } : {}),
    ...(input.state ? { status: field("state", { name: input.state }, input.state) } : {}),
    externalIds: [{ scheme: "ado_work_item_id", value: workItemId, provenance: prov("workItemId", workItemId) }],
    links,
  };
}

/** Re-export for callers that import parse helpers from the adapter. */
export { parseAdoUrls };
