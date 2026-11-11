#!/usr/bin/env node
// DPJ (OpenProject) REST writer. Node 22+, no dependencies.
//
//   node dpj.mjs me
//   node dpj.mjs get <id>
//   node dpj.mjs schema <projectId> <typeId>
//   node dpj.mjs apply <plan.json> [--apply]
//
// `apply` is a dry run unless --apply is passed. The token is read from
// OPENPROJECT_API_KEY (env, else .env.local in cwd) and is never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const applyMode = args.includes("--apply");

function readEnvLocal(name) {
  const file = join(process.cwd(), ".env.local");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

const baseUrl = (process.env.OPENPROJECT_URL ?? readEnvLocal("OPENPROJECT_URL") ?? "https://dpj.int.bayer.com").replace(/\/$/, "");

function token() {
  const key = process.env.OPENPROJECT_API_KEY ?? readEnvLocal("OPENPROJECT_API_KEY");
  if (!key) {
    console.error(
      "OPENPROJECT_API_KEY is not set. Add it to .env.local (gitignored) or the environment. " +
        "Create it in DPJ: Avatar > Account settings > Access tokens > API.",
    );
    process.exit(5);
  }
  return key;
}

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}/api/v3${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`apikey:${token()}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/hal+json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    const errs = json?._embedded?.errors?.map((e) => e.message) ?? [json?.message ?? res.statusText];
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${errs.join("; ")}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const wpHref = (id) => ({ href: `/api/v3/work_packages/${id}` });
const hours = (v) => (typeof v === "number" ? `PT${v}H` : v);

function summarize(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    type: wp._links?.type?.title,
    status: wp._links?.status?.title,
    parent: wp._links?.parent?.href?.split("/").pop() ?? null,
    assignee: wp._links?.assignee?.title ?? null,
    startDate: wp.startDate ?? null,
    dueDate: wp.dueDate ?? null,
    estimatedTime: wp.estimatedTime ?? null,
    derivedEstimatedTime: wp.derivedEstimatedTime ?? null,
    remainingTime: wp.remainingTime ?? null,
    storyPoints: wp.storyPoints ?? null,
    lockVersion: wp.lockVersion,
  };
}

async function cmdSchema(projectId, typeId) {
  const form = await api("POST", `/projects/${projectId}/work_packages/form`, {
    _links: { type: { href: `/api/v3/types/${typeId}` } },
  });
  const schema = form._embedded?.schema ?? {};
  const fields = Object.entries(schema)
    .filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object" && v.writable)
    .map(([k, v]) => ({ key: k, name: v.name, type: v.type, required: !!v.required }));
  const types = (schema.type?._embedded?.allowedValues ?? []).map((t) => ({ id: t.id, name: t.name }));
  const errors = Object.values(form._embedded?.validationErrors ?? {}).map((e) => e.message);
  console.log(JSON.stringify({ projectId, typeId, allowedTypes: types, writableFields: fields, validationErrors: errors }, null, 2));
}

function loadState(path) {
  return existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { ids: {}, relations: [], comments: [], statuses: [], updates: [] };
}

async function cmdApply(planPath) {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const statePath = resolve(plan.statePath ?? planPath.replace(/\.json$/, ".state.json"));
  const state = loadState(statePath);
  const save = () => applyMode && writeFileSync(statePath, JSON.stringify(state, null, 2));
  const log = (line) => console.log(`${applyMode ? "APPLY" : "DRY  "} ${line}`);

  const ref = (r) => {
    if (typeof r === "number") return r;
    if (typeof r === "string" && r.startsWith("@")) {
      const id = state.ids[r.slice(1)];
      if (id) return id;
      if (!applyMode) return r;
      throw new Error(`Unresolved reference ${r}`);
    }
    throw new Error(`Bad reference ${JSON.stringify(r)} (use a number or "@key")`);
  };

  // 1. Creates, in file order (parents before children).
  for (const item of plan.items ?? []) {
    if (state.ids[item.key]) {
      log(`skip create @${item.key} (exists as ${state.ids[item.key]})`);
      continue;
    }
    const body = {
      subject: item.subject,
      _links: { type: { href: `/api/v3/types/${item.type}` }, ...(item.links ?? {}) },
      ...(item.fields ?? {}),
    };
    if (item.description) body.description = { format: "markdown", raw: item.description };
    for (const f of ["startDate", "dueDate", "storyPoints", "percentageDone"]) {
      if (item[f] !== undefined) body[f] = item[f];
    }
    if (item.estimatedTime !== undefined) body.estimatedTime = hours(item.estimatedTime);
    if (item.remainingTime !== undefined) body.remainingTime = hours(item.remainingTime);
    if (item.parent !== undefined) body._links.parent = wpHref(ref(item.parent));
    if (item.assignee) body._links.assignee = { href: `/api/v3/users/${item.assignee}` };
    log(`create @${item.key} type=${item.type} parent=${item.parent ?? "-"} "${item.subject}"`);
    if (!applyMode) continue;
    const wp = await api("POST", `/projects/${plan.project}/work_packages`, body);
    state.ids[item.key] = wp.id;
    save();
    console.log(`      -> ${wp.id} ${baseUrl}/work_packages/${wp.id}`);
  }

  // 2. Field updates on existing or created packages.
  for (const [i, u] of (plan.updates ?? []).entries()) {
    const tag = `update:${i}:${u.target}`;
    if (state.updates.includes(tag)) continue;
    log(`update ${u.target} ${JSON.stringify(u.fields ?? {})}`);
    if (!applyMode) continue;
    const id = ref(u.target);
    const cur = await api("GET", `/work_packages/${id}`);
    await api("PATCH", `/work_packages/${id}`, { lockVersion: cur.lockVersion, ...(u.fields ?? {}) });
    state.updates.push(tag);
    save();
  }

  // 3. Relations: from -> to with an OpenProject relation type.
  for (const r of plan.relations ?? []) {
    const tag = `${r.from}|${r.type}|${r.to}`;
    if (state.relations.includes(tag)) continue;
    log(`relate ${r.from} ${r.type} ${r.to}`);
    if (!applyMode) continue;
    await api("POST", `/work_packages/${ref(r.from)}/relations`, {
      type: r.type,
      description: r.description ?? "",
      _links: { to: wpHref(ref(r.to)) },
    });
    state.relations.push(tag);
    save();
  }

  // 4. Comments.
  for (const [i, c] of (plan.comments ?? []).entries()) {
    const tag = `${i}|${c.on}`;
    if (state.comments.includes(tag)) continue;
    log(`comment ${c.on} "${c.text.slice(0, 60)}"`);
    if (!applyMode) continue;
    await api("POST", `/work_packages/${ref(c.on)}/activities`, { comment: { raw: c.text } });
    state.comments.push(tag);
    save();
  }

  // 5. Statuses, children first (reverse creation order) so parents close last.
  const withStatus = (plan.items ?? []).filter((it) => it.status !== undefined).reverse();
  for (const item of withStatus) {
    if (state.statuses.includes(item.key)) continue;
    log(`status @${item.key} -> ${item.status}`);
    if (!applyMode) continue;
    const id = ref(`@${item.key}`);
    const cur = await api("GET", `/work_packages/${id}`);
    if (cur._links?.status?.href !== `/api/v3/statuses/${item.status}`) {
      await api("PATCH", `/work_packages/${id}`, {
        lockVersion: cur.lockVersion,
        _links: { status: { href: `/api/v3/statuses/${item.status}` } },
      });
    }
    state.statuses.push(item.key);
    save();
  }

  console.log(applyMode ? `Done. State: ${statePath}` : "Dry run only. Re-run with --apply to write.");
}

try {
  if (cmd === "me") {
    const me = await api("GET", "/users/me");
    console.log(JSON.stringify({ id: me.id, name: me.name, login: me.login }, null, 2));
  } else if (cmd === "get" && args[1]) {
    console.log(JSON.stringify(summarize(await api("GET", `/work_packages/${args[1]}`)), null, 2));
  } else if (cmd === "schema" && args[1] && args[2]) {
    await cmdSchema(args[1], args[2]);
  } else if (cmd === "apply" && args[1]) {
    await cmdApply(args[1]);
  } else {
    console.error("Usage: dpj.mjs me | get <id> | schema <projectId> <typeId> | apply <plan.json> [--apply]");
    process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(err.status === 401 || err.status === 403 ? 5 : 1);
}
