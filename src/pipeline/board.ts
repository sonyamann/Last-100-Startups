// Step 8: write data/board.json, everything the page needs to draw the
// bubbles and their cards: the 100 most recently mentioned startups plus 20
// on standby (who float up when a bubble gets eaten), and the "recently
// devoured": companies HN mentioned this month that have already been
// acquired, shown under the acquirer mouths.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DB } from "../lib/db.ts";
import { nameKey } from "../lib/names.ts";
import { BOARD_SIZE, MENTION_KEY, STANDBY_SIZE, WINDOW_DAYS, rankStartups } from "../lib/startups.ts";
import { now } from "../lib/util.ts";
import type { Enrichment } from "./enrich.ts";

export interface Bubble {
  slug: string;
  name: string;
  size: number;              // mentions in the window, one per commenter per thread
  last_mentioned_at: number; // unix seconds
  lean: "loved" | "roasted" | "mixed" | null;
  website: string | null;
  one_liner: string | null;
  founded_year: number | null;
  hq: string | null;
  funding: { total_usd: number | null; last_round: string | null; last_round_usd: number | null; last_round_date: string | null; investors: string[] } | null;
  status: string | null;
  yc_batch: string | null;
  latest: { quote: string; author: string; url: string; at: number; thread: string | null };
  sources: string[];
}

export interface Devoured {
  slug: string;
  name: string;
  acquirer: string;
  acquired_date: string | null; // YYYY-MM
  size: number;                 // mentions in the window
  one_liner: string | null;
  website: string | null;
  latest: Bubble["latest"];
}

export interface Board {
  generated_at: number;
  window_days: number;
  bubbles: Bubble[];
  standby: Bubble[];
  devoured: Devoured[];
}

const boardPath = () => process.env.BOARD_PATH ?? fileURLToPath(new URL("../../data/board.json", import.meta.url));

// "loved" if recommendations clearly outnumber complaints, and vice versa.
function leanOf(rec: number, crit: number): Bubble["lean"] {
  if (rec + crit < 3) return null;
  if (rec >= 2 * crit) return "loved";
  if (crit >= 2 * rec) return "roasted";
  return "mixed";
}

export function buildBoard(db: DB): Board {
  const since = now() - WINDOW_DAYS * 86400;
  const ranked = rankStartups(db, BOARD_SIZE + STANDBY_SIZE);
  const company = db.prepare(
    `SELECT c.slug, c.name, c.domain, c.description, c.enrichment, y.batch AS yc_batch, y.website AS yc_website
     FROM companies c LEFT JOIN yc y ON y.slug = c.yc_slug WHERE c.id = ?`,
  );
  const stats = db.prepare(
    `SELECT COUNT(DISTINCT ${MENTION_KEY}) size, SUM(m.context = 'recommended') rec, SUM(m.context = 'criticized') crit
     FROM mentions m JOIN items i ON i.id = m.item_id WHERE m.company_id = ? AND i.created_at >= ?`,
  );
  const latest = db.prepare(
    `SELECT m.evidence quote, i.author, i.id item, i.created_at at, COALESCE(i.story_title, i.title) thread
     FROM mentions m JOIN items i ON i.id = m.item_id WHERE m.company_id = ? AND m.evidence IS NOT NULL
     ORDER BY i.created_at DESC LIMIT 1`,
  );

  const bubbles = ranked.map((r): Bubble => {
    const c = company.get(r.id) as { slug: string; name: string; domain: string | null; description: string | null; enrichment: string | null; yc_batch: string | null; yc_website: string | null };
    const s = stats.get(r.id, since) as { size: number; rec: number; crit: number };
    const l = latest.get(r.id) as { quote: string; author: string; item: number; at: number; thread: string | null };
    const e = c.enrichment ? (JSON.parse(c.enrichment) as Enrichment) : null;
    const m = e?.matched ? e : null;
    return {
      slug: c.slug,
      name: c.name,
      size: s.size,
      last_mentioned_at: r.last,
      lean: leanOf(s.rec, s.crit),
      website: m?.website ?? c.yc_website ?? (c.domain ? `https://${c.domain}` : null),
      one_liner: m?.one_liner ?? c.description,
      founded_year: m?.founded_year ?? null,
      hq: m?.hq ?? null,
      funding: m && (m.total_funding_usd || m.last_round)
        ? { total_usd: m.total_funding_usd, last_round: m.last_round, last_round_usd: m.last_round_usd, last_round_date: m.last_round_date, investors: m.investors }
        : null,
      status: m?.status ?? null,
      yc_batch: c.yc_batch,
      latest: { quote: l.quote, author: l.author, url: `https://news.ycombinator.com/item?id=${l.item}`, at: l.at, thread: l.thread },
      sources: m?.sources ?? [],
    };
  });
  return { generated_at: now(), window_days: WINDOW_DAYS, bubbles: bubbles.slice(0, BOARD_SIZE), standby: bubbles.slice(BOARD_SIZE), devoured: buildDevoured(db, since) };
}

// Two names for one company ("Pierre" / "Pierre Computer", "Taalas" and the
// misspelt "Talaas"): one is a prefix of the other, or they're one or two
// letters apart.
function similar(a: string, b: string): boolean {
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 5) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]! <= 2;
}

// Acquired (per the web search or the YC directory) and mentioned in the
// window, with a known buyer; newest acquisitions first.
function buildDevoured(db: DB, since: number): Devoured[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.domain, c.enrichment, COUNT(DISTINCT ${MENTION_KEY}) size
       FROM companies c JOIN mentions m ON m.company_id = c.id JOIN items i ON i.id = m.item_id LEFT JOIN yc y ON y.slug = c.yc_slug
       WHERE c.denylisted = 0 AND c.is_company_p >= 0.3 AND i.created_at >= ?
         AND (json_extract(c.enrichment, '$.status') = 'acquired' OR y.status = 'Acquired')
         AND json_extract(c.enrichment, '$.acquirer') IS NOT NULL
       GROUP BY c.id ORDER BY size DESC`,
    )
    .all(since) as { id: number; slug: string; name: string; domain: string | null; enrichment: string; size: number }[];
  const latest = db.prepare(
    `SELECT m.evidence quote, i.author, i.id item, i.created_at at, COALESCE(i.story_title, i.title) thread
     FROM mentions m JOIN items i ON i.id = m.item_id WHERE m.company_id = ? AND m.evidence IS NOT NULL ORDER BY i.created_at DESC LIMIT 1`,
  );
  const out: Devoured[] = [];
  for (const r of rows) {
    const e = JSON.parse(r.enrichment) as Enrichment;
    const key = nameKey(r.name);
    // Most-mentioned first, so a duplicate folds into the better-known name.
    const dup = out.find((d) => d.acquirer.toLowerCase() === String(e.acquirer).toLowerCase() && similar(nameKey(d.name), key));
    if (dup) {
      dup.size += r.size;
      continue;
    }
    const l = latest.get(r.id) as { quote: string; author: string; item: number; at: number; thread: string | null };
    out.push({
      slug: r.slug,
      name: r.name,
      acquirer: e.acquirer!,
      acquired_date: e.acquired_date ?? null,
      size: r.size,
      one_liner: e.matched ? e.one_liner : null,
      website: (e.matched ? e.website : null) ?? (r.domain ? `https://${r.domain}` : null),
      latest: { quote: l.quote, author: l.author, url: `https://news.ycombinator.com/item?id=${l.item}`, at: l.at, thread: l.thread },
    });
  }
  return out.sort((a, b) => (b.acquired_date ?? "").localeCompare(a.acquired_date ?? ""));
}

// Written to a temp file and renamed, so the server never reads half a file.
export function publishBoard(db: DB): { path: string; bubbles: number; standby: number } {
  const board = buildBoard(db);
  const path = boardPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(board));
  renameSync(`${path}.tmp`, path);
  return { path, bubbles: board.bubbles.length, standby: board.standby.length };
}
