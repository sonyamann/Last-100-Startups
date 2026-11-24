# Last 100 Startups — Spec

> **The Last 100 Startups**
> *Companies worth mentioning.*

A semi-sardonic, live leaderboard of the 100 startups most recently mentioned in Hacker News **comments**, shown as a clump of iridescent soap-bubble pills you can poke, merge into satirical mashup startups, or feed to Big Tech. "Last" means *most recent*, and it also nods to the AI "SaaSpocalypse."

It's a portfolio piece for Sonya's content engineering, and it routes attention to the newsletter and to hire-me inquiries.

- **URL:** `studio.sonyasupposedly.com/startups`
- **Host:** Sonya's DigitalOcean droplet (nginx and Caddy believed present; Docker probably not)
- **Status:** planning complete, build not started

---

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Source | HN **comments**, plus **Show HN** and **Launch HN** posts |
| Which startups are on the board | The 100 distinct startups mentioned **most recently** |
| Bubble size | Mention frequency over the **trailing 30 days** |
| Startup cutoff | Established companies are excluded (see §3) |
| Merge LLM | **Moonshot Kimi** (key in `.env` as `MOONSHOT_API_KEY`) |
| Startup-or-not judgments | **TypeSafe Jev** (typed judgments with probabilities) |
| Newsletter | Ghost **magic-link signup** with Ghost's own confirmation email (double opt-in), customized only as far as Ghost allows. No extra email provider |
| Hire-me CTA | Placed next to the newsletter CTA; `mailto:hello@sonya.email` |
| Analytics | **GA4 directly via `gtag.js`, measurement ID `G-TLGPPRF6DF`** (stream "Supposedly Studio"): page views plus a few custom events. No Tag Manager, no consent banner |
| Mobile | **Must be equally usable on mobile**: not a scaled-down desktop page |
| LLM budget | **$500 max** for the launch surge; traffic expected to be spiky |
| Language | TypeScript end to end |

---

## 2. Data pipeline

### 2.1 Ingest
- **Algolia HN Search API:** `search_by_date?tags=comment`, paged backward by `created_at_i`. Used for the backfill and for regular polling.
- **Official Firebase API** (`/v0/maxitem`, `/v0/item/{id}`) is a fallback if Algolia lags.
- **Backfill:** 7 days (M1, run 2026-11-04): 73k items → 12,363 mentions → 3,637 companies → **741 startups**. A 14-day backfill would likely pass 1,000.
- **Show HN / Launch HN:** Algolia tags `show_hn` and `launch_hn`. The product being launched counts as **one mention**, the same weight as a comment.
- **Polling:** a systemd timer every 15–30 min. HN produces about 10.5k comments a day, so the board turns over every few hours.

### 2.2 Extraction (as built in M1: `src/pipeline/`)
1. **`prefilter.ts`**: skips only comments under 40 characters with no link, and the monthly job-ad threads ("Who is hiring", "Who wants to be hired", "Freelancer"), which are ads rather than commenters mentioning companies. About 92% of comments go on to Kimi.
   - *Why not a keyword prefilter:* the original link/phrase/YC-name prefilter passed 13% of comments, but a 400-comment probe of the rejected ones showed it missed roughly a quarter of startup mentions (Bruno, Paseo, Pierre…). Reading everything costs about $2/day, so recall wins.
2. **`extract.ts`**: Kimi `kimi-k3`, thinking **disabled** (thinking made calls about 10× slower and costlier for no gain), 20 items per call, up to 32 calls in parallel. It returns `{name, domain, context, evidence}` per company per item.
   - Instructions: list the brand name, not plan tiers or model versions; never list a company only because the thread title names it; skip giants, open-source projects without a company, people, publications and so on.
   - Kimi's content filter rejects some HN text; a rejected batch is split in halves until the one offending item is skipped.
3. **`resolve.ts`**: merges spellings and domains into companies through an `aliases` table (`name:<key>`, `domain:<registrable domain>`).
   - YC matching uses the domain when Kimi supplied one; otherwise the YC company's *current* name only.
   - Former names caused false merges in the first run ("Hermes" became Relationship Hero, "Moonshot" became Wondercraft).
4. **`judge.ts`**: Jev (`jev-latest`), one request per company.
   - First, for YC-matched companies: "do these mentions refer to this YC company?" A no drops the YC link.
   - Then two nouls: `is_company` (vs. open-source project, person, standard…) and `startup` (under the §3 policy, given name, domain, YC facts, and up to 3 quotes).
   - Code applies the hard facts: denylist, and YC status Acquired/Public/Inactive.
   - Shown if `is_company ≥ 0.5` and `startup ≥ 0.5` (`src/config.ts`).
- **Kimi rate limit:** 200 requests/minute, organization-wide, so live merges will share it. `src/lib/kimi.ts` spaces requests to 180/min (`KIMI_RPM` overrides).
- **Counting:** a **mention = one commenter per thread** (`MENTION_KEY` in `report.ts`), so a founder answering questions in their own Launch HN thread counts once. In M1 this cut Momentic from 60 raw comments to 32 mentions.
5. **`dedupe.ts`** (M2): merges one company listed under two domains.
   - Candidates are companies sharing a domain name across TLDs (moonshot.cn / moonshot.ai) or an enriched website. Jev decides "same company?" at ≥ 0.7, and each pair is asked once (`pair_checks`).
   - Runs before and after enrichment.
   - A name-prefix rule was tried and dropped: it merged "Surface Book" into "Surface Labs" and "Time" into "Time Warner".
6. **`enrich.ts`** (M2): see §4. Runs on the board plus standby (120 companies) and repeats as excluded companies drop out (up to 4 rounds).
7. **`board.ts`** (M2): writes `data/board.json` (see §2.5).
8. **`report.ts`**: writes `reports/pipeline-report.md` with the funnel, cost, board, frequency, borderline list, and a precision sample.

Run with `npm run pipeline -- --days N` (see `src/pipeline/run.ts` for options).

### 2.3 Known gaps (for M2)
- ~~Same company under two names or domains~~: fixed in M2 by `dedupe.ts`.
  - When it merges a company with its own product, Jev picks which name is the company's, and the merged company is shown under that name.
  - Kimi and Moonshot are now one bubble, "Moonshot AI" (moonshot.ai), carrying Kimi's mentions; per Sonya, Kimi is the product and Moonshot the company.
  - Kimi-the-model mentions size the Moonshot AI bubble. Discussed 2026-11-05 and kept.
  - **This mapping isn't comprehensive.** Extraction records a product under the name people use ("Cursor", not "Anysphere"). It joins its maker only via dedupe: shared domain name or website, Jev confirming.
    - A maker whose product lives on a different domain stays a separate bubble.
    - Making it comprehensive would mean extracting the maker too and re-reading every comment (about $23). Worth it only if split product/company bubbles show up on the board.
  - Enrichment prefers a company's English or international website.
- **Model names as companies:** Kimi sometimes listed an AI model ("Astra") as a company. The prompt now maps models to their makers, Jev's `is_company` treats a bare model name as "no", and Astra is denylisted.
- ~~Stale knowledge~~: fixed in M2. Enrichment's web search found OpenRouter (Stripe), Insomnia (Kong), OpenClaw (OpenAI), pi.dev (Earendil) and others acquired, and dropped them; 36 of the first 120 enriched dropped out. Original note: Jev's knowledge can be out of date, e.g. it scores Superhuman (acquired by Grammarly) as a startup. M2 enrichment (funding, acquired/public status) will feed exclusion.
- **Editorial calls (decided 2026-11-04):** Kalshi, Polymarket and DeepSeek count as startups. Cursor does not (owned by SpaceX) and is on the denylist. Future calls come from the "Borderline" table in the report.

### 2.4 Storage (SQLite via built-in `node:sqlite`, `data/startups.db`)
- `items` (HN comments and posts), `mentions` (one per company per item), `companies`, `aliases`, `yc`, `usage` (every paid call's tokens), `state`.
- Later: `merges` (`pair_key, payload JSON, model, created_at, hits`) and `acquisitions` (`company_id, acquirer, at`).

### 2.4a Cost (measured in M1)
- **Kimi extraction:** about 1.2M input + 85k output tokens per day of HN ≈ **$2.10/day** (from the balance change). All of M1, including the 7-day backfill and test runs, cost $22.73; ongoing ≈ $60/month. **Decided:** move ongoing extraction to the Batch API (60% price) later, accepting less frequent updates; full-speed extraction stays for launch.
- **Jev:** about 650 input tokens per company judged; output tokens are free. New companies only, so this falls as the table fills.

### 2.5 Derived outputs
- **`data/board.json`** (type `Board` in `src/pipeline/board.ts`), rewritten atomically each run: `{generated_at, window_days: 30, bubbles: Bubble[100], standby: Bubble[20]}`. Each `Bubble` has:
  - `slug`, `name`;
  - `size`: 30-day mentions, one per commenter per thread;
  - `last_mentioned_at`;
  - `lean`: `loved` / `roasted` / `mixed` / null, from recommended vs. criticized counts, needing at least 3;
  - `website`, `one_liner`, `founded_year`, `hq`;
  - `funding`: `{total_usd, last_round, last_round_usd, last_round_date, investors[]}`;
  - `status`, `yc_batch`;
  - `latest`: `{quote, author, url, at, thread}`;
  - `sources[]`.
- **Sizes are very skewed** (M2: max 177, median 2, 48 of 100 at 1), so the frontend should scale bubble area by something like √size, with a minimum.
- `reports/pipeline-report.md`: the frequency report and diagnostics.

---

## 3. What counts as a "startup"

The written policy below is applied by Jev, with a hard denylist on top.

- **Excluded:**
  - public companies
  - acquired companies
  - "too established" companies: household names or companies at mass scale, whatever their funding stage
  - companies founded more than ~12 years ago (a soft signal)
- **Included:** young, independent companies, including some well-funded ones as long as they aren't household names.
- **Also excluded (Sonya, 2026-11-04):** small single-purpose tools and websites rather than companies, such as calculators, directories, rankings and one-page utilities (e.g. GTMshortlist, LocalAICost). Added to the policy text in `src/config.ts`.
  - Re-judging with it took the startup count from 705 to 456. Besides tools, it also dropped open-source projects with no company behind them (Paseo, Orca, T3 Code) and older established companies (GitBook, Bitwarden, Tutanota).
- **Denylist (not startups anymore):** GitHub, Stripe, OpenAI, Anthropic, Airbnb, Cursor (owned by SpaceX), and similar. We'll keep adding to this list as edge cases show up.
- **Allowlist (always startups, Sonya's calls):** Kalshi, Polymarket, DeepSeek (`ALLOWLIST` in `src/config.ts`).
  - The allowlist overrides Jev's judgment, but not hard facts: an allowlisted company found acquired or public is still excluded.
  - It was needed because the stricter policy pushed Kalshi to 0.45.

---

## 4. Enrichment (the details card)

Built in M2 (`src/pipeline/enrich.ts`). Each company is fetched once and refreshed every 30 days. Only the board plus standby is enriched, plus newcomers as they enter, never all ~700 startups.

1. **Two Kimi web searches** through `POST /v1/tools/search`: `"<name> <domain> funding"` and `"<name> <domain> acquired"`.
   - Kimi's model-side web search (`$web_search` / the Responses API `web_search` tool) did not actually search for us; the direct endpoint always does.
2. **Kimi (`kimi-k3`, no thinking) fills a profile from those results only**, with null for anything they don't say: `matched` (false if the results are about something else with the same name), website, one-liner, founded year, HQ, total funding, last round (and amount and date), valuation, investors, status (independent / acquired / public / shut_down), acquirer, open_source, and sources.
3. **Jev re-judges the company** with those facts. A status of acquired, public or shut_down is a hard exclusion in code (`IS_STARTUP` in `src/lib/startups.ts`).
4. **YC directory** fills gaps: batch and website.

Coverage on the first 120 cards (M2):

| Field | Cards with it |
|---|---:|
| Description | 102 |
| Funding | 74 |
| Website | 120 |
| Founding year / HQ | ~33 |

Founding year and HQ are low because the searches target funding. The card should simply omit missing fields. Funding is shown as "≈ $X raised (per public reports)", never as authoritative.

**Search cost is unconfirmed.** Kimi's balance updates hours late. The one drop we could see suggests up to about 3¢ per search, so about 6¢ per enriched company, or roughly $2–4/day as new startups enter the board. **To check against Kimi's billing console.** If it's that expensive, drop to one combined search per company.
3. **HN-native details (the signature part):**
   - "Mentioned **N×** in the last 30 days"
   - the latest comment's snippet, linked to the comment on HN
   - optionally, a sentiment lean ("mostly recommended" / "mostly complained about")

---

## 5. Merges ("Kinotype")

Built in M4. Drag a bubble onto another (or use "Merge with…" in a card) and they fuse into a satirical fantasy startup. Examples from testing:
- Kino AI + Tinfoil → **Kinfoil**: "Your footage never leaves the enclave. Allegedly."
- Kalshi + Momentic → **Momentshi**: "Put your money where your merge conflict is."

**Front end (`web/src/main.ts`, `card.ts`):**
- While dragging, the bubble becomes a physics sensor that passes over the others, and the one under the pointer glows as the target.
- On drop, both bubbles are replaced by a bigger "Merging…" bubble that breathes. The card shows deal-making copy ("Doing light due diligence…") for the ~5 seconds Kimi takes.
- The finished card shows:
  - the merged startups;
  - name and tagline;
  - two-sentence pitch;
  - the fake raise;
  - a fictional investor quote;
  - a traction metric;
  - a fake top HN comment, in HN's colours;
  - Permalink and Copy link;
  - "Merge with…" (merged bubbles can merge again, up to 6 startups);
  - a satire disclaimer.
- On failure, the two bubbles pop back out and the card explains: "Blocked by regulators", "Too many deals" or "Deal fell through".

**Writing (`src/lib/mashup.ts`):**
- Kimi `kimi-k3.1-pro-highspeed`, thinking off, JSON. About 5–6s, ~750 input and ~255 output tokens per mashup.
  - Chosen over `kimi-k3`: wittier in side-by-side tests, and faster (k3 took 6–13s).
- The prompt is built around Sonya's Kinotype example: the funniest true intersection of what the companies actually do, pushed one step too far.
- Rules in the prompt:
  - a portmanteau name;
  - invented people, investors and funds only: no real people, no real VC names;
  - no real allegations;
  - in a merger of a merger, the earlier mashup becomes the "legacy business" and the absurdity escalates.
- Each request gets random investor initials, because the model kept reusing "Mara Venn".

**Server (`src/web/merges.ts`):** `POST /startups/api/merge` with `{"parts": [["slug-a"], ["slug-b"]]}`; each part is the base slugs inside one bubble.
- **Key:** the sorted unique base slugs joined by `+`. Each combination is written once and cached forever in the `mashups` table, with a hit count.
- **Shared work:** concurrent identical requests share one Kimi call.
- **Validation:** slugs must exist on the board or in the DB; no duplicates; at most 6 startups.
- **Limits:**
  - 20 new mashups per IP per hour (cached ones are free and unlimited);
  - a global cap of 20,000 new per day (raised from 4,000 before the Show HN; at under a cent each, at most about $200), after which it reports "under regulatory review";
  - when Kimi's queue is over 30 seconds long (`MASHUP_MAX_QUEUE_SECONDS`), new ones get "Market overheated: too many deals on the table" at once instead of waiting, and it doesn't count against the visitor's hourly allowance;
  - all set by env (`MASHUPS_PER_HOUR`, `MASHUP_DAILY_CAP`, `MASHUP_MAX_QUEUE_SECONDS`).
  - Throughput: the server starts one Kimi call a second (`KIMI_RPM=60`) and each takes about 6s, so up to ~60 new mergers a minute flow through; cached ones are free and instant.

**Permalinks (`src/web/permalink.ts`):** `GET /startups/m/<key>`.
- A server-rendered page in the site's style, with Open Graph title and description so link previews show the fake startup, and a "Merge your own →" button.
- Link-preview image (`/startups/m/<key>.png`, `src/web/ogimage.ts`): "A + B =" over the name in big Handjet, sized to fit on one line, with the tagline, on a pre-rendered bubble background (`assets/og/background.png`). Drawn as SVG, turned into PNG by `rsvg-convert`, made once per mashup and kept in `data/og/`.

**Not done:** streaming the text into the card. The deal-copy animation covers the ~5s wait, and non-streaming JSON is simpler and more robust.

## 6. Acquirers (the hungry mouths)

Built in M5 (`web/src/acquirers.ts`, `src/web/acquisitions.ts`).

- **Who:** Google, Meta, Microsoft, Salesforce, Anthropic, OpenAI. Representative, not comprehensive (Sonya's set, 2026-11-05; it replaced Apple, Amazon and Adobe).
- **Look:** each is an abstract round cartoon creature in a colour hinting at the company, with the name underneath (no logos).
  - Eyes blink; the mouth chews idly.
  - As a dragged bubble approaches, the jaws open wider with distance (teeth appear) and the eyes follow it.
  - All SVG and CSS. The jaw opening is a registered `@property --open`, so the chomp keyframes can animate it.
  - The jaw is an oval cavity (sitting low enough to clear the eyes) with a tongue. Each tooth is placed on the cavity's rim: upper teeth hang from the top arc, lower ones rise from the bottom arc, shorter toward the corners. Everything is clipped to the cavity, and the whole jaw stretches vertically to open, so the teeth stay on the rim at every opening (2026-11-05; before, two straight rows slid past the curved lips).
- **Feeding:**
  - Drag a bubble into a mouth (mouths win over bubbles as drop targets), or use "Sell to…" in any card.
  - The mouth gapes wide; the bubble flies in (no fading) and shrinks to fit the open cavity; the jaws snap shut on it, squashing it flat as it vanishes; then a chomp and a burp.
  - The outcome appears as a callout in the acquirer's colour (tinted, glowing, a "SOLD TO ANTHROPIC" pill, the line in large serif type) for about 7 seconds. One of three lines per acquirer, with `{name}` filled in. Examples:
    - "Joining the Google family. See you in the Graveyard in 18 months."
    - "Acquired by Anthropic. {name} is now a Claude skill, available in research preview."
    - "Acquired by OpenAI. {name} is now a ChatGPT feature for Pro users ($200/mo)."
  - Eating a mashup prefixes "Antitrust review pending."
- **Refill:** the next standby startup (#101, #102 …) blows in where the eaten one lived, nudging its neighbours aside. (Rising from the bottom was tried; a newcomer bigger than the gap got stuck underneath.)
- **Reachability:**
  - While dragging, the mouth row sticks to the bottom of the screen (`position: sticky`), and the page scrolls when the pointer nears the top or bottom edge, except over the mouths.
  - After a meal the row stays put for 3.5s so the chomp and toast are seen.
  - On narrow screens, every other label drops a line so "Microsoft" and "Salesforce" don't collide.
- **Counters:**
  - `POST /startups/api/acquire {target, acquirer}` records a meal (120 per IP per hour; extras are ignored).
  - `GET /startups/api/acquisitions` returns per-acquirer and total counts across all visitors, for Sonya. **The page shows each visitor their own tally since the page loaded** ("N eaten" under each mouth, "You have sold N startups to Big Tech so far."). Every visit starts with a fresh board, so a shared count read as confusing.
- **Recently devoured (Sonya's idea, 2026-11-04):** under the mouths, the real companies HN mentioned this month that review disqualified for already being acquired, e.g. Bun → Anthropic (Dec 2025), OpenRouter → Stripe (Aug 2026), Firebase → Google (Oct 2014).
  - **Who qualifies:** acquired per the web search or the YC directory, `is_company_p ≥ 0.3`, mentioned in the 30-day window, with a known buyer. 22 at launch.
  - **Order and duplicates:** sorted by acquisition date, newest first. Near-duplicate names with the same buyer are folded together (Pierre / Pierre Computer, Taalas / "Talaas").
  - **Enrichment:** now also records `acquired_date`. Acquired companies missing a buyer or date get their own enrichment pass, once, then on the 30-day refresh; a search that finds no date isn't retried every run.
  - **Look:** deflated, crumpled "husks" with the name struck through, then "→ **Buyer**" in bold amber (larger, per Sonya), then the date. Tapping one opens a card with a red "DEVOURED" badge, the buyer and date, the one-liner, "Still mentioned N times on HN", and the latest quote.
  - `board.json` gains `devoured: Devoured[]` (`src/pipeline/board.ts`).
- **Tested** at 327px and 1280×800 in the browser pane: drag-to-mouth, "Sell to…", refill, counters, devoured cards.
  - Not yet tested on a real touch device.
  - The site has no favicon yet: the browser's `/favicon.ico` request 404s.

## 7. Newsletter and hire-me

Between the CTA boxes and the byline, a divider: Sonya's rabbit sigil, traced from her linocut (blurred, thresholded, boundary-traced, simplified and spline-smoothed) and Dribbble-ified as a 2010s startup app icon. That means a rounded-square tile, the rabbit as a white glyph with a long muted teal-grey shadow, a top gloss, and two twinkling pale-gold sparkles. It's tilted slightly, hops on hover, and sits between a mint hairline (left) and a rose one (right). **Colours** (settled 2026-11-05 from Sonya's iridescent-shell reference, after purple-pink, blue-violet-pink and green versions): pastels pulled down to mid-tones so the white rabbit stays distinct. Pale blue → seafoam mint → rose → lilac, with butter-yellow radial glows (top-right, bottom-left) and a pale-yellow diagonal light beam. Yellow sits in the glows rather than the main gradient, because yellow blending into pink reads as peach. A standalone copy is at `web/public/rabbit-sigil.svg`.

Built in M6. Both sit in a footer under "Recently devoured": hire-me first, then the newsletter (Sonya, 2026-11-05). They're side by side on desktop and stacked on phones, both with the bubbles' iridescent rim, followed by a credits line.

- **Newsletter box:**
  - Copy (Sonya's): "Bubble enthusiast? Great, sign up for my [newsletter](https://www.sonyasupposedly.com/). Emails are very occasional."
  - Form: a single pill: the email field with Subscribe inside its right end (the pill's border turns blue on focus); a hidden honeypot field; and the note "Ghost sends a confirmation email first. Unsubscribe anytime." right under the field, lined up with its text, with status messages below that
- **Server:** `POST /startups/api/subscribe` (`src/web/subscribe.ts`) uses Ghost's public members signup, the same magic-link flow as Ghost's Portal: double opt-in, Ghost's own confirmation email, label "Last 100 Startups".
  - Ghost 6 needs a fresh integrity token per signup, fetched from `GET {site}/members/api/integrity-token/`.
  - It must go through the public site (`GHOST_SITE_URL`, default `https://www.sonyasupposedly.com`); the `ghost.io` address rejects the API version.
  - 5 tries per IP per hour. Outcomes other than "invalid" read as done to the visitor, so the form never reveals who's already subscribed.
- **Hire-me box** (pink accent):
  - Copy (Sonya's): "Do you need attention? Don't we all, my friend, don't we all. Thus it is written in the scriptures that *attention is all you need*." then, on its own line, "Luckily I can help out 🫶". Deliberately unlinked: an oblique reference for those who know.
  - No button: the box ends with the pitch in the heading typeface, "Luckily I can help out 🫶 → hello@sonya.email", on one line where it fits (it wraps before the arrow on phones). Only the address is the link, in pink: `mailto:hello@sonya.email?subject=Saw Last 100 Startups`. Treatment "D" from the 2026-11-05 mockups, with the address as the link.
- **Byline**, on its own line in the heading typeface: "A [Supposedly Studio](https://studio.sonyasupposedly.com/) project by [Sonya Mann](https://x.com/sonyasupposedly)." Then the small print: "Mentions come from Hacker News comments and Show/Launch HN posts; startup details from public web reports. Mergers, investors, and acquisitions-by-mouth are satire."
- **Tested:** validation, honeypot, dev proxy, form errors. **Not yet tested with a real address**, which would send a real confirmation email. Sonya to try one and check the label in Ghost.

## 7a. Analytics

- **GA4** via `gtag.js`, measurement ID **`G-TLGPPRF6DF`**. Loaded only when the hostname is `sonyasupposedly.com` or a subdomain, so development traffic never reaches GA. It's on the board page and on mashup permalink pages.
- **Custom events** (`web/src/analytics.ts`):
  - `bubble_open` (id, kind); hover peeks are not counted;
  - `merge` (key, startups, cached) and `merge_failed` (state);
  - `acquire` (acquirer, target, kind);
  - `devoured_open`;
  - `copy_link`;
  - `newsletter_signup` (state);
  - `hire_me_click`;
  - `merge_permalink_view` (key), on permalink pages.
- To verify in GA4 DebugView after deploy.
- **No consent banner.** Decided.
- **Favicon:** a soap bubble, `web/public/favicon.svg`.

## 8. Frontend

Built in M3 (`web/`). `npm run dev` serves it at `http://localhost:5173/startups/`, with `board.json` read straight from `data/`. `npm run build:web` builds to `dist/web` (about 33 KB of JavaScript, gzipped).

- **Stack:** Vite 6 + vanilla TypeScript, Matter.js 0.20, plain CSS. Fonts, all from Google Fonts:
  - **Handjet** (dot-matrix): the masthead title, the "Exit opportunities" and "Recently devoured" section titles, and company names on cards (startups, mergers, the devoured), including mashup permalink pages. Chosen 2026-11-05 over Gulax and Kulturë.
  - **Instrument Serif**: subtitle, taglines, quotes, deal lines, footer headings, pitch and byline. The explainer and error card titles stay serif.
  - **Inter**: UI and body text.
  - Verdana only for the fake HN comment.
  - The masthead subtitle was enlarged (23–30px) because italic Instrument Serif was hard to read small.
- **Rendering:** DOM `<button>` pills positioned from Matter.js bodies each frame. This keeps text crisp, tappable and accessible.
- **Bubble shape:** full-ended, slightly irregular blobs, matching Sonya's sketch (`bubbleshapes.png`): between the original capsule pills and true ellipses, which looked pointy.
  - Each bubble gets its own random corner rounding (36–49% per corner, as 8-value `border-radius`).
  - Size: the text box ×1.18 wide and ×1.28 tall, never taller than wide and never more than 1.8× wider than tall.
  - Multi-word names over 9 characters wrap onto two lines.
- **Physics (`web/src/physics.ts`):** blob bodies (32-sided superellipses, n = 2.6, approximating the CSS shape) that never rotate, with a 4px gap between them. Two phases:
  1. **Settle**, before first paint:
     - Pills are seeded packed in rows, with the biggest in the middle rows: across ~86% of the width on desktop, full width on phones.
     - Seeds are jittered within rows, and the clump is pulled together while being shaken hard (messier, per Sonya): toward a centre line on desktop (a wide rounded band), toward the centre point on phones (the walls hold the width).
     - Then they relax with no pull, so pressed pills separate.
  2. **Live:** each pill springs gently toward its settled "home" and gets random nudges (the jostle).
     - A dragged pill shoves its neighbours and drifts home when released.
     - Pressure stays local, so pills don't overlap: at most a few px at rounded corners in automated checks.
  - *Approaches tried first:* a single global pull toward the centre point or line. It either overlapped pills on phones or left single-file "towers" at the clump's ends.
- **Sizing:**
  - Font size ∝ √(mentions): 13–33px on desktop, 11–23px on phones.
  - Container height comes from the total pill area: density 0.6 on desktop, 0.8 on phones. The phone clump runs about 960px, below the fold.
- **Soap-film look (`web/src/styles.css`):**
  - near-black page;
  - each pill is nearly clear, with a crisp white highlight up top-left;
  - a slowly rotating rainbow swirl (`.pill__film`), radially masked so colour shows only toward the rim. It deliberately has no `mix-blend-mode`: `screen` on this masked, rotating layer made Chrome draw hairlines along each bubble's box;
  - a thin conic-gradient iridescent rim;
  - each pill gets a random hue offset and speed, so they don't shimmer in unison;
  - only `rotate` animates, so the effect stays on the compositor.
- **Header:** "The Last 100 Startups" / *Companies worth mentioning.* / a larger, higher-contrast description ("The 100 startups most recently mentioned in Hacker News comments, sized by mentions over the last 30 days. *Updated …*" with the update time italicised) / how-to-play as three bullet points with pink markers; the first is "Tap or hover over a bubble for details." everywhere.
- **"What counts as a startup?"** A pill button under the description opens a short explainer (`aboutHtml` in `web/src/card.ts`): where mentions come from (Kimi reading HN), what a mention is (one per commenter per thread; products are counted under their own names and merged with their maker only when both turn up and clearly match, as Kimi did with Moonshot AI), what a startup is, who decides (Jev, web searches, editorial calls), and how the board is sized. It's a centred pop-up over a dimmed page on wide screens and a bottom sheet on phones, both with × to close. GA event `about_open`.
- **Container height:** after settling, the clump container is trimmed to the clump (`Clump.fitHeight`), since the area-based estimate left a big empty band.
- **Merged bubbles** have their own palette: neon green with warm orange-gold film and rim, and a green glow, so visitors can tell their fake startups from the real ones.
- **Interactions (`web/src/main.ts`, `card.ts`):**
  - **Mouse:** hover peeks at the card (popover beside the bubble), click pins it, press-and-move drags.
  - **Touch:** tap opens a bottom sheet over a scrim; long-press (350ms) then move drags. Once a drag starts, page scroll is blocked, so ordinary swipes still scroll the page.
  - **Keyboard:** pills are buttons; Enter opens the card, Esc closes it.
  - **Reduced motion:** no jostle or swirl, and the simulation stops once still.
- **Card contents:**
  - name;
  - website link;
  - one-liner;
  - YC batch · founded · HQ, when known;
  - funding box: "≈ $X raised · last round: …", investors, "Per public reports";
  - "N mentions in the last 30 days" with the lean ("HN loves it" / "HN roasts it" / "HN is divided");
  - the latest quote, linked to the comment on HN. Quotation marks inside the quote become single quotes (`nestQuotes` in `web/src/format.ts`).
- **Tested** in the browser pane at 1280×800, 327px and 375×812 (mobile emulation): no console errors, card and bottom sheet work.
  - Not yet tested on real phones. Touch drag in particular needs a real device: scroll vs. long-press, and iOS Safari.
- **Still to come:** merging (M4), acquirer mouths (M5), and the newsletter, hire-me and GA4 sections (M6).

## 9. Backend and deploy

- **Layout on the droplet:** `/srv/startups/{app,env}`, system user `startups`, port **3003**, data in `/srv/startups/app/data`.
- **API (built in M4: `src/web/server.ts`, `npm run serve`):** plain `node:http`, like the studio's other apps (no Hono needed). One process under systemd. In development, Vite proxies `/startups/api` and `/startups/m/` to it. Routes:
  - `GET /startups/board.json`, static, written by cron
  - `POST /startups/api/merge`, streaming
  - `POST /startups/api/subscribe`
  - `GET /startups/m/:key`
- **Jobs:** ingest, extract, judge, enrich, publish, run by a systemd timer every 15–30 min.
- **Web server:** Caddy (already fronts `studio.sonyasupposedly.com`). Add one `@startups path /startups /startups/*` block that proxies to 3003. Hono serves the built frontend and `board.json` as well as the API, so the Caddyfile change stays a single block.
- **Secrets:** server-side `.env` only. Nothing secret reaches the browser.
- **Repo:** GitHub, pushed under Sonya's account (access to be verified).

---

## 10. Environment (`.env`)

| Key | Use |
|---|---|
| `MOONSHOT_API_KEY` | Kimi: merges, and possibly extraction/enrichment. Stray spaces around `=` removed on 2026-11-04 |
| `TYPESAFE_API_KEY` | Jev judgments |
| `GHOST_API_URL`, `GHOST_CONTENT_KEY`, `GHOST_ADMIN_KEY` | Newsletter signup |

All keys were verified on 2026-11-04 (see §10a).

## 10a. M0 findings (2026-11-04)

**APIs**
- **Kimi:** works at `https://api.moonshot.ai/v1` (OpenAI-compatible; the `.cn` endpoint rejects this key).
  - Models: `kimi-k3`, `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`.
  - The Batch API is billed at 60% of the standard price (k3 and k3.1-pro). Context caching is automatic.
  - Per-token prices aren't readable from the docs (the tables are rendered by JavaScript), so actual cost will be measured from `usage` in M1.
  - Plan: `kimi-k3` with Batch for extraction; `kimi-k3.1-pro-highspeed` or `kimi-k3.1-pro` for merges, decided by comedy and latency.
- **TypeSafe Jev:** `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest` (answered as `jev-1.14.0`).
  - Smoke test with the §3 policy, as noul probabilities:

    | Company | Probability it's a startup |
    |---|---|
    | Kino | 0.81 |
    | Fly.io | 0.71 |
    | Linear | 0.65 |
    | Stripe | 0.03 |
    | Anthropic | 0.03 |

    The direction is right; thresholds get tuned in M1. Input tokens are billed; output is free.
- **Ghost:**
  - `GHOST_API_URL` = `https://sonyamann.ghost.io` (the public site is `https://www.sonyasupposedly.com/`).
  - Content key works. Admin key works; one newsletter, "Sonya Supposedly" (active).
  - Magic-link signup goes to the public members endpoint on the site URL. Newer Ghost may require an integrity token first; we'll check in M6.

**GitHub:** SSH auth works as `sonyamann`. `gh` 2.103.3 installed in `~/.local/bin` and signed in. Remote: private repo `git@github.com:sonyamann/last-100-startups.git`. Local repo initialized on `main`.

**Droplet `supposedlystudio`** (its SSH address is `STUDIO_HOST` in `.env`)
- **Machine:** Ubuntu 24.04, **1 vCPU / 1 GB RAM**, 20 GB free.
  - Fine for Hono + SQLite; heavy work (LLMs) is remote.
  - Batch jobs must stay memory-light: stream pages, don't load everything at once.
- **Software:**
  - **Caddy** serves the site; nginx is installed but inactive. No Docker.
  - Node 22.23 / npm 10.9, sqlite3, git. No pnpm.
- **Existing conventions** (we follow them):
  - Each app lives in `/srv/<app>/app`, with secrets in `/srv/<app>/env` (root-owned, readable by the app's group).
  - Each app has its own system user and a hardened systemd unit (`ProtectSystem=strict`, `ReadWritePaths=…/data`).
  - Node runs `.ts` directly (type stripping, no build step for the server).
  - Caddy sends a path to a local port through a `handle @name` block in `/etc/caddy/Caddyfile`.
- **Ports in use:**

  | Port | App |
  |---|---|
  | 3000 | Hallowtide |
  | 3001 | Divination |
  | 3002 | studio newsletter (`/subscribe`) |
  | 2019 | Caddy admin |

  → **Last 100 Startups takes 3003.**
- **Existing studio newsletter service** (`/subscribe`, port 3002):
  - Adds members directly through the Admin API (no double opt-in), labelled "Supposedly Studio", with a honeypot and 5 signups per IP per hour.
  - We **won't reuse it**: this project uses magic-link double opt-in with its own label, "Last 100 Startups". Its `ghost.ts` JWT helper is a good reference.
- **No crontab or app timers exist yet.** Ingest will run on a **systemd timer** (consistent with the unit style) rather than cron.

---

## 11. Milestones

1. **M0: setup and access checks. ✅ Done 2026-11-04.** Git repo, verify keys, SSH, droplet inventory.
2. **M1: data pipeline, no UI. ✅ Done 2026-11-04** (7-day backfill; precision ≈ 38/40 on a sample). Backfill plus extraction on real comments, followed by a **frequency report and precision check** on a hand-reviewed sample. Thresholds get tuned here.
3. **M2: enrichment and `board.json`. ✅ Done 2026-11-04.**
4. **M3: bubble clump prototype. ✅ Done 2026-11-04** (needs a real-phone check). Physics, iridescence, details popover/sheet; desktop and mobile.
5. **M4: merges. ✅ Done 2026-11-04.** Kimi prompt tuning for comedy, caching, permalinks, rate limits.
6. **M5: acquirers. ✅ Done 2026-11-04.** Mouths, animations, toasts, standby refill.
7. **M6: newsletter, hire-me, and analytics. ✅ Done 2026-11-04** (real-address signup still to try). Ghost signup, mailto CTA, GA4 tag and custom events.
8. **M7: deploy. ✅ Live 2026-11-05** at https://studio.sonyasupposedly.com/startups/ (see the private `HOSTING.md`).
   - `startups.service` (Node on 127.0.0.1:3003) and `startups-pipeline.timer` (every 20 min), as the `startups` user.
   - Caddy route added (backup kept as `/etc/caddy/Caddyfile.bak-*`).
   - Database seeded from the local 7-day backfill. Deploys with `sh tools/deploy.sh`.
   - Verified live: page, board, merges, permalinks, favicon, no console errors, GA4 `page_view` and custom events reaching Google Analytics. Hallowtide, Divination and the homepage unaffected.
   - First server pipeline run (catch-up of ~1 day): 11,057 items → 2,615 mentions, 583 new companies, 104 enriched (20 dropped as acquired/public/shut down), 34 devoured, board republished. It took 17 min; regular 20-minute runs are much shorter.
   - Done after launch: link-preview images for permalinks; a real-phone test of touch dragging. Still to do: moving extraction to the Kimi Batch API; a real newsletter signup.

## 12. Open questions

- (Resolved) GitHub remote: private repo `sonyamann/last-100-startups` created 2026-11-04; `gh` 2.103.3 installed in `~/.local/bin`.
- Kimi per-token prices: to be measured from usage in M1.
