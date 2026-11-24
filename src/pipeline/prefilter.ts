// Step 2: decide which items Kimi reads. Extraction turned out to cost
// pennies a day, and a keyword prefilter missed about a quarter of startup
// mentions (M1 probe), so Kimi now reads nearly everything. Skipped:
// - comments too short to name anything, unless they carry a link;
// - job-ad threads (Who is hiring / Who wants to be hired / Freelancer),
//   which are ads rather than commenters mentioning companies.

import { type DB, tx } from "../lib/db.ts";

const JOB_THREADS = /^Ask HN: (Who is hiring|Who wants to be hired|Freelancer\? Seeking freelancer)/i;

export function classify(item: { kind: string; text: string; links: string; story_title: string | null }): { pass: boolean; reason: string } {
  if (item.kind !== "comment") return { pass: true, reason: "post" };
  if (item.story_title && JOB_THREADS.test(item.story_title)) return { pass: false, reason: "job_thread" };
  if (item.text.length < 40 && item.links === "[]") return { pass: false, reason: "short" };
  return { pass: true, reason: "comment" };
}

export function prefilter(db: DB): { pass: number; skip: number; reasons: Record<string, number> } {
  const todo = db.prepare("SELECT id, kind, text, links, story_title FROM items WHERE prefilter IS NULL").all() as {
    id: number; kind: string; text: string; links: string; story_title: string | null;
  }[];
  const update = db.prepare("UPDATE items SET prefilter = ?, prefilter_reason = ? WHERE id = ?");
  const reasons: Record<string, number> = {};
  let pass = 0;
  tx(db, () => {
    for (const item of todo) {
      const r = classify(item);
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      if (r.pass) pass++;
      update.run(r.pass ? "pass" : "skip", r.reason, item.id);
    }
  });
  return { pass, skip: todo.length - pass, reasons };
}
