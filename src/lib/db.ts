// SQLite through Node's built-in node:sqlite, so the pipeline has no native
// dependencies to build on the droplet. One file: data/startups.db.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type DB = DatabaseSync;

const defaultPath = fileURLToPath(new URL("../../data/startups.db", import.meta.url));

const schema = `
-- HN items we have read: comments, Show HN posts, Launch HN posts.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,            -- HN item id
  kind TEXT NOT NULL,                -- comment | show_hn | launch_hn
  author TEXT,
  created_at INTEGER NOT NULL,       -- unix seconds
  story_id INTEGER,
  story_title TEXT,
  title TEXT,                        -- posts only
  url TEXT,                          -- posts only
  text TEXT NOT NULL,                -- plain text, links written inline
  links TEXT NOT NULL DEFAULT '[]',  -- JSON array of hrefs
  prefilter TEXT,                    -- NULL until judged; then pass | skip
  prefilter_reason TEXT,
  extracted_at INTEGER               -- set once Kimi has read it
);
CREATE INDEX IF NOT EXISTS items_created ON items(created_at);
CREATE INDEX IF NOT EXISTS items_todo ON items(prefilter, extracted_at);

-- One row per company Kimi found in one item. company_id is filled in by
-- the resolve step, which merges spellings and domains into companies.
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  name TEXT NOT NULL,
  domain TEXT,
  context TEXT,                      -- recommended | criticized | employer | own_product | neutral
  evidence TEXT,                     -- short quote from the item
  company_id INTEGER REFERENCES companies(id),
  UNIQUE(item_id, name)
);
CREATE INDEX IF NOT EXISTS mentions_company ON mentions(company_id);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT,
  yc_slug TEXT,
  description TEXT,
  is_company_p REAL,                 -- Jev: a real company or commercial product?
  startup_p REAL,                    -- Jev: a startup under the SPEC policy?
  judged_at INTEGER,
  denylisted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Every normalized name and domain that points at a company.
CREATE TABLE IF NOT EXISTS aliases (
  key TEXT PRIMARY KEY,              -- "name:fly" or "domain:fly.io"
  company_id INTEGER NOT NULL REFERENCES companies(id)
);

-- The public YC directory (yc-oss), used for enrichment and matching.
CREATE TABLE IF NOT EXISTS yc (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  website TEXT,
  one_liner TEXT,
  batch TEXT,
  status TEXT,
  team_size INTEGER,
  launched_at INTEGER,
  former_names TEXT
);

-- Every paid API call, so cost can be measured rather than guessed.
CREATE TABLE IF NOT EXISTS usage (
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  purpose TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER
);

CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);

-- Pairs of companies Jev has compared for being the same company, so a
-- pair is only asked about once. a < b.
CREATE TABLE IF NOT EXISTS pair_checks (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  same_p REAL NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
`;

const mashupSchema = `
-- Merged fantasy startups (M4), keyed by sorted base slugs ("a+b"). Written
-- once, served forever.
CREATE TABLE IF NOT EXISTS mashups (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mashups_created ON mashups(created_at);

-- Startups visitors fed to the acquirer mouths (M5), for the counters.
CREATE TABLE IF NOT EXISTS acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,              -- startup slug or mashup key
  acquirer TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS acquisitions_acquirer ON acquisitions(acquirer);
`;

// Columns added after M1; CREATE TABLE IF NOT EXISTS won't add them to an
// existing table, so add any that are missing.
const addedColumns: [table: string, column: string, type: string][] = [
  ["companies", "enrichment", "TEXT"],
  ["companies", "enriched_at", "INTEGER"],
  ["companies", "allowlisted", "INTEGER NOT NULL DEFAULT 0"],
];

function migrate(db: DatabaseSync): void {
  for (const [table, column, type] of addedColumns) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function openDb(path = process.env.DB_PATH ?? defaultPath): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(schema);
  db.exec(mashupSchema);
  migrate(db);
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getState(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setState(db: DB, key: string, value: string): void {
  db.prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function logUsage(db: DB, u: { provider: string; model?: string; purpose: string; input: number; output: number }): void {
  db.prepare("INSERT INTO usage (ts, provider, model, purpose, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Math.floor(Date.now() / 1000), u.provider, u.model ?? null, u.purpose, u.input, u.output);
}
