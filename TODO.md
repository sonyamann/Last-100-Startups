# To do

## Preview images: check them on X

On 2026-11-09 the Facebook Sharing Debugger showed the merger previews, but X showed nothing. X's crawler had fetched `/startups/`, which had no preview tags at all, and had downloaded a merger image successfully. Fixed:
- `/startups/` now has `og:` and `twitter:` tags, with a static image at `web/public/og.png` (the masthead over a snapshot of the clump).
- Merger pages now have explicit `twitter:title` and `twitter:description` tags.
- `%2B` in paths is decoded, so encoded merger links resolve.
- Files are sent with a `Content-Length` header.

Still to check: post a merger link and the `/startups/` link on X and look at the card. X caches cards for about a week, so use a merger link it hasn't seen before.

## Write the Show HN post

## Make sure the site can handle the HN front page 🤞

- ~~Merge spikes~~ Done 2026-11-09: the daily cap is now 20,000, and once Kimi's queue is over 30 seconds long, new mergers get "Market overheated" at once instead of waiting. Throughput is about 60 new mergers a minute; cached ones are instant.
- Load-test `/startups/`, `board.json`, `/api/merge` and the permalinks on the droplet (1 GB RAM, which the pipeline shares).
- Consider Caddy caching or compression for the static files and `board.json`.
- Check what visitors see if the server restarts, and how quickly it comes back.
