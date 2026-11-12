#!/usr/bin/env node
// Usage: npm run connect [-- aha dpj mural figma] [--status]
// Checks each named source's sign-in (all four by default). A working
// sign-in passes silently; one that needs authorization opens its sign-in
// page in the browser and waits. --status reports without signing in.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectors, SOURCE_NAMES } from "./lib/connectors.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeOptions = process.env.NODE_OPTIONS ?? "";
const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions.includes("--use-system-ca") ? nodeOptions : `${nodeOptions} --use-system-ca`.trim(),
};

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const named = args.filter((a) => !a.startsWith("--")).flatMap((a) => a.split(",")).map((a) => a.trim().toLowerCase()).filter(Boolean);
const unknown = named.filter((n) => !SOURCE_NAMES.includes(n));
if (unknown.length > 0) {
  console.error(`Unknown source ${unknown.join(", ")}. Expected: ${SOURCE_NAMES.join(", ")}`);
  process.exit(2);
}
const sources = named.length > 0 ? [...new Set(named)] : SOURCE_NAMES;
const connectors = createConnectors({ root, env, log: (line) => console.log(line) });

let failed = false;
for (const source of sources) {
  try {
    if (statusOnly) console.log(`${source}: ${await connectors.status(source)}`);
    else await connectors.ensure(source).then(() => console.log(`${source}: ready`));
  } catch (err) {
    failed = true;
    console.error(err instanceof Error ? err.message : String(err));
  }
}
process.exit(failed ? 1 : 0);
