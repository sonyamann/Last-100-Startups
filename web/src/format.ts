// Small formatting helpers for the cards.

export function money(usd: number | null | undefined): string | null {
  if (!usd || usd <= 0) return null;
  if (usd >= 1e9) return `$${trim(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${trim(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${usd}`;
}

const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

export function ago(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

// "2025-11" -> "Nov 2025"
export function monthYear(date: string | null): string | null {
  if (!date) return null;
  const [y, m] = date.split("-");
  if (!y) return null;
  if (!m) return y;
  const month = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${y}`;
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// For text shown inside “double quotes”: quotation marks within it become
// single quotes, ‘like this’. Straight quotes alternate open/close; an
// apostrophe inside a word (don't) is left alone.
export function nestQuotes(s: string): string {
  let open = true;
  return s
    .replace(/[“”]/g, (c) => (c === "“" ? "‘" : "’"))
    .replace(/"/g, () => {
      const q = open ? "‘" : "’";
      open = !open;
      return q;
    });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Only http(s) links from the data are rendered as links.
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
