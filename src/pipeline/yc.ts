// Loads the public YC company directory (github.com/yc-oss/api) into `yc`.
// Refreshed at most once a day.

import { type DB, getState, setState, tx } from "../lib/db.ts";
import { domainKey } from "../lib/names.ts";
import { fetchRetry, now } from "../lib/util.ts";

interface YcCompany {
  slug: string;
  name: string;
  former_names?: string[];
  website?: string;
  one_liner?: string;
  batch?: string;
  status?: string;
  team_size?: number;
  launched_at?: number;
}

export async function loadYc(db: DB, opts: { force?: boolean } = {}): Promise<number> {
  const last = Number(getState(db, "yc_loaded_at") ?? 0);
  if (!opts.force && now() - last < 86400) return 0;
  const res = await fetchRetry("https://yc-oss.github.io/api/companies/all.json");
  if (!res.ok) throw new Error(`YC directory ${res.status}`);
  const all = (await res.json()) as YcCompany[];
  const upsert = db.prepare(`INSERT INTO yc (slug, name, domain, website, one_liner, batch, status, team_size, launched_at, former_names)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, domain=excluded.domain, website=excluded.website, one_liner=excluded.one_liner,
      batch=excluded.batch, status=excluded.status, team_size=excluded.team_size, launched_at=excluded.launched_at, former_names=excluded.former_names`);
  tx(db, () => {
    for (const c of all) {
      upsert.run(c.slug, c.name, domainKey(c.website), c.website ?? null, c.one_liner ?? null, c.batch ?? null, c.status ?? null,
        c.team_size ?? null, c.launched_at ?? null, JSON.stringify(c.former_names ?? []));
    }
  });
  setState(db, "yc_loaded_at", String(now()));
  return all.length;
}
