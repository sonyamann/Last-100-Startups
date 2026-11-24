// The acquisition counters: POST /startups/api/acquire records a startup
// fed to a mouth; GET /startups/api/acquisitions returns the totals across
// all visitors. The page shows each visitor their own tally instead (a
// shared count confused people, since every visit starts fresh); these
// totals are for Sonya. Lightly rate-limited and nothing more.

import type { DB } from "../lib/db.ts";

// Keep in sync with ACQUIRERS in web/src/acquirers.ts.
const ACQUIRERS = new Set(["google", "meta", "microsoft", "salesforce", "anthropic", "openai"]);
const TARGET = /^[a-z0-9+-]{1,500}$/;
const PER_HOUR = 120;

export function createAcquisitions(db: DB) {
  const insert = db.prepare("INSERT INTO acquisitions (target, acquirer, at) VALUES (?, ?, ?)");
  const byAcquirer = db.prepare("SELECT acquirer, COUNT(*) n FROM acquisitions GROUP BY acquirer");
  const recent = new Map<string, number[]>();

  function counts(): { counts: Record<string, number>; total: number } {
    const rows = byAcquirer.all() as { acquirer: string; n: number }[];
    const out: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      out[r.acquirer] = r.n;
      total += r.n;
    }
    return { counts: out, total };
  }

  function record(body: unknown, ip: string): { status: number; body: unknown } {
    const { target, acquirer } = (body ?? {}) as { target?: unknown; acquirer?: unknown };
    if (typeof target !== "string" || !TARGET.test(target) || typeof acquirer !== "string" || !ACQUIRERS.has(acquirer)) {
      return { status: 400, body: { error: "Send target and acquirer." } };
    }
    const hourAgo = Date.now() - 3600_000;
    const list = (recent.get(ip) ?? []).filter((t) => t > hourAgo);
    if (list.length < PER_HOUR) {
      list.push(Date.now());
      recent.set(ip, list);
      insert.run(target, acquirer, Math.floor(Date.now() / 1000));
    }
    return { status: 200, body: counts() };
  }

  return { counts, record };
}
