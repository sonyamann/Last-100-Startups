// Step 1: pull HN comments, Show HN posts and Launch HN posts into `items`.
// Safe to re-run: items already stored are skipped. For each kind, a run
// covers [since, now], so a backfill and a regular poll are the same call
// with a different `since`.

import { type DB, tx } from "../lib/db.ts";
import { htmlToText, pagesByDate, type AlgoliaHit } from "../lib/hn.ts";
import { now } from "../lib/util.ts";

type Kind = "comment" | "show_hn" | "launch_hn";

function toRow(kind: Kind, h: AlgoliaHit) {
  if (kind === "comment") {
    const { text, links } = htmlToText(h.comment_text);
    return { title: null, url: null, text, links };
  }
  const body = htmlToText(h.story_text);
  const links = h.url ? [h.url, ...body.links] : body.links;
  const title = h.title ?? "";
  const text = [title, h.url ? `(${h.url})` : "", body.text].filter(Boolean).join("\n\n");
  return { title, url: h.url ?? null, text, links };
}

export async function ingest(db: DB, opts: { since: number; until?: number; log?: (s: string) => void }): Promise<Record<Kind, number>> {
  const log = opts.log ?? console.log;
  const until = opts.until ?? now();
  const insert = db.prepare(`INSERT OR IGNORE INTO items (id, kind, author, created_at, story_id, story_title, title, url, text, links)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const counts: Record<Kind, number> = { comment: 0, show_hn: 0, launch_hn: 0 };
  // Launch HN first: if a post ever carries both tags, INSERT OR IGNORE keeps
  // the more specific kind.
  for (const kind of ["launch_hn", "show_hn", "comment"] as Kind[]) {
    for await (const hits of pagesByDate(kind, opts.since, until)) {
      const added = tx(db, () => {
        let n = 0;
        for (const h of hits) {
          const r = toRow(kind, h);
          if (!r.text) continue;
          const res = insert.run(Number(h.objectID), kind, h.author, h.created_at_i, h.story_id ?? null, h.story_title ?? null, r.title, r.url, r.text, JSON.stringify(r.links));
          n += Number(res.changes);
        }
        return n;
      });
      counts[kind] += added;
      const oldest = new Date(Math.min(...hits.map((h) => h.created_at_i)) * 1000).toISOString().slice(0, 16);
      log(`  ${kind}: +${added} (back to ${oldest})`);
    }
  }
  return counts;
}
