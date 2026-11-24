// POST /startups/api/merge: turns a drop of one bubble onto another into a
// mashup. The request names the bubbles being merged as `parts`, each a list
// of the real startups' slugs it contains (one slug for a plain bubble,
// several for an earlier mashup):
//   {"parts": [["kino-ai"], ["momentic"]]}
//   {"parts": [["kino-ai", "momentic"], ["kalshi"]]}   // merging a merger
//
// Cost controls:
// - every combination is written once and cached forever;
// - the same combination requested twice at once shares one Kimi call;
// - each visitor can create MASHUPS_PER_HOUR new ones an hour (cached ones
//   are free and unlimited);
// - a global daily cap, after which the merger is "under regulatory review";
// - when Kimi's queue is already MAX_QUEUE_SECONDS long (a traffic spike),
//   new ones are turned away at once instead of waiting for minutes.

import { readFileSync, statSync } from "node:fs";
import type { DB } from "../lib/db.ts";
import { MASHUP_MODEL, writeMashup, type Lineage, type Mashup, type MashupInput } from "../lib/mashup.ts";
import type { Board, Bubble } from "../pipeline/board.ts";
import { queueDelayMs } from "../lib/kimi.ts";

const MAX_STARTUPS = 6;
const MASHUPS_PER_HOUR = Number(process.env.MASHUPS_PER_HOUR ?? 20);
const DAILY_CAP = Number(process.env.MASHUP_DAILY_CAP ?? 20000);
const MAX_QUEUE_SECONDS = Number(process.env.MASHUP_MAX_QUEUE_SECONDS ?? 30);
const SLUG = /^[a-z0-9-]{1,80}$/;

export type MergeResult =
  | { status: 200; body: { mashup: Mashup; cached: boolean } }
  | { status: 400 | 404 | 429 | 503; body: { error: string; state?: "rate_limited" | "regulatory_review" | "busy" | "failed" } };

export function mashupKey(slugs: string[]): string {
  return [...new Set(slugs)].sort().join("+");
}

export function createMerges(db: DB, opts: { boardPath: string; log?: (s: string) => void }) {
  const log = opts.log ?? console.error;
  let board: { mtime: number; bySlug: Map<string, Bubble> } | null = null;
  const recent = new Map<string, number[]>();
  const inFlight = new Map<string, Promise<Mashup>>();

  const getCached = db.prepare("SELECT payload FROM mashups WHERE key = ?");
  const hit = db.prepare("UPDATE mashups SET hits = hits + 1 WHERE key = ?");
  const save = db.prepare("INSERT OR IGNORE INTO mashups (key, payload, model, created_at) VALUES (?, ?, ?, ?)");
  const madeToday = db.prepare("SELECT COUNT(*) n FROM mashups WHERE created_at >= ?");
  const fromDb = db.prepare("SELECT name, description, enrichment FROM companies WHERE slug = ?");

  // The board is re-read whenever the pipeline rewrites it.
  function bubble(slug: string): Bubble | null {
    try {
      const mtime = statSync(opts.boardPath).mtimeMs;
      if (!board || board.mtime !== mtime) {
        const b = JSON.parse(readFileSync(opts.boardPath, "utf8")) as Board;
        board = { mtime, bySlug: new Map([...b.bubbles, ...b.standby].map((x) => [x.slug, x])) };
      }
    } catch {
      // Keep the last good board.
    }
    return board?.bySlug.get(slug) ?? null;
  }

  // What Kimi gets told about each real startup. A startup that has left the
  // board since the visitor loaded the page is still found in the database.
  function input(slug: string): MashupInput | null {
    const b = bubble(slug);
    if (b) {
      const total = b.funding?.total_usd;
      return {
        name: b.name,
        one_liner: b.one_liner,
        funding: total ? `about $${total >= 1e9 ? `${(total / 1e9).toFixed(1)}B` : `${(total / 1e6).toFixed(1)}M`} raised` : null,
        lean: b.lean,
        quote: b.latest.quote,
      };
    }
    const c = fromDb.get(slug) as { name: string; description: string | null; enrichment: string | null } | undefined;
    if (!c) return null;
    const e = c.enrichment ? (JSON.parse(c.enrichment) as { matched?: boolean; one_liner?: string | null }) : null;
    return { name: c.name, one_liner: (e?.matched ? e.one_liner : null) ?? c.description, funding: null, lean: null, quote: null };
  }

  function allow(ip: string): boolean {
    const hourAgo = Date.now() - 3600_000;
    const list = (recent.get(ip) ?? []).filter((t) => t > hourAgo);
    if (list.length >= MASHUPS_PER_HOUR) return false;
    list.push(Date.now());
    recent.set(ip, list);
    return true;
  }

  return async function merge(body: unknown, ip: string): Promise<MergeResult> {
    const parts = (body as { parts?: unknown })?.parts;
    if (!Array.isArray(parts) || parts.length < 2 || !parts.every((p) => Array.isArray(p) && p.length > 0 && p.every((s) => typeof s === "string" && SLUG.test(s)))) {
      return { status: 400, body: { error: "Send parts: at least two lists of startup slugs." } };
    }
    const slugs = (parts as string[][]).flat();
    if (new Set(slugs).size !== slugs.length) return { status: 400, body: { error: "A startup can't merge with itself." } };
    if (slugs.length > MAX_STARTUPS) return { status: 400, body: { error: `Antitrust: at most ${MAX_STARTUPS} startups per merger.`, state: "regulatory_review" } };

    const key = mashupKey(slugs);
    const cached = getCached.get(key) as { payload: string } | undefined;
    if (cached) {
      hit.run(key);
      return { status: 200, body: { mashup: JSON.parse(cached.payload) as Mashup, cached: true } };
    }

    const inputs = slugs.map(input);
    if (inputs.some((x) => !x)) return { status: 404, body: { error: "One of those startups isn't on the board." } };

    let pending = inFlight.get(key);
    if (!pending) {
      const startOfDay = Math.floor(Date.now() / 86400_000) * 86400;
      if ((madeToday.get(startOfDay) as { n: number }).n >= DAILY_CAP) {
        return { status: 503, body: { error: "This merger is under regulatory review. Try again tomorrow.", state: "regulatory_review" } };
      }
      // Checked before the visitor's hourly allowance, which this doesn't use up.
      if (queueDelayMs() > MAX_QUEUE_SECONDS * 1000) {
        return { status: 503, body: { error: "Too many deals on the table right now. Try again in a minute.", state: "busy" } };
      }
      if (!allow(ip)) return { status: 429, body: { error: "Slow down, you're consolidating the industry too fast. Try again in a bit.", state: "rate_limited" } };

      // Earlier mashups among the parts become the new one's "legacy business".
      const lineage: Lineage[] = [];
      for (const p of parts as string[][]) {
        if (p.length < 2) continue;
        const prev = getCached.get(mashupKey(p)) as { payload: string } | undefined;
        if (prev) {
          const m = JSON.parse(prev.payload) as Mashup;
          lineage.push({ name: m.name, tagline: m.tagline, made_from: m.made_from });
        }
      }
      pending = writeMashup(db, key, inputs as MashupInput[], lineage).then((m) => {
        save.run(key, JSON.stringify(m), MASHUP_MODEL, m.created_at);
        return m;
      });
      inFlight.set(key, pending);
      pending.finally(() => inFlight.delete(key)).catch(() => {});
    }
    try {
      return { status: 200, body: { mashup: await pending, cached: false } };
    } catch (err) {
      log(`mashup ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 503, body: { error: "The deal fell through. Try again?", state: "failed" } };
    }
  };
}

export function loadMashup(db: DB, key: string): Mashup | null {
  const row = db.prepare("SELECT payload FROM mashups WHERE key = ?").get(key) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as Mashup) : null;
}
