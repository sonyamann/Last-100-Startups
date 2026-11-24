// POST /startups/api/subscribe: the newsletter form. Uses Ghost's public
// members signup (the same "magic link" flow as Ghost's own Portal), so the
// visitor gets Ghost's confirmation email and only becomes a member when
// they click it (double opt-in). New members are labelled
// "Last 100 Startups".
//
// Ghost 6 asks for a fresh integrity token before each signup; it's fetched
// from the public site. GHOST_SITE_URL is the public site (the ghost.io
// address rejects this API version).
//
// A filled-in honeypot is a bot and is told it worked; each visitor gets a
// few tries an hour. Every outcome but "invalid" reads as done to the
// visitor, so the form never reveals who is already subscribed.

const SITE = (process.env.GHOST_SITE_URL ?? "https://www.sonyasupposedly.com").replace(/\/+$/, "");
const LABEL = "Last 100 Startups";
const PER_HOUR = 5;

export type SubscribeState = "done" | "invalid" | "failed" | "rate_limited";

const looksLikeEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function createSubscribe(opts: { log?: (s: string) => void; fetch?: typeof fetch } = {}) {
  const log = opts.log ?? console.error;
  const doFetch = opts.fetch ?? fetch;
  const recent = new Map<string, number[]>();

  return async function subscribe(body: unknown, ip: string): Promise<{ status: number; state: SubscribeState }> {
    const { email: raw, website } = (body ?? {}) as { email?: unknown; website?: unknown };
    if (typeof website === "string" && website) return { status: 200, state: "done" };
    const email = typeof raw === "string" ? raw.trim() : "";
    if (!looksLikeEmail(email)) return { status: 400, state: "invalid" };

    const hourAgo = Date.now() - 3600_000;
    const list = (recent.get(ip) ?? []).filter((t) => t > hourAgo);
    if (list.length >= PER_HOUR) return { status: 429, state: "rate_limited" };
    recent.set(ip, [...list, Date.now()]);

    try {
      const tokenRes = await doFetch(`${SITE}/members/api/integrity-token/`, { signal: AbortSignal.timeout(8000) });
      if (!tokenRes.ok) throw new Error(`integrity token ${tokenRes.status}`);
      const integrityToken = await tokenRes.text();
      const res = await doFetch(`${SITE}/members/api/send-magic-link/`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, referer: `${SITE}/` },
        body: JSON.stringify({ email, emailType: "signup", labels: [LABEL], integrityToken }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { status: 200, state: "done" };
      const text = await res.text();
      if (res.status === 400 && /email/i.test(text)) return { status: 400, state: "invalid" };
      throw new Error(`Ghost ${res.status}: ${text.slice(0, 300)}`);
    } catch (err) {
      log(`newsletter signup failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 503, state: "failed" };
    }
  };
}
