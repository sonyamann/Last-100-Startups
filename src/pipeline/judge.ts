// Step 5: Jev decides, per company, whether it is a real company and whether
// it is a startup under STARTUP_POLICY. Known facts and editorial calls stay
// in code: the denylist, the allowlist, and YC's Acquired/Public/Inactive
// statuses override Jev.

import { ALLOWLIST, DENYLIST, STARTUP_POLICY } from "../config.ts";
import { type DB } from "../lib/db.ts";
import { ask, noul } from "../lib/jev.ts";
import { nameKey } from "../lib/names.ts";
import { mapLimit, now } from "../lib/util.ts";

const denied = new Set(DENYLIST.map(nameKey));
const allowed = new Set(ALLOWLIST.map(nameKey));

interface Company {
  id: number;
  name: string;
  domain: string | null;
  description: string | null;
  yc_batch: string | null;
  yc_status: string | null;
  yc_launched: number | null;
  yc_team: number | null;
  enrichment: string | null;
}

const QUESTIONS = {
  is_company: {
    type: "noul",
    instructions:
      "Is `company` an actual company, or a commercial product sold by a company? Use `company.mentions` to understand what the name refers to in context.",
    criteria: {
      true: "A business or a commercial product/service made by a business.",
      false: "An open-source project with no company, a hobby project, a programming language, framework, protocol or standard, an AI model named on its own (rather than the company that makes it), a person, a government body, university, nonprofit or publication, a generic term, or not identifiable.",
    },
  },
  startup: {
    type: "noul",
    instructions: "Under `policy`, does `company` count as a startup? Use your knowledge of the company, plus `company.yc`, `company.facts` (from a recent web search; prefer them over older knowledge) and `company.mentions` when present.",
  },
} as const;

// A YC match by name can be a different company with the same name. Jev
// compares the YC entry with how the mentions use the name; a mismatch drops
// the YC link (and the domain and alias that came with it) before judging.
async function verifyYc(db: DB, concurrency: number, log: (s: string) => void): Promise<void> {
  const todo = db
    .prepare(
      `SELECT c.id, c.name, c.domain, y.slug, y.name AS yc_name, y.one_liner, y.domain AS yc_domain
       FROM companies c JOIN yc y ON y.slug = c.yc_slug WHERE c.judged_at IS NULL AND c.denylisted = 0`,
    )
    .all() as { id: number; name: string; domain: string | null; slug: string; yc_name: string; one_liner: string | null; yc_domain: string | null }[];
  const mentionsOf = db.prepare(`SELECT m.name, m.domain, m.evidence, i.story_title FROM mentions m JOIN items i ON i.id = m.item_id WHERE m.company_id = ? LIMIT 4`);
  const unlink = db.prepare("UPDATE companies SET yc_slug = NULL, description = NULL, domain = ? WHERE id = ?");
  const dropAlias = db.prepare("DELETE FROM aliases WHERE key = ? AND company_id = ?");
  let dropped = 0;
  await mapLimit(todo, concurrency, async (c) => {
    const mentions = mentionsOf.all(c.id) as { name: string; domain: string | null; evidence: string | null; story_title: string | null }[];
    try {
      const a = await ask(
        db,
        {
          yc_company: { name: c.yc_name, website_domain: c.yc_domain, one_liner: c.one_liner },
          mentions: mentions.map((m) => ({ name_used: m.name, domain_given: m.domain, quote: m.evidence, thread: m.story_title })),
        },
        {
          same: {
            type: "noul",
            instructions: "Do `mentions` refer to the same company as `yc_company`, rather than a different company, product or thing that shares the name?",
          },
        },
        "verify_yc",
      );
      if (noul(a.same) < 0.5) {
        const ownDomain = mentions.find((m) => m.domain && m.domain !== c.yc_domain)?.domain ?? null;
        unlink.run(ownDomain, c.id);
        if (c.yc_domain) dropAlias.run(`domain:${c.yc_domain}`, c.id);
        dropped++;
      }
    } catch (err) {
      log(`  YC check failed for ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  if (todo.length) log(`  YC matches checked: ${todo.length}, dropped ${dropped}`);
}

// Web-search facts from enrich.ts, when the search found this company.
function factsFrom(enrichment: string | null): { facts?: Record<string, unknown> } {
  if (!enrichment) return {};
  const e = JSON.parse(enrichment) as Record<string, unknown>;
  if (!e.matched) return {};
  const keys = ["one_liner", "founded_year", "hq", "total_funding_usd", "last_round", "last_round_date", "valuation_usd", "status", "acquirer", "open_source"];
  return { facts: Object.fromEntries(keys.filter((k) => e[k] !== null && e[k] !== undefined).map((k) => [k, e[k]])) };
}

export async function judge(db: DB, opts: { all?: boolean; concurrency?: number; log?: (s: string) => void } = {}): Promise<{ judged: number; denylisted: number }> {
  const log = opts.log ?? console.log;
  // Denylist first: free, and it spares Jev the obvious ones.
  const all = db.prepare("SELECT id, name FROM companies").all() as { id: number; name: string }[];
  const setLists = db.prepare("UPDATE companies SET denylisted = ?, allowlisted = ? WHERE id = ?");
  let denylisted = 0;
  for (const c of all) {
    const key = nameKey(c.name);
    const d = denied.has(key) ? 1 : 0;
    denylisted += d;
    setLists.run(d, allowed.has(key) ? 1 : 0, c.id);
  }

  await verifyYc(db, opts.concurrency ?? 8, log);

  const todo = db
    .prepare(
      `SELECT c.id, c.name, c.domain, c.description, y.batch AS yc_batch, y.status AS yc_status, y.launched_at AS yc_launched, y.team_size AS yc_team, c.enrichment
       FROM companies c LEFT JOIN yc y ON y.slug = c.yc_slug
       WHERE c.denylisted = 0 ${opts.all ? "" : "AND c.judged_at IS NULL"}`,
    )
    .all() as unknown as Company[];
  const evidence = db.prepare(
    `SELECT m.evidence, m.context, i.kind FROM mentions m JOIN items i ON i.id = m.item_id WHERE m.company_id = ? AND m.evidence IS NOT NULL ORDER BY i.created_at DESC LIMIT 3`,
  );
  const save = db.prepare("UPDATE companies SET is_company_p = ?, startup_p = ?, judged_at = ? WHERE id = ?");

  let done = 0;
  await mapLimit(todo, opts.concurrency ?? 8, async (c) => {
    const mentions = evidence.all(c.id) as { evidence: string; context: string; kind: string }[];
    const state = {
      policy: STARTUP_POLICY,
      company: {
        name: c.name,
        domain: c.domain,
        ...(c.description ? { description: c.description } : {}),
        ...(c.yc_batch ? { yc: { batch: c.yc_batch, status: c.yc_status, team_size: c.yc_team, launched_year: c.yc_launched ? new Date(c.yc_launched * 1000).getUTCFullYear() : null } } : {}),
        mentions: mentions.map((m) => ({ quote: m.evidence, context: m.context, source: m.kind })),
        ...factsFrom(c.enrichment),
      },
    };
    try {
      const a = await ask(db, state, QUESTIONS, "judge");
      save.run(noul(a.is_company), noul(a.startup), now(), c.id);
    } catch (err) {
      log(`  judge failed for ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (++done % 100 === 0) log(`  judge: ${done}/${todo.length}`);
  });
  return { judged: todo.length, denylisted };
}
