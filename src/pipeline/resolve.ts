// Step 4: turn raw mentions into companies. Each mention's normalized name
// and domain are looked up in `aliases`; a miss checks the YC directory, then
// creates a new company. Both keys are then recorded as aliases, so later
// spellings ("Fly" after "Fly.io") join the same company.

import { type DB, tx } from "../lib/db.ts";
import { domainKey, isGenericHost, nameKey, slugify } from "../lib/names.ts";
import { now } from "../lib/util.ts";

interface Mention {
  id: number;
  name: string;
  domain: string | null;
}

interface Yc {
  slug: string;
  name: string;
  domain: string | null;
  website: string | null;
  one_liner: string | null;
  former_names: string;
}

export function resolve(db: DB): { resolved: number; newCompanies: number } {
  const todo = db.prepare("SELECT id, name, domain FROM mentions WHERE company_id IS NULL ORDER BY id").all() as unknown as Mention[];
  if (todo.length === 0) return { resolved: 0, newCompanies: 0 };

  // YC lookups by domain, and by current name only. Former names and loose
  // name matches caused false merges in M1 ("Hermes" became Relationship
  // Hero), so a mention with a domain matches YC only on that domain, and
  // judge.ts has Jev confirm every YC match before its data is trusted.
  const ycByName = new Map<string, Yc>();
  const ycByDomain = new Map<string, Yc>();
  for (const y of db.prepare("SELECT slug, name, domain, website, one_liner, former_names FROM yc").all() as unknown as Yc[]) {
    const k = nameKey(y.name);
    if (k.length >= 4 && !ycByName.has(k)) ycByName.set(k, y);
    if (y.domain && !isGenericHost(y.domain) && !ycByDomain.has(y.domain)) ycByDomain.set(y.domain, y);
  }

  const findAlias = db.prepare("SELECT company_id FROM aliases WHERE key = ?");
  const addAlias = db.prepare("INSERT OR IGNORE INTO aliases (key, company_id) VALUES (?, ?)");
  const slugTaken = db.prepare("SELECT 1 FROM companies WHERE slug = ?");
  const create = db.prepare("INSERT INTO companies (name, slug, domain, yc_slug, description, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const fillDomain = db.prepare("UPDATE companies SET domain = ? WHERE id = ? AND domain IS NULL");
  const assign = db.prepare("UPDATE mentions SET company_id = ? WHERE id = ?");

  let newCompanies = 0;
  tx(db, () => {
    for (const m of todo) {
      const nk = nameKey(m.name);
      const dk = m.domain && !isGenericHost(m.domain) ? domainKey(m.domain) : null;
      const keys = [dk && `domain:${dk}`, nk.length >= 2 && `name:${nk}`].filter(Boolean) as string[];
      if (keys.length === 0) continue;

      let companyId: number | undefined;
      for (const k of keys) {
        const hit = findAlias.get(k) as { company_id: number } | undefined;
        if (hit) {
          companyId = hit.company_id;
          break;
        }
      }
      if (companyId === undefined) {
        const yc = dk ? ycByDomain.get(dk) : ycByName.get(nk);
        const name = yc?.name ?? m.name;
        let slug = slugify(name);
        for (let n = 2; slugTaken.get(slug); n++) slug = `${slugify(name)}-${n}`;
        const res = create.run(name, slug, yc?.domain ?? dk, yc?.slug ?? null, yc?.one_liner ?? null, now());
        companyId = Number(res.lastInsertRowid);
        newCompanies++;
        if (yc) {
          addAlias.run(`name:${nameKey(yc.name)}`, companyId);
          if (yc.domain) addAlias.run(`domain:${yc.domain}`, companyId);
        }
      } else if (dk) {
        fillDomain.run(dk, companyId);
      }
      for (const k of keys) addAlias.run(k, companyId);
      assign.run(companyId, m.id);
    }
  });
  return { resolved: todo.length, newCompanies };
}
