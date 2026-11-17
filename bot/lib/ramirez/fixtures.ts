// Test fixtures. Builds records through the real normalizers so tests exercise
// the same provenance and link extraction as production. No credentials, no network.
import { normalizeAhaRecord } from "./adapters/aha";
import { normalizeDpjWorkPackage } from "./adapters/dpj";
import { DEFAULT_CONFIG, withConfig, type RamirezConfig } from "./config";
import type { CandidateHit, IdentifierChannel, PlanningAdapter, Retrieval } from "./retrieval";
import type { Artifact, RetrievalState } from "./types";

export const NOW = "2026-11-16T12:00:00.000Z";

export function config(overrides: Partial<RamirezConfig> = {}): RamirezConfig {
  return withConfig(overrides);
}

export type AhaOpts = {
  ref: string;
  title?: string;
  type?: string;
  description?: string;
  owner?: string | null;
  status?: string;
  start?: string;
  due?: string;
  parentRef?: string;
  integrations?: Array<{ service: string; id: string; url?: string }>;
};

export function aha(o: AhaOpts, cfg: RamirezConfig = config()): Artifact {
  const raw = {
    reference_num: o.ref,
    id: `${o.ref}-internal`,
    name: o.title ?? `Title of ${o.ref}`,
    record_type: o.type ?? "epic",
    url: `https://bayer.aha.io/epics/${o.ref}`,
    description: o.description ?? "",
    workflow_status: { name: o.status ?? "In progress", workflow_status_category: { name: "In progress" } },
    assigned_to_user: o.owner === null ? null : { name: o.owner ?? "Alex Owner", id: "u1", email: "redacted" },
    start_date: o.start ?? null,
    due_date: o.due ?? null,
    epic: o.parentRef ? { reference_num: o.parentRef, name: `Parent ${o.parentRef}` } : null,
    project: { id: "p1", name: "Velocity", reference_prefix: "VEL" },
    custom_fields: [],
    tags: [],
    integration_fields: (o.integrations ?? []).flatMap((i) => [
      { id: "1", name: "id", value: i.id, integration_id: "9", service_name: i.service },
      ...(i.url ? [{ id: "2", name: "url", value: i.url, integration_id: "9", service_name: i.service }] : []),
    ]),
  };
  return normalizeAhaRecord(raw, cfg, NOW);
}

export type DpjOpts = {
  id: string;
  subject: string;
  description?: string;
  type?: string;
  owner?: string | null;
  status?: string;
  start?: string;
  due?: string;
  parentId?: string;
  parentTitle?: string;
};

export function dpj(o: DpjOpts, cfg: RamirezConfig = config()): Artifact {
  const links: Record<string, unknown> = {
    type: { title: o.type ?? "Epic" },
    status: { title: o.status ?? "In progress" },
    project: { title: "Velocity" },
  };
  if (o.owner !== null) links.assignee = { title: o.owner ?? "Alex Owner" };
  if (o.parentId) links.parent = { href: `/api/v3/work_packages/${o.parentId}`, title: o.parentTitle ?? `Parent ${o.parentId}` };
  const raw = {
    id: Number(o.id),
    subject: o.subject,
    description: { format: "markdown", raw: o.description ?? "" },
    startDate: o.start ?? null,
    dueDate: o.due ?? null,
    updatedAt: "2026-11-01T09:00:00Z",
    _links: links,
  };
  return normalizeDpjWorkPackage(raw, cfg, NOW);
}

export function hit(a: Artifact): CandidateHit {
  return { id: a.sourceId, ...(a.recordType ? { recordType: a.recordType.value } : {}), artifact: a };
}

type FakeOpts = {
  system: "aha" | "dpj";
  records?: Artifact[];
  channels?: IdentifierChannel[];
  getByIdState?: Record<string, RetrievalState>;
  identifierHits?: Artifact[];
  identifierState?: RetrievalState;
  identifierTruncated?: boolean;
  titleHits?: Artifact[];
  titleState?: RetrievalState;
};

export type FakeAdapter = PlanningAdapter & { calls: string[] };

/** In-memory adapter. Records every call so tests can assert retrieval behavior. */
export function fake(o: FakeOpts): FakeAdapter {
  const calls: string[] = [];
  const byId = new Map((o.records ?? []).map((r) => [r.sourceId, r]));
  const ok = <T>(value: T, scope: string, state: RetrievalState = "AVAILABLE", truncated = false): Retrieval<T> => ({ state, value, scope, ...(truncated ? { truncated } : {}) });
  return {
    system: o.system,
    searchableIdentifierChannels: o.channels ?? ["subject"],
    calls,
    async getById(id) {
      calls.push(`get:${id}`);
      const rec = byId.get(id);
      if (rec) return { state: "AVAILABLE", value: rec, scope: `${o.system} get ${id}` };
      return { state: o.getByIdState?.[id] ?? "NOT_FOUND_WITHIN_QUERIED_SCOPE", scope: `${o.system} get ${id}` };
    },
    async searchByIdentifier(identifier) {
      calls.push(`identifier:${identifier}`);
      const hits = (o.identifierHits ?? []).map(hit);
      const state = o.identifierState ?? (hits.length ? "AVAILABLE" : "NOT_FOUND_WITHIN_QUERIED_SCOPE");
      return ok(hits, `${o.system} identifier ${identifier}`, state, o.identifierTruncated);
    },
    async searchByTitle(text) {
      calls.push(`title:${text}`);
      const hits = (o.titleHits ?? []).map(hit);
      const state = o.titleState ?? (hits.length ? "AVAILABLE" : "NOT_FOUND_WITHIN_QUERIED_SCOPE");
      return ok(hits, `${o.system} title ${text}`, state);
    },
  };
}

export const DEFAULT_CHANNELS: IdentifierChannel[] = ["subject"];
export const FULL_CHANNELS: IdentifierChannel[] = ["subject", "description"];

export { DEFAULT_CONFIG };
