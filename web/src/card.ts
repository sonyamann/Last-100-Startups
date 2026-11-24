// The details card. On wide screens with a mouse it's a popover beside the
// bubble (hover to peek, click to pin); on phones it's a bottom sheet.
// It shows whatever HTML it's given: a startup, a merger in progress, a
// finished mashup, or an error. `id` says which bubble it belongs to.

import { ago, escapeHtml, hostOf, money, monthYear, nestQuotes, safeUrl } from "./format.ts";
import { ACQUIRERS } from "./acquirers.ts";
import type { Bubble, Devoured, Mashup } from "./types.ts";

const e = escapeHtml;

const LEAN: Record<NonNullable<Bubble["lean"]>, string> = {
  loved: "HN loves it",
  roasted: "HN roasts it",
  mixed: "HN is divided",
};

const close = `<button class="card__close" type="button" aria-label="Close">×</button>`;

export interface MergeOption {
  id: string;
  name: string;
}

// A merge picker, so merging works without dragging (keyboard, or anyone
// who'd rather not).
function mergeForm(options: MergeOption[]): string {
  if (!options.length) return "";
  const opts = options
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => `<option value="${e(o.id)}">${e(o.name)}</option>`)
    .join("");
  return `<form class="card__merge">
      <label>Merge with <select name="target">${opts}</select></label>
      <button type="submit">Merge</button>
    </form>`;
}

// Selling without dragging: pick an acquirer.
function sellForm(): string {
  const opts = ACQUIRERS.map((a) => `<option value="${a.id}">${e(a.name)}</option>`).join("");
  return `<form class="card__merge card__sell">
      <label>Sell to <select name="acquirer">${opts}</select></label>
      <button type="submit">Sell</button>
    </form>`;
}

export function startupHtml(b: Bubble, windowDays: number, mergeOptions: MergeOption[]): string {
  const site = safeUrl(b.website);
  const facts: string[] = [];
  if (b.yc_batch) facts.push(`YC ${e(b.yc_batch.replace(/^(Winter|Summer|Fall|Spring) (\d{4})$/, (_m, s: string, y: string) => `${s[0]}${y.slice(2)}`))}`);
  if (b.founded_year) facts.push(`Founded ${b.founded_year}`);
  if (b.hq) facts.push(e(b.hq));

  let funding = "";
  if (b.funding) {
    const total = money(b.funding.total_usd);
    const round = b.funding.last_round ? e(b.funding.last_round) : null;
    const roundAmt = money(b.funding.last_round_usd);
    const when = monthYear(b.funding.last_round_date);
    const parts = [
      total ? `<strong>≈ ${total}</strong> raised` : null,
      round ? `last round: ${round}${roundAmt ? ` (${roundAmt})` : ""}${when ? `, ${when}` : ""}` : null,
    ].filter(Boolean);
    const investors = b.funding.investors.length ? `<div class="card__investors">Backed by ${b.funding.investors.map(e).join(", ")}</div>` : "";
    if (parts.length) funding = `<div class="card__funding">${parts.join(" · ")}${investors}<div class="card__fineprint">Per public reports</div></div>`;
  }

  const latest = safeUrl(b.latest.url);
  const quote = `<blockquote class="card__quote">
      <p>“${e(nestQuotes(b.latest.quote))}”</p>
      <footer>${e(b.latest.author)}, ${ago(b.latest.at)}${b.latest.thread ? ` in <cite>${e(b.latest.thread)}</cite>` : ""}${latest ? ` · <a href="${e(latest)}" target="_blank" rel="noopener">read on HN</a>` : ""}</footer>
    </blockquote>`;

  return `${close}
    <header class="card__head">
      <h2 class="card__name card__name--company" id="card-name">${e(b.name)}</h2>
      ${site ? `<a class="card__site" href="${e(site)}" target="_blank" rel="noopener">${e(hostOf(site) ?? site)} ↗</a>` : ""}
    </header>
    ${b.one_liner ? `<p class="card__oneliner">${e(b.one_liner)}</p>` : ""}
    ${facts.length ? `<p class="card__facts">${facts.join(" · ")}</p>` : ""}
    ${funding}
    <p class="card__mentions"><strong>${b.size}</strong> ${b.size === 1 ? "mention" : "mentions"} in the last ${windowDays} days${b.lean ? ` · <span class="lean lean--${b.lean}">${LEAN[b.lean]}</span>` : ""}</p>
    ${quote}
    ${mergeForm(mergeOptions)}
    ${sellForm()}`;
}

const DEAL_LINES = [
  "Scheduling the first partner meeting…",
  "Doing light due diligence…",
  "Finding synergies…",
  "Rewriting the pitch deck in Figma…",
  "Negotiating the liquidation preference…",
  "Announcing on LinkedIn before it closes…",
  "Explaining it to the board…",
];

export function pendingHtml(names: string[]): string {
  return `${close}
    <p class="card__kicker"><span class="fantasy">Fantasy merger</span></p>
    <h2 class="card__name card__name--company" id="card-name">${names.map(e).join(" + ")}</h2>
    <p class="card__deal" aria-live="polite">${DEAL_LINES[0]}</p>`;
}

export function dealLine(i: number): string {
  return DEAL_LINES[i % DEAL_LINES.length]!;
}

export function mashupHtml(m: Mashup, shareUrl: string, mergeOptions: MergeOption[]): string {
  return `${close}
    <p class="card__kicker"><span class="fantasy">Fantasy merger</span> <span class="card__made">${m.made_from.map(e).join(" + ")}</span></p>
    <h2 class="card__name card__name--company" id="card-name">${e(m.name)}</h2>
    <p class="card__tagline">${e(m.tagline)}</p>
    <p class="card__oneliner">${e(m.pitch)}</p>
    <div class="card__funding"><strong>Raised:</strong> ${e(m.round)}</div>
    <blockquote class="card__quote">
      <p>“${e(nestQuotes(m.investor_quote.quote))}”</p>
      <footer>${e(m.investor_quote.who)}</footer>
    </blockquote>
    <p class="card__mentions"><strong>Traction:</strong> ${e(m.metric)}</p>
    <div class="card__hn"><div class="card__hn-user">${e(m.hn_comment.user)} · 1 hour ago</div>${e(m.hn_comment.text)}</div>
    <div class="card__share">
      <a href="${e(shareUrl)}" target="_blank" rel="noopener">Permalink ↗</a>
      <button type="button" class="card__copy" data-url="${e(shareUrl)}">Copy link</button>
    </div>
    ${mergeForm(mergeOptions)}
    ${sellForm()}
    <p class="card__fineprint">Satire. The startups are real; this merger, its investors and its traction are not.</p>`;
}

export function devouredHtml(d: Devoured, windowDays: number): string {
  const site = safeUrl(d.website);
  const when = monthYear(d.acquired_date);
  const latest = safeUrl(d.latest.url);
  return `${close}
    <p class="card__kicker"><span class="devoured-badge">Devoured</span></p>
    <header class="card__head">
      <h2 class="card__name card__name--company" id="card-name">${e(d.name)}</h2>
      ${site ? `<a class="card__site" href="${e(site)}" target="_blank" rel="noopener">${e(hostOf(site) ?? site)} ↗</a>` : ""}
    </header>
    <p class="card__devoured">Acquired by <strong>${e(d.acquirer)}</strong>${when ? `, ${when}` : ""}.</p>
    ${d.one_liner ? `<p class="card__oneliner">${e(d.one_liner)}</p>` : ""}
    <p class="card__mentions">Still mentioned <strong>${d.size}</strong> ${d.size === 1 ? "time" : "times"} on HN in the last ${windowDays} days.</p>
    <blockquote class="card__quote">
      <p>“${e(nestQuotes(d.latest.quote))}”</p>
      <footer>${e(d.latest.author)}, ${ago(d.latest.at)}${d.latest.thread ? ` in <cite>${e(d.latest.thread)}</cite>` : ""}${latest ? ` · <a href="${e(latest)}" target="_blank" rel="noopener">read on HN</a>` : ""}</footer>
    </blockquote>`;
}

// "What counts as a startup?": how the board is made, briefly.
export function aboutHtml(windowDays: number): string {
  return `${close}
    <h2 class="card__name" id="card-name">What counts as a startup?</h2>
    <ul class="card__about">
      <li><strong>Where mentions come from.</strong> Every Hacker News comment, plus Show HN and Launch HN posts (job-ad threads are skipped). An AI model, Moonshot's Kimi, reads them all and lists the companies each one names.</li>
      <li><strong>What a mention is.</strong> One commenter, once per thread. When a company and its best-known product both get mentioned (say, Moonshot AI and its Kimi models), they're merged into one bubble. Talk about the product makes the company's bubble bigger.</li>
      <li><strong>What a startup is.</strong> A young, independent, private company building a product. Not public or acquired companies, household names, companies founded more than about a dozen years ago, open-source projects with no company behind them, side projects or single-purpose tools.</li>
      <li><strong>Who decides.</strong> A judgment model, TypeSafe's Jev, checked against web searches for funding and acquisitions, plus a few editorial calls. Companies found to be acquired go to the “Recently devoured” section below.</li>
      <li><strong>The board.</strong> The 100 startups mentioned most recently, each sized by its mentions over the last ${windowDays} days.</li>
    </ul>
    <p class="card__fineprint">Details on the cards come from public web reports and can lag or be wrong.</p>`;
}

export function errorHtml(title: string, message: string): string {
  return `${close}
    <h2 class="card__name" id="card-name">${e(title)}</h2>
    <p class="card__oneliner">${e(message)}</p>`;
}

export class Card {
  private el: HTMLElement;
  private scrim: HTMLElement;
  private pinned = false;
  private current: string | null = null;
  private anchor: HTMLElement | null = null;
  onClose: () => void = () => {};
  onMerge: (fromId: string, toId: string) => void = () => {};
  onSell: (id: string, acquirerId: string) => void = () => {};

  constructor(el: HTMLElement, scrim: HTMLElement) {
    this.el = el;
    this.scrim = scrim;
    el.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest(".card__close")) this.close();
      const copy = t.closest<HTMLButtonElement>(".card__copy");
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.url ?? "").then(
          () => (copy.textContent = "Copied"),
          () => (copy.textContent = "Couldn't copy"),
        );
      }
    });
    el.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(ev.target as HTMLFormElement);
      const target = data.get("target");
      const acquirer = data.get("acquirer");
      if (this.current && typeof target === "string") this.onMerge(this.current, target);
      if (this.current && typeof acquirer === "string") this.onSell(this.current, acquirer);
    });
    scrim.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.el.hidden) this.close();
    });
    document.addEventListener("pointerdown", (ev) => {
      if (!this.pinned || this.el.hidden) return;
      const t = ev.target as HTMLElement;
      if (!t.closest(".card") && !t.closest(".pill") && !t.closest(".husk") && !t.closest(".about-button")) this.close();
    });
  }

  get isSheet(): boolean {
    return window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
  }

  get isPinned(): boolean {
    return this.pinned && !this.el.hidden;
  }

  showing(id: string): boolean {
    return !this.el.hidden && this.current === id;
  }

  // Hover preview (mouse only). Ignored while a card is pinned.
  peek(id: string, html: string, anchor: HTMLElement): void {
    if (this.pinned || this.isSheet) return;
    this.render(id, html);
    this.anchor = anchor;
    this.place(anchor);
  }

  unpeek(): void {
    if (!this.pinned) this.hide();
  }

  // `modal`: a centred pop-up over a dimmed page on wide screens (for long
  // content like the explainer); phones get the bottom sheet either way.
  open(id: string, html: string, anchor: HTMLElement, opts: { modal?: boolean } = {}): void {
    this.pinned = true;
    this.anchor = anchor;
    this.render(id, html, true);
    this.el.classList.add("is-pinned");
    if (opts.modal && !this.isSheet) {
      this.el.classList.add("card--modal");
      this.el.style.transform = "";
      this.el.setAttribute("aria-modal", "true");
      this.scrim.hidden = false;
    } else if (this.isSheet) {
      this.el.classList.add("card--sheet");
      this.el.style.transform = "";
      this.el.setAttribute("aria-modal", "true");
      this.scrim.hidden = false;
      document.body.classList.add("sheet-open");
    } else {
      this.place(anchor);
    }
    this.el.querySelector<HTMLElement>(".card__close")?.focus({ preventScroll: true });
  }

  // Swap the content of the card that's showing (a merger finishing), and
  // move it to a new id/anchor if the bubble changed.
  update(id: string, html: string, newId = id, anchor?: HTMLElement): void {
    if (!this.showing(id)) return;
    this.el.innerHTML = html;
    this.current = newId;
    if (anchor) this.anchor = anchor;
    if (!this.isSheet && this.anchor) this.place(this.anchor);
  }

  close(): void {
    const wasOpen = !this.el.hidden;
    this.pinned = false;
    this.hide();
    if (wasOpen) {
      if (this.anchor?.isConnected) this.anchor.focus({ preventScroll: true });
      this.onClose();
    }
  }

  private render(id: string, html: string, force = false): void {
    if (force || this.current !== id || this.el.hidden) this.el.innerHTML = html;
    this.current = id;
    this.el.classList.remove("card--sheet", "card--modal", "is-pinned");
    this.el.setAttribute("aria-modal", "false");
    this.el.hidden = false;
  }

  private hide(): void {
    this.el.hidden = true;
    this.el.classList.remove("card--sheet", "card--modal", "is-pinned");
    this.scrim.hidden = true;
    document.body.classList.remove("sheet-open");
    this.current = null;
  }

  // Beside the bubble, flipped to stay on screen. Page coordinates, so the
  // card scrolls with the page.
  private place(anchor: HTMLElement): void {
    const a = anchor.getBoundingClientRect();
    const c = this.el.getBoundingClientRect();
    const m = 12;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = a.left + a.width / 2 - c.width / 2;
    left = Math.max(m, Math.min(vw - c.width - m, left));
    let top = a.bottom + m;
    if (top + c.height > vh - m && a.top - m - c.height > m) top = a.top - m - c.height;
    this.el.style.transform = `translate(${Math.round(left + window.scrollX)}px, ${Math.round(top + window.scrollY)}px)`;
  }
}
