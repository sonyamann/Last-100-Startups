// Normalizing company names and domains so "Fly", "Fly.io" and
// https://www.fly.io/docs all land on the same company.

// Second-level suffixes where the registrable domain has three labels.
const TWO_PART_TLDS = new Set(["co.uk", "co.jp", "com.au", "com.br", "co.in", "co.nz", "com.sg", "co.za", "com.mx", "org.uk"]);

// Hosts that say nothing about which company a link is about.
export const GENERIC_HOSTS = new Set([
  "news.ycombinator.com", "ycombinator.com", "github.com", "gist.github.com", "gitlab.com", "wikipedia.org",
  "youtube.com", "youtu.be", "twitter.com", "x.com", "reddit.com", "old.reddit.com", "arxiv.org", "medium.com",
  "substack.com", "google.com", "docs.google.com", "archive.org", "web.archive.org", "archive.ph", "archive.is",
  "nytimes.com", "theverge.com", "bloomberg.com", "reuters.com", "wsj.com", "ft.com", "theguardian.com", "bbc.co.uk",
  "bbc.com", "cnbc.com", "techcrunch.com", "arstechnica.com", "wired.com", "economist.com", "apnews.com",
  "stackoverflow.com", "linkedin.com", "facebook.com", "instagram.com", "tiktok.com", "bsky.app", "mastodon.social",
  "imgur.com", "amazon.com", "apple.com", "microsoft.com", "en.wikipedia.org", "npmjs.com", "pypi.org", "crates.io",
  "doi.org", "ncbi.nlm.nih.gov", "sciencedirect.com", "nature.com", "gov.uk", "europa.eu", "lwn.net", "bit.ly",
  "openai.com", "anthropic.com", "huggingface.co", "paulgraham.com", "spectrum.ieee.org", "washingtonpost.com",
]);

export function hostOf(urlOrDomain: string | null | undefined): string | null {
  if (!urlOrDomain) return null;
  let s = urlOrDomain.trim().toLowerCase();
  if (!/^[a-z]+:\/\//.test(s)) s = "https://" + s;
  try {
    return new URL(s).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// The registrable domain: app.fly.io -> fly.io, foo.co.uk stays foo.co.uk.
export function domainKey(urlOrDomain: string | null | undefined): string | null {
  const host = hostOf(urlOrDomain);
  if (!host || !host.includes(".")) return null;
  const parts = host.split(".");
  const lastTwo = parts.slice(-2).join(".");
  const take = TWO_PART_TLDS.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join(".");
}

export function isGenericHost(urlOrDomain: string | null | undefined): boolean {
  const host = hostOf(urlOrDomain);
  if (!host) return true;
  const dk = domainKey(host);
  return GENERIC_HOSTS.has(host) || (dk !== null && GENERIC_HOSTS.has(dk)) || /\.(gov|edu|mil)$/.test(host);
}

// "Fly.io" -> "fly", "Kino AI" -> "kino", "Linear, Inc." -> "linear".
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|llc|ltd|gmbh|corp|corporation|co|company|labs?|hq|technologies|technology)\b\.?/g, " ")
    .replace(/\.(io|ai|com|dev|app|so|co|sh|xyz|run|tech|cloud|inc|org|net)\b/g, " ")
    .replace(/\s(ai|app|hq)$/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
}
