// GET /startups/m/<key>: a shareable page for one mashup, rendered on the
// server so link previews (Open Graph) show the fake startup's name and
// tagline. It links back to the board, where the visitor can make their own.

import type { Mashup } from "../lib/mashup.ts";

const e = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function permalinkHtml(m: Mashup, url: string): string {
  const title = `${m.name}: ${m.tagline}`;
  const made = m.made_from.map(e).join(" + ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(m.name)} · The Last 100 Startups</title>
<meta name="description" content="${e(m.tagline)} A fantasy merger of ${made}, from The Last 100 Startups." />
<meta property="og:type" content="website" />
<meta property="og:title" content="${e(title)}" />
<meta property="og:description" content="A fantasy merger of ${made}. ${e(m.round)}" />
<meta property="og:url" content="${e(url)}" />
<meta property="og:image" content="${e(url)}.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${e(`${m.made_from.join(" + ")} = ${m.name}: ${m.tagline}`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${e(url)}.png" />
<meta name="twitter:title" content="${e(title)}" />
<meta name="twitter:description" content="A fantasy merger of ${made}. ${e(m.round)}" />
<meta name="theme-color" content="#05060a" />
<link rel="icon" type="image/svg+xml" href="/startups/favicon.svg" />
<script>
  if (/(^|\.)sonyasupposedly\.com$/.test(location.hostname)) {
    var ga = document.createElement("script");
    ga.async = true;
    ga.src = "https://www.googletagmanager.com/gtag/js?id=G-TLGPPRF6DF";
    document.head.appendChild(ga);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", "G-TLGPPRF6DF");
    gtag("event", "merge_permalink_view", { key: ${JSON.stringify(m.key).replace(/</g, "\\u003c")} });
  }
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Handjet:wght@300..700&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: dark; --ink: #eef1f8; --ink-2: #a7aec0; --ink-3: #6f7689; --accent: #9fd8ff; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: radial-gradient(1000px 600px at 50% 20%, #0e1120, transparent 70%), #05060a; color: var(--ink);
         font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; display: grid; place-items: center; padding: 32px 16px; }
  main { width: min(560px, 100%); }
  .kicker { font-size: 13px; color: var(--ink-3); text-align: center; margin: 0 0 18px; }
  .kicker a { color: var(--ink-2); }
  article { padding: 28px 26px; border-radius: 26px; background: rgba(16,18,27,.85); border: 1px solid rgba(255,255,255,.12);
            box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06); position: relative; overflow: hidden; }
  article::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1.5px; pointer-events: none;
            background: conic-gradient(from 200deg, #ff78b9, #ffd678, #82ffc3, #6ecdff, #b991ff, #ff78b9); opacity: .55;
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
            mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
  .made { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 14px; color: var(--ink-2); margin: 0 0 6px; }
  .fantasy { display: inline-block; padding: 5px 12px 6px; border-radius: 999px; background: #ff4fae; color: #1c0010; font: 700 13px/1 Inter, sans-serif;
             letter-spacing: .08em; text-transform: uppercase; box-shadow: 0 0 0 1px rgba(255,255,255,.25) inset, 0 0 20px rgba(255,60,170,.55); }
  h1 { font: 400 clamp(40px, 9vw, 60px)/1 Handjet, "Instrument Serif", Georgia, serif; margin: 6px 0 4px; }
  .tagline { font: italic 22px/1.3 "Instrument Serif", Georgia, serif; color: var(--ink-2); margin: 0 0 16px; }
  .pitch { margin: 0 0 16px; }
  .round { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); font-size: 14px; color: var(--ink-2); }
  .round strong { color: var(--ink); }
  blockquote { margin: 16px 0 0; padding-left: 12px; border-left: 2px solid rgba(160,215,255,.35); }
  blockquote p { margin: 0; font: 19px/1.3 "Instrument Serif", Georgia, serif; }
  blockquote footer { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
  .metric { font-size: 14px; color: var(--ink-2); margin: 16px 0 0; }
  .hn { margin-top: 18px; padding: 10px 12px; border-radius: 10px; background: #f6f6ef; color: #000; font: 13px/1.4 Verdana, Geneva, sans-serif; }
  .hn .user { color: #828282; font-size: 11px; margin-bottom: 4px; }
  .fine { font-size: 12px; color: var(--ink-3); margin: 18px 0 0; text-align: center; }
  .cta { display: block; margin: 22px auto 0; width: fit-content; padding: 12px 20px; border-radius: 999px; color: #05060a; text-decoration: none; font-weight: 600;
         background: linear-gradient(100deg, #f6f7ff, #b9e6ff 40%, #ffd1ec 70%, #fff4c9); }
</style>
</head>
<body>
<main>
  <p class="kicker">A fantasy merger from <a href="/startups/">The Last 100 Startups</a></p>
  <article>
    <p class="made"><span class="fantasy">Fantasy merger</span> ${made}</p>
    <h1>${e(m.name)}</h1>
    <p class="tagline">${e(m.tagline)}</p>
    <p class="pitch">${e(m.pitch)}</p>
    <div class="round"><strong>Raised:</strong> ${e(m.round)}</div>
    <blockquote><p>“${e(m.investor_quote.quote)}”</p><footer>${e(m.investor_quote.who)}</footer></blockquote>
    <p class="metric"><strong>Traction:</strong> ${e(m.metric)}</p>
    <div class="hn"><div class="user">${e(m.hn_comment.user)} · 1 hour ago</div>${e(m.hn_comment.text)}</div>
  </article>
  <p class="fine">Satire. The startups being merged are real; this one isn't, and neither are its investors.</p>
  <a class="cta" href="/startups/">Merge your own →</a>
</main>
</body>
</html>`;
}
