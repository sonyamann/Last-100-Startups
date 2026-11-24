// Step 7: merge companies that are really one company under two names or
// domains ("Kimi" on moonshot.cn and "Moonshot" on moonshot.ai; "Pierre"
// and "Pierre Computer"). Code proposes candidate pairs cheaply; Jev decides.
// Each pair is asked about once (pair_checks).
//
// Candidates, among companies mentioned in the last 30 days:
// - the same domain name under different TLDs (moonshot.cn / moonshot.ai);
// - one's enriched website domain is the other's domain.
// (A name-prefix rule was tried in M2 and dropped: Jev merged "Surface Book"
// into "Surface Labs" and "Time" into "Time Warner". Every real duplicate it
// found also shared a domain name.)

import { type DB, tx } from "../lib/db.ts";
import { ask, noul } from "../lib/jev.ts";
import { domainKey, slugify } from "../lib/names.ts";
import { WINDOW_DAYS } from "../lib/startups.ts";
import { mapLimit, now } from "../lib/util.ts";

const SAME_THRESHOLD = 0.7;

interface Co {
  id: number;
  name: string;
  domain: string | null;
  enrichment: string | null;
  n: number;
}

const label = (domain: string | null) => (domain ? domain.split(".")[0]! : null);

function website(c: Co): string | null {
  if (!c.enrichment) return null;
  const e = JSON.parse(c.enrichment) as { matched?: boolean; website?: string | null };
  return e.matched ? domainKey(e.website) : null;
}

function candidatePairs(cos: Co[]): [Co, Co][] {
  const pairs = new Map<string, [Co, Co]>();
  const add = (x: Co, y: Co) => {
    if (x.id === y.id) return;
    const [a, b] = x.id < y.id ? [x, y] : [y, x];
    pairs.set(`${a.id}:${b.id}`, [a, b]);
  };
  // Group by domain label and by enriched website.
  const byLabel = new Map<string, Co[]>();
  for (const c of cos) {
    for (const key of [label(c.domain), label(website(c))]) {
      if (!key || key.length < 3) continue;
      const list = byLabel.get(key) ?? [];
      if (!list.includes(c)) list.push(c);
      byLabel.set(key, list);
    }
  }
  for (const list of byLabel.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) add(list[i]!, list[j]!);
  return [...pairs.values()];
}

function describe(db: DB, c: Co) {
  const quotes = db.prepare("SELECT evidence FROM mentions WHERE company_id = ? AND evidence IS NOT NULL ORDER BY id DESC LIMIT 3").all(c.id) as { evidence: string }[];
  const e = c.enrichment ? (JSON.parse(c.enrichment) as { matched?: boolean; one_liner?: string | null; website?: string | null }) : null;
  return {
    name: c.name,
    domain: c.domain,
    ...(e?.matched ? { website: e.website, description: e.one_liner } : {}),
    quotes: quotes.map((q) => q.evidence),
  };
}

function merge(db: DB, keep: Co, drop: Co): void {
  tx(db, () => {
    db.prepare("UPDATE mentions SET company_id = ? WHERE company_id = ?").run(keep.id, drop.id);
    db.prepare("UPDATE aliases SET company_id = ? WHERE company_id = ?").run(keep.id, drop.id);
    db.prepare(
      `UPDATE companies SET domain = COALESCE(domain, (SELECT domain FROM companies WHERE id = ?)),
         yc_slug = COALESCE(yc_slug, (SELECT yc_slug FROM companies WHERE id = ?)),
         enrichment = COALESCE(enrichment, (SELECT enrichment FROM companies WHERE id = ?)),
         enriched_at = COALESCE(enriched_at, (SELECT enriched_at FROM companies WHERE id = ?))
       WHERE id = ?`,
    ).run(drop.id, drop.id, drop.id, drop.id, keep.id);
    db.prepare("DELETE FROM pair_checks WHERE a = ? OR b = ?").run(drop.id, drop.id);
    db.prepare("DELETE FROM companies WHERE id = ?").run(drop.id);
  });
}

export async function dedupe(db: DB, opts: { concurrency?: number; log?: (s: string) => void } = {}): Promise<{ candidates: number; asked: number; merged: number }> {
  const log = opts.log ?? console.log;
  const cos = db
    .prepare(
      `SELECT c.id, c.name, c.domain, c.enrichment, COUNT(m.id) n
       FROM companies c JOIN mentions m ON m.company_id = c.id JOIN items i ON i.id = m.item_id
       WHERE c.denylisted = 0 AND i.created_at >= ? GROUP BY c.id`,
    )
    .all(now() - WINDOW_DAYS * 86400) as unknown as Co[];
  const checked = db.prepare("SELECT same_p FROM pair_checks WHERE a = ? AND b = ?");
  const record = db.prepare("INSERT OR REPLACE INTO pair_checks (a, b, same_p, checked_at) VALUES (?, ?, ?, ?)");
  const pairs = candidatePairs(cos).filter(([a, b]) => !checked.get(a.id, b.id));

  const same: [Co, Co, number, string][] = [];
  await mapLimit(pairs, opts.concurrency ?? 8, async ([a, b]) => {
    try {
      const ans = await ask(
        db,
        { a: describe(db, a), b: describe(db, b) },
        {
          same: {
            type: "noul",
            instructions:
              "Do `a` and `b` refer to the same company? Count it as the same if they are two spellings of one company, or one is a company and the other is that company's own product. Count it as different if they are different companies that happen to share a word or a domain name.",
          },
          // Asked speculatively alongside `same`; only used if they merge.
          company_name: {
            type: "choice",
            instructions:
              "Suppose `a` and `b` are the same company. Which name is the company's own name, as opposed to the name of one of its products (for example \"Moonshot AI\" rather than its chatbot \"Kimi\")? If both are names for the company itself, pick the one people use most.",
            criteria: { a: `a.name: ${a.name}`, b: `b.name: ${b.name}` },
          },
        },
        "dedupe",
      );
      const p = noul(ans.same);
      record.run(a.id, b.id, p, now());
      const pick = ans.company_name.type === "choice" ? ans.company_name.choice : "a";
      if (p >= SAME_THRESHOLD) same.push([a, b, p, pick === "b" ? b.name : a.name]);
    } catch (err) {
      log(`  dedupe check failed for ${a.name} / ${b.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Merge into whichever has more mentions; follow chains (A→B, B→C). The
  // merged company takes the company's own name (Jev's pick), so a product
  // merged with its maker is shown under the maker's name.
  const into = new Map<number, Co>();
  const resolve = (c: Co): Co => (into.has(c.id) ? resolve(into.get(c.id)!) : c);
  const rename = db.prepare("UPDATE companies SET name = ?, slug = ? WHERE id = ?");
  const slugTaken = db.prepare("SELECT 1 FROM companies WHERE slug = ? AND id != ?");
  let merged = 0;
  for (const [x, y, p, companyName] of same.sort((s, t) => t[2] - s[2])) {
    const a = resolve(x);
    const b = resolve(y);
    if (a.id === b.id) continue;
    const [keep, drop] = a.n >= b.n ? [a, b] : [b, a];
    merge(db, keep, drop);
    if (companyName !== keep.name) {
      let slug = slugify(companyName);
      for (let k = 2; slugTaken.get(slug, keep.id); k++) slug = `${slugify(companyName)}-${k}`;
      rename.run(companyName, slug, keep.id);
      keep.name = companyName;
    }
    keep.n += drop.n;
    into.set(drop.id, keep);
    merged++;
    log(`  merged "${drop.name}" into "${keep.name}" (p=${p.toFixed(2)})`);
  }
  return { candidates: pairs.length, asked: pairs.length, merged };
}
