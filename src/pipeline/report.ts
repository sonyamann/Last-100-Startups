// Writes reports/pipeline-report.md: what the pipeline did, what it cost,
// the board it would show, how often each startup comes up, and a random
// sample of mentions for checking precision by hand.
// Run directly: npm run report

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EXCLUDED_YC_STATUS, THRESHOLDS } from "../config.ts";
import { type DB, getState, openDb } from "../lib/db.ts";
import { IS_STARTUP, MENTION_KEY } from "../lib/startups.ts";
import { now } from "../lib/util.ts";

const excludedStatuses = [...EXCLUDED_YC_STATUS].map((s) => `'${s}'`).join(",");

const hnLink = (id: number) => `https://news.ycombinator.com/item?id=${id}`;
const esc = (s: string | null | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

export function buildReport(db: DB): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const all = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];
  const one = <T>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;

  const span = one<{ lo: number; hi: number }>("SELECT MIN(created_at) lo, MAX(created_at) hi FROM items");
  p("# Pipeline report");
  p();
  p(`Generated ${day(now())} UTC. Items span ${day(span.lo)} → ${day(span.hi)} UTC.`);
  p();

  p("## Funnel");
  p();
  p("| Kind | Items | Passed prefilter | Extracted | With ≥1 company |");
  p("|---|---:|---:|---:|---:|");
  for (const r of all<{ kind: string; n: number; pass: number; ext: number; hit: number }>(
    `SELECT kind, COUNT(*) n, SUM(prefilter='pass') pass, SUM(extracted_at IS NOT NULL) ext,
       SUM(EXISTS(SELECT 1 FROM mentions m WHERE m.item_id = items.id)) hit FROM items GROUP BY kind ORDER BY n DESC`,
  )) {
    p(`| ${r.kind} | ${r.n} | ${r.pass} (${pct(r.pass, r.n)}) | ${r.ext} | ${r.hit} (${pct(r.hit, r.ext)} of extracted) |`);
  }
  p();
  p("Prefilter reasons (comments), and how often each reason led to a company:");
  p();
  p("| Reason | Comments | Extracted | Named a company |");
  p("|---|---:|---:|---:|");
  for (const r of all<{ reason: string; n: number; ext: number; hit: number }>(
    `SELECT prefilter_reason reason, COUNT(*) n, SUM(extracted_at IS NOT NULL) ext,
       SUM(EXISTS(SELECT 1 FROM mentions m WHERE m.item_id = items.id)) hit FROM items WHERE kind='comment' GROUP BY reason ORDER BY n DESC`,
  )) {
    p(`| ${r.reason} | ${r.n} | ${r.ext} | ${r.hit} (${pct(r.hit, r.ext)}) |`);
  }
  p();

  const counts = one<{ mentions: number; companies: number; judged: number; denied: number; startups: number }>(
    `SELECT (SELECT COUNT(*) FROM mentions) mentions, (SELECT COUNT(*) FROM companies) companies,
       (SELECT COUNT(*) FROM companies WHERE judged_at IS NOT NULL) judged, (SELECT COUNT(*) FROM companies WHERE denylisted=1) denied,
       (SELECT COUNT(*) FROM companies c WHERE ${IS_STARTUP}) startups`,
  );
  p(`Mentions: **${counts.mentions}**. Companies: **${counts.companies}** (judged ${counts.judged}, denylisted ${counts.denied}). Startups: **${counts.startups}**.`);
  p();

  p("## Cost");
  p();
  p("| Provider | Purpose | Calls | Input tokens | Output tokens |");
  p("|---|---|---:|---:|---:|");
  for (const r of all<{ provider: string; purpose: string; calls: number; i: number; o: number }>(
    "SELECT provider, purpose, COUNT(*) calls, SUM(input_tokens) i, SUM(output_tokens) o FROM usage GROUP BY provider, purpose",
  )) {
    p(`| ${r.provider} | ${r.purpose} | ${r.calls} | ${r.i.toLocaleString()} | ${r.o.toLocaleString()} |`);
  }
  const before = getState(db, "kimi_balance_start");
  const after = getState(db, "kimi_balance_latest");
  if (before && after) p(`\nKimi balance: $${Number(before).toFixed(2)} → $${Number(after).toFixed(2)} (spent **$${(Number(before) - Number(after)).toFixed(2)}**).`);
  p();

  const t30 = now() - 30 * 86400;
  p("## The board: last 100 startups mentioned");
  p();
  p("Bubble size = mentions in the last 30 days (each commenter counted once per thread).");
  p();
  p("| # | Startup | 30-day mentions | Last mentioned | Latest mention | Startup p |");
  p("|---:|---|---:|---|---|---:|");
  const board = all<{ name: string; domain: string | null; n30: number; last: number; item: number; ev: string; sp: number }>(
    `SELECT c.name, c.domain, c.startup_p sp,
       (SELECT COUNT(DISTINCT ${MENTION_KEY}) FROM mentions m JOIN items i ON i.id=m.item_id WHERE m.company_id=c.id AND i.created_at >= ?) n30,
       x.last, x.item, x.ev
     FROM companies c
     JOIN (SELECT m.company_id, MAX(i.created_at) last, i.id item, m.evidence ev FROM mentions m JOIN items i ON i.id=m.item_id GROUP BY m.company_id) x
       ON x.company_id = c.id
     WHERE ${IS_STARTUP}
     ORDER BY x.last DESC LIMIT 100`,
    t30,
  );
  board.forEach((r, i) => p(`| ${i + 1} | ${esc(r.name)}${r.domain ? ` (${r.domain})` : ""} | ${r.n30} | ${day(r.last)} | [${esc(r.ev).slice(0, 80)}](${hnLink(r.item)}) | ${r.sp.toFixed(2)} |`));
  p();

  p("## Most mentioned startups (30 days)");
  p();
  p("Mentions count each commenter once per thread; Raw counts every comment. The context columns count raw comments.");
  p();
  p("| # | Startup | Mentions | Raw | Recommended | Criticized | Employer | Own product |");
  p("|---:|---|---:|---:|---:|---:|---:|---:|");
  all<{ name: string; n: number; raw: number; rec: number; crit: number; emp: number; own: number }>(
    `SELECT c.name, COUNT(DISTINCT ${MENTION_KEY}) n, COUNT(*) raw, SUM(m.context='recommended') rec, SUM(m.context='criticized') crit, SUM(m.context='employer') emp, SUM(m.context='own_product') own
     FROM companies c JOIN mentions m ON m.company_id=c.id JOIN items i ON i.id=m.item_id
     WHERE i.created_at >= ? AND ${IS_STARTUP} GROUP BY c.id ORDER BY n DESC LIMIT 60`,
    t30,
  ).forEach((r, i) => p(`| ${i + 1} | ${esc(r.name)} | ${r.n} | ${r.raw} | ${r.rec} | ${r.crit} | ${r.emp} | ${r.own} |`));
  p();

  p("## Borderline: frequently mentioned, excluded or near the threshold");
  p();
  p("Companies with ≥2 mentions where Jev's startup probability is between 0.25 and 0.75, or that the denylist or YC status removed. Use this list to adjust the denylist and thresholds.");
  p();
  p("| Company | Mentions | Is company p | Startup p | Shown? | Why not |");
  p("|---|---:|---:|---:|---|---|");
  all<{ name: string; n: number; ic: number | null; sp: number | null; shown: number; denylisted: number; status: string | null; web: string | null; acq: string | null }>(
    `SELECT c.name, COUNT(m.id) n, c.is_company_p ic, c.startup_p sp, (${IS_STARTUP}) shown, c.denylisted, y.status,
       json_extract(c.enrichment, '$.status') web, json_extract(c.enrichment, '$.acquirer') acq
     FROM companies c JOIN mentions m ON m.company_id=c.id LEFT JOIN yc y ON y.slug=c.yc_slug
     GROUP BY c.id HAVING n >= 2 AND (c.denylisted=1 OR (c.startup_p BETWEEN 0.25 AND 0.75) OR y.status IN (${excludedStatuses})
       OR json_extract(c.enrichment, '$.status') IN ('acquired','public','shut_down'))
     ORDER BY n DESC LIMIT 80`,
  ).forEach((r) => {
    const why = r.shown ? "" : r.denylisted ? "denylist" : r.status && EXCLUDED_YC_STATUS.has(r.status) ? `YC: ${r.status}` :
      r.web && r.web !== "independent" ? `web: ${r.web}${r.acq ? ` (${r.acq})` : ""}` : (r.ic ?? 0) < THRESHOLDS.isCompany ? "not a company" : "below startup threshold";
    p(`| ${esc(r.name)} | ${r.n} | ${r.ic?.toFixed(2) ?? "–"} | ${r.sp?.toFixed(2) ?? "–"} | ${r.shown ? "yes" : "no"} | ${why} |`);
  });
  p();

  p("## Precision sample");
  p();
  p("40 random mentions of companies shown as startups. Check: is the quote really about that company, and is it a startup?");
  p();
  p("| Startup | Context | Quote | Item |");
  p("|---|---|---|---|");
  all<{ name: string; context: string; ev: string; item: number; kind: string }>(
    `SELECT c.name, m.context, m.evidence ev, m.item_id item, i.kind FROM mentions m JOIN companies c ON c.id=m.company_id JOIN items i ON i.id=m.item_id
     WHERE ${IS_STARTUP} ORDER BY random() LIMIT 40`,
  ).forEach((r) => p(`| ${esc(r.name)} | ${r.context} | ${esc(r.ev)} | [${r.kind}](${hnLink(r.item)}) |`));
  p();
  return out.join("\n");
}

export function writeReport(db: DB): string {
  const path = fileURLToPath(new URL("../../reports/pipeline-report.md", import.meta.url));
  mkdirSync(fileURLToPath(new URL("../../reports/", import.meta.url)), { recursive: true });
  writeFileSync(path, buildReport(db));
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Wrote ${writeReport(openDb())}`);
}
