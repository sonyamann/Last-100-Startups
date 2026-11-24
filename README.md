# The Last 100 Startups

*Companies worth mentioning.*

A live board of the 100 startups most recently mentioned in Hacker News comments, shown as a clump of soap bubbles. Each bubble is sized by its mentions over the last 30 days, counting each commenter once per thread. Tap a bubble to see what the company does and the latest comment that mentioned it. Drag one bubble onto another to merge them into a satirical startup, or feed one to a Big Tech mouth.

Live at https://studio.sonyasupposedly.com/startups/. [SPEC.md](SPEC.md) has the full design and the reasoning behind it.

## How it works

The pipeline (`src/pipeline/`, run by `run.ts`) goes step by step, keeping everything in one SQLite file:

1. **Ingest** (`ingest.ts`): comments, Show HN and Launch HN posts from the Algolia HN API.
2. **Prefilter** (`prefilter.ts`): skips very short comments and the monthly hiring threads.
3. **Extract** (`extract.ts`): Moonshot's Kimi lists the companies each item names.
4. **Resolve** (`resolve.ts`): merges spellings and domains into companies, and matches them to YC's directory.
5. **Judge** (`judge.ts`): TypeSafe's Jev checks YC matches, then decides whether each name is a real company and whether it counts as a startup under the policy in `src/config.ts`. A denylist, an allowlist and known acquisitions override it.
6. **Enrich** (`enrich.ts`): web searches for funding and acquisitions, turned into facts by Kimi, after which Jev judges each company again.
7. **Dedupe** (`dedupe.ts`): code proposes companies that may be one company under two domains; Jev decides, and picks the company's own name.
8. **Publish** (`board.ts`): writes `data/board.json`, which the page reads.
9. **Report** (`report.ts`): writes `reports/pipeline-report.md`, with the funnel, the costs and the board.

The page (`web/`) is Vite and Matter.js. The server (`src/web/server.ts`) is plain `node:http` with `node:sqlite`; it serves the board, writes merger pitches with Kimi (cached, so a repeat merger returns the same deal) and handles newsletter signups through Ghost.

## Setup

Needs Node 22.18 or later.

```bash
npm install
cp .env.example .env
```

Then fill in `.env`:

- `MOONSHOT_API_KEY` (Kimi) and `TYPESAFE_API_KEY` (Jev): needed for the pipeline and for mergers.
- `GHOST_SITE_URL`: optional, the Ghost site that newsletter signups go to (Ghost's own magic-link signup; no key needed).
- `STUDIO_HOST`: only for deploying (`user@host`).

## Commands

Fill the database with the last day of HN (each run costs money in Kimi and Jev calls; the report shows how much):

```bash
npm run pipeline -- --days 1
```

Other examples: `--limit 2000` caps how many items are extracted in a run, and `--steps judge,report --rejudge` reruns only some steps. With no `--days`, ingest continues from the newest stored item.

Run the page locally at http://localhost:5173/startups/, with the server beside it for mergers:

```bash
npm run serve
```

```bash
npm run dev
```

Type-check, rebuild the report, and build the page for production:

```bash
npm run check
```

```bash
npm run report
```

```bash
npm run build:web
```

Deploy the committed state of `main` to the server and restart it (needs `STUDIO_HOST`; the server's own `data/` is never touched):

```bash
sh tools/deploy.sh
```

On the server, a systemd timer (`deploy/startups-pipeline.timer`) runs the pipeline every 20 minutes.

## License

The code is under the MIT License (see `LICENSE`). The fonts in `assets/og/` keep their own licenses, which sit beside them.
