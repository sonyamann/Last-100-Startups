// Runs the pipeline. Examples:
//   npm run pipeline -- --days 1                 # ingest the last day, then everything else
//   npm run pipeline -- --days 21 --limit 2000   # extract at most 2,000 items this run
//   npm run pipeline -- --steps judge,report --rejudge
// Steps, in order: ingest, prefilter, extract, resolve, judge, dedupe,
// enrich (then dedupe again), publish (writes data/board.json), report.
// With no --days, ingest continues from the newest stored item.

import "../lib/env.ts";
import { parseArgs } from "node:util";
import { getState, openDb, setState } from "../lib/db.ts";
import { balance } from "../lib/kimi.ts";
import { now } from "../lib/util.ts";
import { extract } from "./extract.ts";
import { ingest } from "./ingest.ts";
import { judge } from "./judge.ts";
import { prefilter } from "./prefilter.ts";
import { writeReport } from "./report.ts";
import { enrich } from "./enrich.ts";
import { dedupe } from "./dedupe.ts";
import { publishBoard } from "./board.ts";
import { resolve } from "./resolve.ts";
import { loadYc } from "./yc.ts";

const { values } = parseArgs({
  options: {
    days: { type: "string" },
    steps: { type: "string", default: "ingest,prefilter,extract,resolve,judge,enrich,dedupe,publish,report" },
    limit: { type: "string" },
    concurrency: { type: "string", default: "8" },
    rejudge: { type: "boolean", default: false },
  },
});

const steps = new Set(values.steps!.split(","));
const concurrency = Number(values.concurrency);
const db = openDb();
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

if (steps.has("extract")) {
  const b = await balance();
  if (b !== null) {
    if (!getState(db, "kimi_balance_start")) setState(db, "kimi_balance_start", String(b));
    console.log(`Kimi balance: $${b.toFixed(2)}`);
  }
}

if (steps.has("ingest")) {
  console.log(`[${elapsed()}] YC directory: ${await loadYc(db)} companies refreshed`);
  const newest = (db.prepare("SELECT MAX(created_at) t FROM items").get() as { t: number | null }).t;
  const since = values.days ? now() - Number(values.days) * 86400 : (newest ?? now() - 86400) - 60;
  console.log(`[${elapsed()}] Ingest since ${new Date(since * 1000).toISOString()}`);
  const result = await ingest(db, { since });
  console.log(`[${elapsed()}] Ingested`, result);
}
if (steps.has("prefilter")) console.log(`[${elapsed()}] Prefilter`, prefilter(db));
if (steps.has("extract")) {
  const result = await extract(db, { limit: values.limit ? Number(values.limit) : undefined, concurrency });
  console.log(`[${elapsed()}] Extract`, result);
  const b = await balance();
  if (b !== null) setState(db, "kimi_balance_latest", String(b));
}
if (steps.has("resolve")) console.log(`[${elapsed()}] Resolve`, resolve(db));
if (steps.has("judge")) {
  const result = await judge(db, { all: values.rejudge, concurrency });
  console.log(`[${elapsed()}] Judge`, result);
}
// Dedupe runs on both sides of enrichment: names and domains first, then
// again once enriched websites reveal more pairs (each pair is asked once).
if (steps.has("dedupe")) console.log(`[${elapsed()}] Dedupe`, await dedupe(db, { concurrency }));
if (steps.has("enrich")) {
  const result = await enrich(db, { concurrency });
  console.log(`[${elapsed()}] Enrich`, result);
  if (steps.has("dedupe")) console.log(`[${elapsed()}] Dedupe (after enrich)`, await dedupe(db, { concurrency }));
}
if (steps.has("publish")) console.log(`[${elapsed()}] Publish`, publishBoard(db));
if (steps.has("enrich") || steps.has("dedupe")) {
  const b = await balance();
  if (b !== null) setState(db, "kimi_balance_latest", String(b));
}
if (steps.has("report")) console.log(`[${elapsed()}] Report: ${writeReport(db)}`);
