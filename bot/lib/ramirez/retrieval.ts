import { inferAhaRecordType, normalizeAhaRecord } from "./adapters/aha";
import { normalizeDpjWorkPackage } from "./adapters/dpj";
import { assertReadTool } from "./capabilities";
import type { RamirezConfig } from "./config";
import { redact } from "./redact";
import type { Artifact, RetrievalLogEntry, RetrievalState, SystemId } from "./types";

export type Retrieval<T> = { state: RetrievalState; value?: T; scope: string; truncated?: boolean; note?: string };

/** A search hit. `artifact` is set when the search already returned the full record. */
export type CandidateHit = { id: string; recordType?: string; artifact?: Artifact };

/** Which identifier channels a system can search exhaustively with its read tools. */
export type IdentifierChannel = "subject" | "description" | "custom_field" | "integration_field";

/** Targeted, read-only access to one planning system. Implementations normalize before returning. */
export interface PlanningAdapter {
  readonly system: "aha" | "dpj";
  readonly searchableIdentifierChannels: readonly IdentifierChannel[];
  getById(id: string, hint?: { recordType?: string }): Promise<Retrieval<Artifact>>;
  /** Finds records whose identifier channels contain the Aha reference (searchable channels only). */
  searchByIdentifier(identifier: string): Promise<Retrieval<CandidateHit[]>>;
  /** Finds records by title text for metadata comparison. */
  searchByTitle(text: string, scope?: { projectId?: string }): Promise<Retrieval<CandidateHit[]>>;
}

/** Caches every retrieval for the run and logs why it was made. */
export class RetrievalSession {
  readonly log: RetrievalLogEntry[] = [];
  private readonly cache = new Map<string, Promise<Retrieval<unknown>>>();
  readonly queried = new Set<SystemId>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async run<T>(system: SystemId, operation: string, target: string, question: string, fn: () => Promise<Retrieval<T>>): Promise<Retrieval<T>> {
    const key = `${system}|${operation}|${target}`;
    const hit = this.cache.get(key);
    if (hit) {
      const res = (await hit) as Retrieval<T>;
      this.log.push({ system, operation, target, state: res.state, question, cached: true, at: this.now() });
      return res;
    }
    const promise = fn().catch((err: unknown): Retrieval<T> => failure(err, `${operation} ${target}`));
    this.cache.set(key, promise as Promise<Retrieval<unknown>>);
    const res = await promise;
    this.queried.add(system);
    const count = Array.isArray(res.value) ? res.value.length : res.value ? 1 : 0;
    this.log.push({
      system,
      operation,
      target,
      state: res.state,
      question,
      cached: false,
      resultCount: count,
      ...(res.truncated ? { truncated: true } : {}),
      at: this.now(),
      ...(res.note ? { note: redact(res.note).slice(0, 200) } : {}),
    });
    return res;
  }
}

export function failure<T>(err: unknown, scope: string): Retrieval<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { state: classifyError(message), scope, note: redact(message).slice(0, 200) };
}

export function classifyError(message: string): RetrievalState {
  if (/not loaded|NOT_RETRIEVED/i.test(message)) return "NOT_RETRIEVED";
  if (/needs authorization|unauthori[sz]ed|forbidden|\b401\b|\b403\b|reconnect|permission/i.test(message)) return "INACCESSIBLE";
  if (/not found|\b404\b|does not exist|no such/i.test(message)) return "NOT_FOUND_WITHIN_QUERIED_SCOPE";
  return "NOT_AVAILABLE";
}

// ---- MCP-backed adapters ---------------------------------------------------

export type McpCallResult = { content: Array<{ type: string; text?: string; [k: string]: unknown }>; isError?: boolean; structuredContent?: Record<string, unknown> };
export type McpClient = {
  names(): string[];
  listTools(connection: string): Promise<Array<{ name: string }>>;
  callTool(connection: string, tool: string, args?: Record<string, unknown>): Promise<McpCallResult>;
};

function payload(res: McpCallResult): unknown {
  if (res.structuredContent) return res.structuredContent;
  const text = res.content.find((c) => c.type === "text" && typeof c.text === "string")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(res: McpCallResult): string {
  const p = payload(res);
  if (typeof p === "string") return p;
  const o = p as Record<string, unknown> | undefined;
  return String(o?.error ?? o?.message ?? "tool returned an error");
}

/** Every call passes the read allowlist twice: on the logical name and on the resolved server name. */
class ReadOnlyConnection {
  private resolvedNames = new Map<string, string>();
  constructor(private readonly mcp: McpClient, readonly system: "aha" | "dpj", readonly connection: string) {}

  async call(tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
    assertReadTool(this.system, tool);
    if (!this.mcp.names().includes(this.connection)) throw new Error(`connection ${this.connection} not loaded (NOT_RETRIEVED)`);
    let resolved = this.resolvedNames.get(tool);
    if (!resolved) {
      const tools = await this.mcp.listTools(this.connection);
      resolved = tools.find((t) => t.name === tool || t.name.endsWith(`-${tool}`))?.name;
      if (!resolved) throw new Error(`${this.connection} does not declare ${tool}`);
      this.resolvedNames.set(tool, resolved);
    }
    assertReadTool(this.system, resolved);
    return this.mcp.callTool(this.connection, resolved, args);
  }
}

function ahaResults(p: unknown): Array<Record<string, unknown>> {
  const o = p as Record<string, unknown> | undefined;
  const result = (o?.result ?? o) as Record<string, unknown> | undefined;
  const results = result?.results;
  if (Array.isArray(results)) return results as Array<Record<string, unknown>>;
  const nested = (results as Record<string, unknown> | undefined)?.records;
  return Array.isArray(nested) ? (nested as Array<Record<string, unknown>>) : [];
}

export function createAhaMcpAdapter(mcp: McpClient, config: RamirezConfig, now: () => string = () => new Date().toISOString()): PlanningAdapter {
  const conn = new ReadOnlyConnection(mcp, "aha", "aha");
  const adapter: PlanningAdapter = {
    system: "aha",
    searchableIdentifierChannels: [],
    async getById(id, hint) {
      const recordType = hint?.recordType ?? inferAhaRecordType(id);
      const scope = `aha read_records ${id}`;
      if (!recordType) return { state: "NOT_RETRIEVED", scope, note: "record type unknown for this reference format" };
      const res = await conn.call("read_records", { record_type: recordType, record_ids: [id], fields: "detailed" });
      if (res.isError) {
        const msg = errorText(res);
        return { state: classifyError(msg), scope, note: msg };
      }
      const records = ahaResults(payload(res));
      const record = records.find((r) => r.reference_num === id || String(r.id) === id) ?? records[0];
      if (!record) return { state: "NOT_FOUND_WITHIN_QUERIED_SCOPE", scope };
      return { state: "AVAILABLE", scope, value: normalizeAhaRecord(record, config, now()) };
    },
    async searchByIdentifier(identifier) {
      const scope = `aha search_records "${identifier}"`;
      const res = await conn.call("search_records", { queries: [identifier], intent: "Ramirez identifier discovery" });
      if (res.isError) {
        const msg = errorText(res);
        return { state: classifyError(msg), scope, note: msg };
      }
      const hits: CandidateHit[] = ahaResults(payload(res))
        .slice(0, config.metadataSearchLimit)
        .filter((h) => h.id !== undefined && h.id !== null)
        .map((h) => ({ id: String(h.id), ...(typeof h.record_type === "string" ? { recordType: h.record_type } : {}) }));
      return { state: hits.length ? "AVAILABLE" : "NOT_FOUND_WITHIN_QUERIED_SCOPE", scope, value: hits };
    },
    async searchByTitle(text) {
      return adapter.searchByIdentifier(text);
    },
  };
  return adapter;
}

function dpjItems(p: unknown): unknown[] {
  const o = p as Record<string, unknown> | undefined;
  if (Array.isArray(o?.items)) return o.items;
  const embedded = (o?._embedded as Record<string, unknown> | undefined)?.elements;
  return Array.isArray(embedded) ? embedded : [];
}

export function createDpjMcpAdapter(mcp: McpClient, config: RamirezConfig, now: () => string = () => new Date().toISOString()): PlanningAdapter {
  const conn = new ReadOnlyConnection(mcp, "dpj", "dpj");
  const search = async (args: Record<string, unknown>, scope: string): Promise<Retrieval<CandidateHit[]>> => {
    const res = await conn.call("search_work_packages", args);
    if (res.isError) {
      const msg = errorText(res);
      return { state: classifyError(msg), scope, note: msg };
    }
    const items = dpjItems(payload(res));
    const hits: CandidateHit[] = items.map((item) => {
      const artifact = normalizeDpjWorkPackage(item, config, now());
      return { id: artifact.sourceId, ...(artifact.recordType ? { recordType: artifact.recordType.value } : {}), artifact };
    });
    return {
      state: hits.length ? "AVAILABLE" : "NOT_FOUND_WITHIN_QUERIED_SCOPE",
      scope,
      value: hits,
      truncated: items.length >= 100,
    };
  };
  return {
    system: "dpj",
    // search_work_packages filters on subject only. Descriptions and custom fields are not searchable.
    searchableIdentifierChannels: ["subject"],
    async getById(id) {
      const n = Number(id);
      const scope = `dpj search_work_packages id=${id}`;
      if (!Number.isInteger(n) || n <= 0) return { state: "NOT_RETRIEVED", scope, note: "DPJ lookup needs the numeric work package id" };
      const res = await search({ id: n }, scope);
      const match = res.value?.find((h) => h.id === String(n))?.artifact;
      if (match) return { state: "AVAILABLE", scope, value: match };
      return { state: res.state === "AVAILABLE" ? "NOT_FOUND_WITHIN_QUERIED_SCOPE" : res.state, scope, ...(res.note ? { note: res.note } : {}) };
    },
    async searchByIdentifier(identifier) {
      return search({ subject: identifier }, `dpj search_work_packages subject~"${identifier}"`);
    },
    async searchByTitle(text, scope) {
      const project = scope?.projectId ? Number(scope.projectId) : undefined;
      const res = await search(
        { subject: text, ...(project ? { project_id: project } : {}) },
        `dpj search_work_packages subject~"${text}"${project ? ` project=${project}` : ""}`,
      );
      const limit = config.metadataSearchLimit * 4;
      return res.value && res.value.length > limit ? { ...res, value: res.value.slice(0, limit), truncated: true } : res;
    },
  };
}
