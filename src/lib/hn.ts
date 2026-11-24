// Reading Hacker News through the Algolia search API. Algolia returns at
// most 1,000 hits per query, so we page by time: each request asks for items
// older than the oldest one seen so far.

import { fetchRetry } from "./util.ts";

const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";

export interface AlgoliaHit {
  objectID: string;
  author: string;
  created_at_i: number;
  story_id?: number;
  story_title?: string | null;
  comment_text?: string | null;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  _tags: string[];
}

// Yields pages of hits for `tags`, newest first, between `since` and `until`
// (unix seconds, `until` inclusive).
export async function* pagesByDate(tags: string, since: number, until: number): AsyncGenerator<AlgoliaHit[]> {
  let upper = until;
  for (;;) {
    const params = new URLSearchParams({
      tags,
      hitsPerPage: "1000",
      numericFilters: `created_at_i>${since},created_at_i<=${upper}`,
    });
    const res = await fetchRetry(`${ALGOLIA}?${params}`);
    if (!res.ok) throw new Error(`Algolia ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { hits: AlgoliaHit[] };
    const hits = body.hits;
    if (hits.length === 0) return;
    yield hits;
    if (hits.length < 1000) return;
    const oldest = Math.min(...hits.map((h) => h.created_at_i));
    // If a whole page shares one second, step past it rather than loop.
    upper = oldest < upper ? oldest : oldest - 1;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

// HN's comment HTML to plain text. Links become "text (href)" when the text
// isn't already the href, and every href is returned separately as well.
export function htmlToText(html: string | null | undefined): { text: string; links: string[] } {
  if (!html) return { text: "", links: [] };
  const links: string[] = [];
  let s = html.replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_m, href: string, inner: string) => {
    const url = decodeEntities(href);
    links.push(url);
    const label = decodeEntities(inner.replace(/<[^>]+>/g, ""));
    return label && !url.startsWith(label.replace(/\.\.\.$/, "")) ? `${label} (${url})` : url;
  });
  s = s.replace(/<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  return { text: decodeEntities(s).trim(), links };
}
