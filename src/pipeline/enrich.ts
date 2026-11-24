// Step 6: details for the bubble cards. For each startup on the board or in
// standby that hasn't been enriched in 30 days:
//   1. two Kimi web searches: "<name> <domain> funding" and "<name> acquired";
//   2. Kimi (no thinking) turns only those results into facts, or nulls;
//   3. the company is re-judged by Jev with those facts in hand.
// Companies the search shows as acquired, public or shut down drop off the
// board, and the next ones are enriched in turn, until the board and standby
// are all enriched (or the round limit is hit).
//
// Then the "recently devoured" (acquired companies HN mentioned this month)
// that lack an acquirer or acquisition date are enriched too, mostly ones
// the YC directory marks Acquired without saying by whom.

import { type DB } from "../lib/db.ts";
import { chat, search, type SearchResult } from "../lib/kimi.ts";
import { domainKey } from "../lib/names.ts";
import { BOARD_SIZE, IS_STARTUP, STANDBY_SIZE, WINDOW_DAYS, rankStartups } from "../lib/startups.ts";
import { mapLimit, now } from "../lib/util.ts";
import { judge } from "./judge.ts";

const REFRESH_DAYS = 30;
const MAX_ROUNDS = 4;

export interface Enrichment {
  matched: boolean;               // false if the results were about something else
  website: string | null;
  one_liner: string | null;
  founded_year: number | null;
  hq: string | null;
  total_funding_usd: number | null;
  last_round: string | null;      // e.g. "Series A"
  last_round_usd: number | null;
  last_round_date: string | null; // YYYY-MM or YYYY-MM-DD
  valuation_usd: number | null;
  investors: string[];
  status: "independent" | "acquired" | "public" | "shut_down" | null;
  acquirer: string | null;
  acquired_date: string | null;   // YYYY-MM (or YYYY), when acquired
  open_source: boolean | null;    // is the product mainly an open-source project?
  sources: string[];
}

const SYSTEM = `You fill in a company profile from web search results.
Use ONLY the search results given. If they don't say something, use null (or [] for lists). Never guess from memory.
The results may be about a different company or thing with the same name: use "domain" and "mentions" to tell. If none of the results are about this company, set "matched": false and everything else null.
For "website", give the company's main English-language (international) site when it has one, rather than a regional or non-English site (for example moonshot.ai rather than moonshot.cn).
Prefer the most recent figures. Amounts are plain numbers in US dollars (15000000, not "$15M").

Answer with JSON only:
{"matched": true, "website": "https://...", "one_liner": "what it makes, under 15 words, plain and specific",
 "founded_year": 2023, "hq": "City, Country", "total_funding_usd": 19500000, "last_round": "Series A", "last_round_usd": 15000000,
 "last_round_date": "2025-11", "valuation_usd": null, "investors": ["up to 4 lead investors"],
 "status": "independent | acquired | public | shut_down", "acquirer": null, "acquired_date": "YYYY-MM when acquired, else null", "open_source": false,
 "sources": ["up to 3 result URLs you relied on"]}`;

function context(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}${r.date ? ` (${r.date})` : ""}\n${r.snippet}`).join("\n\n");
}

export async function enrichOne(db: DB, c: { id: number; name: string; domain: string | null }): Promise<Enrichment | null> {
  const where = c.domain ? ` ${c.domain}` : "";
  const [funding, acquired] = await Promise.all([search(db, `${c.name}${where} funding`, 6), search(db, `${c.name}${where} acquired`, 4)]);
  const seen = new Set<string>();
  const results = [...funding, ...acquired].filter((r) => !seen.has(r.url) && seen.add(r.url));
  // No results at all is usually a search timeout under load, not an unknown
  // company: save nothing, so the next run tries again.
  if (results.length === 0) return null;
  const quotes = db
    .prepare("SELECT evidence FROM mentions WHERE company_id = ? AND evidence IS NOT NULL ORDER BY id DESC LIMIT 3")
    .all(c.id) as { evidence: string }[];
  const prompt = JSON.stringify({ company: c.name, domain: c.domain, mentions: quotes.map((q) => q.evidence) }) + `\n\nSearch results:\n${context(results)}`;
  const out = await chat(db, [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], { purpose: "enrich", json: true });
  const e = JSON.parse(out) as Partial<Enrichment>;
  return {
    matched: e.matched !== false && results.length > 0,
    website: e.website ?? null,
    one_liner: e.one_liner ?? null,
    founded_year: typeof e.founded_year === "number" ? e.founded_year : null,
    hq: e.hq ?? null,
    total_funding_usd: typeof e.total_funding_usd === "number" ? e.total_funding_usd : null,
    last_round: e.last_round ?? null,
    last_round_usd: typeof e.last_round_usd === "number" ? e.last_round_usd : null,
    last_round_date: e.last_round_date ?? null,
    valuation_usd: typeof e.valuation_usd === "number" ? e.valuation_usd : null,
    investors: Array.isArray(e.investors) ? e.investors.slice(0, 4) : [],
    status: e.status && ["independent", "acquired", "public", "shut_down"].includes(e.status) ? e.status : null,
    acquirer: e.acquirer ?? null,
    acquired_date: typeof e.acquired_date === "string" && /^\d{4}(-\d{2})?/.test(e.acquired_date) ? e.acquired_date.slice(0, 7) : null,
    open_source: typeof e.open_source === "boolean" ? e.open_source : null,
    sources: Array.isArray(e.sources) ? e.sources.slice(0, 3) : [],
  };
}

export async function enrich(db: DB, opts: { concurrency?: number; log?: (s: string) => void } = {}): Promise<{ enriched: number; dropped: number; failed: number }> {
  const log = opts.log ?? console.log;
  const stale = now() - REFRESH_DAYS * 86400;
  const get = db.prepare("SELECT id, name, domain, enriched_at FROM companies WHERE id = ?");
  const save = db.prepare("UPDATE companies SET enrichment = ?, enriched_at = ?, judged_at = NULL, domain = COALESCE(domain, ?) WHERE id = ?");
  const isShown = db.prepare(`SELECT 1 FROM companies c WHERE c.id = ? AND ${IS_STARTUP}`);
  let enriched = 0;
  let failed = 0;
  let dropped = 0;
  const tried = new Set<number>();

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const todo = rankStartups(db, BOARD_SIZE + STANDBY_SIZE)
      .map((r) => get.get(r.id) as { id: number; name: string; domain: string | null; enriched_at: number | null })
      .filter((c) => !tried.has(c.id) && (c.enriched_at === null || c.enriched_at < stale));
    if (todo.length === 0) break;
    log(`  enrich round ${round}: ${todo.length} companies`);
    await mapLimit(todo, opts.concurrency ?? 8, async (c) => {
      tried.add(c.id);
      try {
        const e = await enrichOne(db, c);
        if (!e) {
          failed++;
          return;
        }
        save.run(JSON.stringify(e), now(), e.matched ? domainKey(e.website) : null, c.id);
        enriched++;
      } catch (err) {
        failed++;
        log(`  enrich failed for ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    // Re-judge with the new facts; anything no longer a startup leaves the
    // ranking, and the next round enriches whoever moved up.
    await judge(db, { concurrency: opts.concurrency, log: () => {} });
    const lost = todo.filter((c) => !isShown.get(c.id)).length;
    dropped += lost;
    if (lost) log(`  ${lost} no longer count as startups after enrichment`);
  }

  // The recently devoured: acquired (per the web or YC) and mentioned in
  // the window, and not yet looked up for who bought them and when.
  const devoured = db
    .prepare(
      `SELECT DISTINCT c.id, c.name, c.domain FROM companies c
       JOIN mentions m ON m.company_id = c.id JOIN items i ON i.id = m.item_id LEFT JOIN yc y ON y.slug = c.yc_slug
       WHERE c.denylisted = 0 AND c.is_company_p >= 0.3 AND i.created_at >= ?
         AND (json_extract(c.enrichment, '$.status') = 'acquired' OR y.status = 'Acquired')
         -- Never enriched, enriched before acquired_date existed (the key
         -- is missing, not null), or due for the 30-day refresh. A search
         -- that found no date stores null and isn't retried until then.
         AND (c.enrichment IS NULL OR json_type(c.enrichment, '$.acquired_date') IS NULL OR c.enriched_at < ?)`,
    )
    .all(now() - WINDOW_DAYS * 86400, stale) as { id: number; name: string; domain: string | null }[];
  const todo = devoured.filter((c) => !tried.has(c.id));
  if (todo.length) {
    log(`  enrich devoured: ${todo.length} companies`);
    await mapLimit(todo, opts.concurrency ?? 8, async (c) => {
      tried.add(c.id);
      try {
        const e = await enrichOne(db, c);
        if (!e) return void failed++;
        save.run(JSON.stringify(e), now(), e.matched ? domainKey(e.website) : null, c.id);
        enriched++;
      } catch (err) {
        failed++;
        log(`  enrich failed for ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    await judge(db, { concurrency: opts.concurrency, log: () => {} });
  }
  return { enriched, dropped, failed };
}
