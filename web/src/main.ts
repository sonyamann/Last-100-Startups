// Last 100 Startups: loads board.json, draws one soap bubble per startup,
// runs the clump, and merges bubbles dropped onto each other into fantasy
// startups (written by the server, POST api/merge).
//
// Pointer handling:
// - mouse: hover peeks at the card, click pins it, press-and-move drags;
// - touch: tap opens the card as a bottom sheet; long-press then move drags
//   (so ordinary swipes still scroll the page);
// - drop a dragged bubble on another to merge them, or into an acquirer's
//   mouth below the clump to sell it (the mouths stick to the bottom of the
//   screen while dragging, and the page scrolls near its edges);
// - keyboard: bubbles are buttons; Enter opens the card, whose "Merge with"
//   picker does the same as a drop.

import { ACQUIRERS, Acquirers, toastFor, type Acquirer } from "./acquirers.ts";
import { track } from "./analytics.ts";
import { Card, aboutHtml, dealLine, devouredHtml, errorHtml, mashupHtml, pendingHtml, startupHtml, type MergeOption } from "./card.ts";
import { ago, escapeHtml, monthYear } from "./format.ts";
import { Clump, type PillItem } from "./physics.ts";
import type { Board, Bubble, Mashup } from "./types.ts";

const clumpEl = document.getElementById("clump")!;
const metaEl = document.getElementById("meta")!;
const hintEl = document.getElementById("hint")!;
const card = new Card(document.getElementById("card")!, document.getElementById("scrim")!);
const acquirers = new Acquirers(document.getElementById("acquirers")!);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;

const LONG_PRESS_MS = 350;
const DRAG_SLOP = 6;

// One bubble on the page: a real startup, a finished mashup, or a merger
// still being written.
interface Node {
  id: string;           // the startup's slug, or the mashup's key
  el: HTMLButtonElement;
  slugs: string[];      // the real startups inside it
  names: string[];
  fs: number;           // font size, px
  startup?: Bubble;
  mashup?: Mashup;
  pending?: boolean;
}

let board: Board;
let clump: Clump | null = null;
const nodes = new Map<HTMLElement, Node>();
let builtWidth = 0;
let narrow = false;
let maxSize = 1;
let standbyNext = 0; // next startup from board.standby to float up

const nodeById = (id: string) => [...nodes.values()].find((n) => n.id === id);
const nodeOf = (el: Element | null) => (el ? nodes.get(el as HTMLElement) : undefined);

// --- Bubbles -----------------------------------------------------------------

// Bubble size grows with the square root of mentions: counts run from 1 to
// a couple of hundred, and most startups have one or two.
function fontSize(size: number, max: number): number {
  const [lo, hi] = narrow ? [11, 23] : [13, 33];
  const t = max > 1 ? Math.sqrt((size - 1) / (max - 1)) : 0;
  return Math.round((lo + (hi - lo) * t) * 10) / 10;
}

function makeEl(label: string, fs: number, extraClass = ""): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `pill ${extraClass}`.trim();
  el.style.fontSize = `${fs}px`;
  // Each bubble's film starts at its own hue and turns at its own speed, so
  // they don't shimmer in unison.
  el.style.setProperty("--hue", `${Math.round(Math.random() * 360)}deg`);
  // A slightly different blob for every bubble: each corner gets its own
  // rounding (all under 50%, so the ends stay full rather than pointed).
  const r = () => `${Math.round(36 + Math.random() * 13)}%`;
  el.style.borderRadius = `${r()} ${r()} ${r()} ${r()} / ${r()} ${r()} ${r()} ${r()}`;
  el.style.setProperty("--dur", `${(9 + Math.random() * 9).toFixed(1)}s`);
  el.style.setProperty("--delay", `${(-Math.random() * 18).toFixed(1)}s`);
  el.innerHTML = `<span class="pill__film" aria-hidden="true"></span><span class="pill__name"></span>`;
  setLabel(el, label);
  return el;
}

function setLabel(el: HTMLElement, label: string): void {
  const name = el.querySelector<HTMLElement>(".pill__name")!;
  name.textContent = label;
  // Long multi-word names wrap onto two lines, so their bubble comes out
  // rounder instead of a long thin oval.
  name.classList.toggle("pill__name--wrap", label.includes(" ") && label.length > 9);
}

// Size a bubble as a full-ended blob around its name (a superellipse needs
// less room around the text than a true ellipse), never taller than wide and
// never more than 1.8 times wider than tall. The element must be in the page.
function measure(el: HTMLElement): PillItem {
  el.style.width = "";
  el.style.height = "";
  const name = el.querySelector<HTMLElement>(".pill__name")!;
  const fs = parseFloat(el.style.fontSize);
  let h = Math.round((name.offsetHeight + fs * 0.45) * 1.28);
  const w = Math.max(h, Math.round((name.offsetWidth + fs * 0.5) * 1.18));
  h = Math.max(h, Math.round(w / 1.8));
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return { el, w, h };
}

function ariaFor(n: Node): string {
  if (n.pending) return `Merging ${n.names.join(" and ")}…`;
  if (n.mashup) return `${n.mashup.name}: a fantasy merger of ${n.names.join(" and ")}. Show details.`;
  const b = n.startup!;
  return `${b.name}: ${b.size} ${b.size === 1 ? "mention" : "mentions"}. Show details.`;
}

function build(): void {
  clump?.destroy();
  card.close();
  nodes.clear();
  const width = clumpEl.clientWidth;
  narrow = width < 640;
  maxSize = Math.max(...board.bubbles.map((b) => b.size));
  standbyNext = 0;
  clumpEl.replaceChildren();
  for (const b of board.bubbles) {
    const fs = fontSize(b.size, maxSize);
    const n: Node = { id: b.slug, el: makeEl(b.name, fs), slugs: [b.slug], names: [b.name], fs, startup: b };
    n.el.setAttribute("aria-label", ariaFor(n));
    nodes.set(n.el, n);
    clumpEl.append(n.el);
  }

  // Measure, then size the container to hold the bubbles at a crowded but
  // comfortable density. On phones this runs well below the fold.
  const items = [...nodes.values()].map((n) => measure(n.el));
  const area = items.reduce((s, it) => s + (it.w + 5) * (it.h + 5), 0);
  const density = narrow ? 0.8 : 0.6;
  const height = Math.max(narrow ? 420 : 460, Math.round(area / density / width));
  clumpEl.style.height = `${height}px`;
  clumpEl.classList.add("is-ready");

  clump = new Clump(items, { width, height, reducedMotion });
  clumpEl.style.height = `${clump.fitHeight(narrow ? 16 : 28)}px`;
  clump.start();
  builtWidth = width;
}

// --- Cards ---------------------------------------------------------------------

function mergeOptions(n: Node): MergeOption[] {
  return [...nodes.values()].filter((o) => o !== n && !o.pending).map((o) => ({ id: o.id, name: o.mashup?.name ?? o.names[0]! }));
}

const shareUrl = (m: Mashup) => new URL(`m/${m.key}`, location.href).href;

function htmlFor(n: Node): string {
  if (n.pending) return pendingHtml(n.names);
  if (n.mashup) return mashupHtml(n.mashup, shareUrl(n.mashup), mergeOptions(n));
  return startupHtml(n.startup!, board.window_days, mergeOptions(n));
}

card.onMerge = (fromId, toId) => {
  const a = nodeById(fromId);
  const b = nodeById(toId);
  if (a && b && a !== b) void merge(a, b);
};

card.onSell = (id, acquirerId) => {
  const n = nodeById(id);
  const a = ACQUIRERS.find((x) => x.id === acquirerId);
  if (!n || !a || n.pending) return;
  card.close();
  // Bring the mouths on screen so the meal is visible.
  acquirers.setActive(true);
  acquirers.el.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  window.setTimeout(() => eat(n, a), 450);
};

// --- Acquisitions ----------------------------------------------------------------

let unstickTimer = 0;

function eat(n: Node, a: Acquirer): void {
  if (!clump) return;
  const at = clump.homeOf(n.el);
  clump.remove(n.el);
  nodes.delete(n.el);
  if (card.showing(n.id)) card.close();

  // Into the mouth: it gapes, the bubble flies in and shrinks to fit the
  // open cavity, then the jaws snap shut on it and it's gone.
  const name = n.mashup?.name ?? n.names[0]!;
  track("acquire", { acquirer: a.id, target: n.id, kind: n.mashup ? "mashup" : "startup" });
  const line = toastFor(a, name, Boolean(n.mashup));
  const cav = acquirers.cavity(a.id);
  const c = clumpEl.getBoundingClientRect();
  if (cav && !reducedMotion) {
    acquirers.gape(a.id);
    const w = n.el.offsetWidth;
    const h = n.el.offsetHeight;
    const s = Math.min((cav.w * 0.8) / w, (cav.h * 0.8) / h, 1);
    const x = cav.x - (c.left + window.scrollX);
    const y = cav.y - (c.top + window.scrollY);
    n.el.classList.add("is-eaten");
    requestAnimationFrame(() => {
      n.el.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
    });
    window.setTimeout(() => {
      acquirers.chomp(a.id);
      acquirers.announce(a, line);
      n.el.classList.add("is-swallowed");
      window.setTimeout(() => n.el.remove(), 150);
    }, 460);
  } else {
    n.el.remove();
    acquirers.chomp(a.id);
    acquirers.announce(a, line);
  }

  acquirers.bump(a.id);
  // Keep the mouths on screen long enough to see the chomp and the toast.
  acquirers.setActive(true);
  clearTimeout(unstickTimer);
  unstickTimer = window.setTimeout(() => {
    if (!press?.dragging) acquirers.setActive(false);
  }, 4500);

  void fetch("api/acquire", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: n.id, acquirer: a.id }),
  }).catch(() => {});

  if (at) floatUpNext(at);
}

// The next startup on standby blows in where the eaten one was, nudging its
// neighbours aside. (Rising from the bottom of the clump looked nice in
// theory, but a newcomer bigger than the gap got stuck underneath.)
function floatUpNext(gap: { x: number; y: number }): void {
  const b = board.standby[standbyNext];
  if (!b || !clump) return;
  standbyNext++;
  const fs = fontSize(b.size, maxSize);
  const n: Node = { id: b.slug, el: makeEl(b.name, fs), slugs: [b.slug], names: [b.name], fs, startup: b };
  n.el.setAttribute("aria-label", ariaFor(n));
  nodes.set(n.el, n);
  clumpEl.append(n.el);
  const item = measure(n.el);
  n.el.classList.add("is-new");
  clump.add(item, gap.x, gap.y);
}

// --- Merging -------------------------------------------------------------------

async function merge(a: Node, b: Node): Promise<void> {
  if (!clump || a.pending || b.pending) return;
  const pa = clump.position(a.el);
  const pb = clump.position(b.el);
  if (!pa || !pb) return;
  // The merger lands where the dropped-on bubble was, nudged toward the other.
  const at = { x: pb.x * 0.7 + pa.x * 0.3, y: pb.y * 0.7 + pa.y * 0.3 };

  for (const n of [a, b]) {
    clump.remove(n.el);
    nodes.delete(n.el);
    n.el.remove();
  }

  const fs = Math.min(narrow ? 26 : 38, Math.max(a.fs, b.fs) * 1.12 + 1.5);
  const pending: Node = {
    id: `pending:${a.id}+${b.id}`,
    el: makeEl("Merging…", fs, "pill--mashup pill--pending"),
    slugs: [...a.slugs, ...b.slugs],
    names: [...a.names, ...b.names],
    fs,
    pending: true,
  };
  pending.el.setAttribute("aria-label", ariaFor(pending));
  nodes.set(pending.el, pending);
  clumpEl.append(pending.el);
  clump.add(measure(pending.el), at.x, at.y);
  card.open(pending.id, htmlFor(pending), pending.el);

  // Keep the deal-making copy moving while Kimi writes (about 5 seconds).
  let line = 0;
  const ticker = window.setInterval(() => {
    const el = document.querySelector(".card__deal");
    if (el && card.showing(pending.id)) el.textContent = dealLine(++line);
  }, 1300);

  let result: { mashup?: Mashup; error?: string; state?: string };
  try {
    const res = await fetch("api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [a.slugs, b.slugs] }),
    });
    result = (await res.json()) as typeof result;
  } catch {
    result = { error: "The deal fell through. Try again?" };
  }
  clearInterval(ticker);

  if (!clump || !nodes.has(pending.el)) return; // the page was rebuilt meanwhile
  if (result.mashup) {
    const m = result.mashup;
    track("merge", { key: m.key, startups: m.made_from.length, cached: Boolean((result as { cached?: boolean }).cached) });
    const done: Node = { ...pending, id: m.key, pending: false, mashup: m };
    nodes.set(pending.el, done);
    pending.el.classList.remove("pill--pending");
    setLabel(pending.el, m.name);
    pending.el.setAttribute("aria-label", ariaFor(done));
    const size = measure(pending.el);
    clump.resize(pending.el, size.w, size.h);
    card.update(pending.id, htmlFor(done), done.id, pending.el);
    return;
  }

  // It failed: the two bubbles pop back out, and the card says why.
  track("merge_failed", { state: result.state ?? "error" });
  clump.remove(pending.el);
  nodes.delete(pending.el);
  pending.el.remove();
  for (const [n, p] of [[a, { x: at.x - 30, y: at.y }], [b, { x: at.x + 30, y: at.y }]] as const) {
    nodes.set(n.el, n);
    clumpEl.append(n.el);
    clump.add(measure(n.el), p.x, p.y);
  }
  const title =
    result.state === "regulatory_review" ? "Blocked by regulators"
    : result.state === "rate_limited" ? "Too many deals"
    : result.state === "busy" ? "Market overheated"
    : "Deal fell through";
  if (card.showing(pending.id)) card.update(pending.id, errorHtml(title, result.error ?? "Something went wrong."), b.id, b.el);
}

// --- Pointer handling ------------------------------------------------------

interface Press {
  node: Node;
  id: number;
  type: string;
  x0: number;
  y0: number;
  dragging: boolean;
  timer: number;
  target: Node | null;
  mouth: Acquirer | null;
  lastX: number;
  lastY: number;
}
let press: Press | null = null;
let suppressClick = false;

function local(ev: PointerEvent): { x: number; y: number } {
  const r = clumpEl.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function setTarget(t: Node | null): void {
  if (!press || press.target === t) return;
  press.target?.el.classList.remove("is-target");
  t?.el.classList.add("is-target");
  press.target = t;
}

function beginDrag(ev: PointerEvent | null): void {
  if (!press || !clump) return;
  press.dragging = true;
  card.close();
  const el = press.node.el;
  el.classList.add("is-dragging");
  clumpEl.classList.add("is-dragging");
  const p = ev ? local(ev) : clump.position(el);
  if (p) clump.startDrag(el, p.x, p.y);
  if (press.type === "touch") navigator.vibrate?.(8);
  clearTimeout(unstickTimer);
  acquirers.setActive(true);
  requestAnimationFrame(edgeScroll);
}

// While dragging near the top or bottom of the screen, scroll the page, so
// a bubble can be carried the length of a long (phone) clump. Not while the
// pointer is over the mouths, which stick to the bottom of the screen.
function edgeScroll(): void {
  if (!press?.dragging || !clump) return;
  const edge = 64;
  const tray = acquirers.el.getBoundingClientRect();
  const overTray = press.lastY >= tray.top && press.lastY <= tray.bottom;
  let dy = 0;
  if (press.lastY < edge) dy = -Math.ceil((edge - press.lastY) / 5);
  else if (press.lastY > window.innerHeight - edge && !overTray) dy = Math.ceil((press.lastY - (window.innerHeight - edge)) / 5);
  if (dy) {
    window.scrollBy(0, dy);
    dragTo(press.lastX, press.lastY);
  }
  requestAnimationFrame(edgeScroll);
}

// Follow the pointer: move the dragged bubble, and pick a mouth (which
// wins) or a bubble under the pointer as the drop target.
function dragTo(clientX: number, clientY: number): void {
  if (!press || !clump) return;
  press.lastX = clientX;
  press.lastY = clientY;
  const r = clumpEl.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  clump.moveDrag(x, y);
  press.mouth = acquirers.track(clientX, clientY);
  if (press.mouth) return setTarget(null);
  const under = nodeOf(clump.pillAt(x, y, press.node.el));
  setTarget(under && !under.pending ? under : null);
}

function endPress(drop: boolean): void {
  if (!press) return;
  clearTimeout(press.timer);
  const { node, dragging, target, mouth } = press;
  if (dragging) {
    node.el.classList.remove("is-dragging");
    clumpEl.classList.remove("is-dragging");
    target?.el.classList.remove("is-target");
    clump?.endDrag();
    acquirers.relax();
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
  press = null;
  if (dragging && drop && mouth) return eat(node, mouth);
  if (dragging) acquirers.setActive(false);
  if (dragging && drop && target) void merge(node, target);
}

clumpEl.addEventListener("pointerdown", (ev) => {
  const n = nodeOf((ev.target as HTMLElement).closest(".pill"));
  if (!n || n.pending || !clump || press || ev.button > 0) return;
  const el = n.el;
  press = { node: n, id: ev.pointerId, type: ev.pointerType, x0: ev.clientX, y0: ev.clientY, dragging: false, timer: 0, target: null, mouth: null, lastX: ev.clientX, lastY: ev.clientY };
  if (ev.pointerType === "touch") {
    press.timer = window.setTimeout(() => {
      if (press && !press.dragging) {
        el.setPointerCapture(ev.pointerId);
        beginDrag(null);
      }
    }, LONG_PRESS_MS);
  } else {
    el.setPointerCapture(ev.pointerId);
  }
});

clumpEl.addEventListener("pointermove", (ev) => {
  if (!press || ev.pointerId !== press.id) return;
  const moved = Math.hypot(ev.clientX - press.x0, ev.clientY - press.y0);
  if (!press.dragging) {
    if (press.type === "touch") {
      // Moving before the long press fires is a scroll, not a drag.
      if (moved > DRAG_SLOP * 2) {
        clearTimeout(press.timer);
        press = null;
      }
      return;
    }
    if (moved > DRAG_SLOP) beginDrag(ev);
    return;
  }
  dragTo(ev.clientX, ev.clientY);
});

clumpEl.addEventListener("pointerup", () => endPress(true));
clumpEl.addEventListener("pointercancel", () => endPress(false));

// Once a touch drag has begun, stop the page from scrolling under it.
clumpEl.addEventListener("touchmove", (ev) => {
  if (press?.dragging) ev.preventDefault();
}, { passive: false });

// A long press on touch would otherwise open the context menu.
clumpEl.addEventListener("contextmenu", (ev) => {
  if ((ev.target as HTMLElement).closest(".pill")) ev.preventDefault();
});

clumpEl.addEventListener("click", (ev) => {
  const n = nodeOf((ev.target as HTMLElement).closest(".pill"));
  if (!n || suppressClick) return;
  if (card.isPinned && card.showing(n.id)) card.close();
  else {
    card.open(n.id, htmlFor(n), n.el);
    track("bubble_open", { id: n.id, kind: n.mashup ? "mashup" : n.pending ? "pending" : "startup" });
  }
});

// Hover previews, mouse only.
let peekTimer = 0;
clumpEl.addEventListener("pointerover", (ev) => {
  if (ev.pointerType !== "mouse" || press?.dragging) return;
  const n = nodeOf((ev.target as HTMLElement).closest(".pill"));
  if (!n) return;
  clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => card.peek(n.id, htmlFor(n), n.el), 120);
});
clumpEl.addEventListener("pointerout", (ev) => {
  if (ev.pointerType !== "mouse") return;
  const to = ev.relatedTarget as HTMLElement | null;
  if (to?.closest(".pill") === (ev.target as HTMLElement).closest(".pill")) return;
  clearTimeout(peekTimer);
  card.unpeek();
});

// --- Recently devoured -----------------------------------------------------------

// Companies HN mentioned this month that were already acquired, as deflated
// husks under the mouths. Tap one for its card.
function renderDevoured(): void {
  const el = document.getElementById("devoured")!;
  const list = board.devoured ?? [];
  el.hidden = list.length === 0;
  if (!list.length) return;
  el.innerHTML = `
    <h2 class="devoured__title" id="devoured-title">Recently devoured</h2>
    <p class="devoured__sub">Mentioned on HN this month, already eaten.</p>
    <div class="devoured__list">
      ${list.map((d) => {
        const when = monthYear(d.acquired_date);
        return `<button type="button" class="husk" data-slug="${escapeHtml(d.slug)}" aria-label="${escapeHtml(`${d.name}, acquired by ${d.acquirer}${when ? ` in ${when}` : ""}. Show details.`)}">
          <span class="husk__name">${escapeHtml(d.name)}</span>
          <span class="husk__by">→ <strong class="husk__acq">${escapeHtml(d.acquirer)}</strong></span>
          ${when ? `<span class="husk__when">${escapeHtml(when)}</span>` : ""}
        </button>`;
      }).join("")}
    </div>`;
  const r = () => `${Math.round(36 + Math.random() * 13)}%`;
  for (const h of el.querySelectorAll<HTMLElement>(".husk")) {
    h.style.borderRadius = `${r()} ${r()} ${r()} ${r()} / ${r()} ${r()} ${r()} ${r()}`;
    h.style.rotate = `${(Math.random() * 6 - 3).toFixed(1)}deg`;
  }
  el.addEventListener("click", (ev) => {
    const h = (ev.target as HTMLElement).closest<HTMLElement>(".husk");
    const d = h && list.find((x) => x.slug === h.dataset.slug);
    if (!h || !d) return;
    const id = `devoured:${d.slug}`;
    if (card.isPinned && card.showing(id)) card.close();
    else {
      card.open(id, devouredHtml(d, board.window_days), h);
      track("devoured_open", { slug: d.slug, acquirer: d.acquirer });
    }
  });
}

// --- What counts as a startup? -----------------------------------------------------

const aboutButton = document.getElementById("about")!;
aboutButton.addEventListener("click", () => {
  if (card.isPinned && card.showing("about")) return card.close();
  card.open("about", aboutHtml(board?.window_days ?? 30), aboutButton, { modal: true });
  track("about_open");
});

// --- Newsletter and hire-me ---------------------------------------------------------

const newsletter = document.getElementById("newsletter") as HTMLFormElement;
const newsletterStatus = document.getElementById("newsletter-status")!;
const STATUS: Record<string, { text: string; ok: boolean }> = {
  done: { text: "Check your inbox to confirm. 🐰", ok: true },
  invalid: { text: "That email address doesn't look right.", ok: false },
  rate_limited: { text: "That's a lot of signups. Try again in a bit.", ok: false },
  failed: { text: "Couldn't reach the newsletter. Try again in a minute?", ok: false },
};

newsletter.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const data = new FormData(newsletter);
  const email = String(data.get("email") ?? "").trim();
  const show = (state: string) => {
    const s = STATUS[state] ?? STATUS.failed!;
    newsletterStatus.textContent = s.text;
    newsletterStatus.className = `cta__status ${s.ok ? "is-done" : "is-error"}`;
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show("invalid");
  const button = newsletter.querySelector("button")!;
  button.disabled = true;
  newsletterStatus.textContent = "Subscribing…";
  newsletterStatus.className = "cta__status";
  let state = "failed";
  try {
    const res = await fetch("api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, website: String(data.get("website") ?? "") }),
    });
    state = ((await res.json()) as { state?: string }).state ?? "failed";
  } catch {
    state = "failed";
  }
  button.disabled = false;
  show(state);
  track("newsletter_signup", { state });
  if (state === "done") newsletter.reset();
});

document.getElementById("hire-me")!.addEventListener("click", () => track("hire_me_click"));

document.addEventListener("click", (ev) => {
  if ((ev.target as HTMLElement).closest(".card__copy")) track("copy_link");
});

// --- Start -------------------------------------------------------------------

async function main(): Promise<void> {
  const res = await fetch("board.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`board.json: ${res.status}`);
  board = (await res.json()) as Board;
  metaEl.innerHTML = `The ${board.bubbles.length} startups most recently mentioned in Hacker News comments, sized by mentions over the last ${board.window_days} days. <em class="meta__updated">Updated ${escapeHtml(ago(board.generated_at))}.</em>`;
  const hints = coarse
    ? ["Tap or hover over a bubble for details.", "Press, hold and drag one bubble onto another to merge them into a new (fake) startup.", "Press, hold and drag a bubble into a mouth below to sell it to Big Tech."]
    : ["Tap or hover over a bubble for details.", "Drag one bubble onto another to merge them into a new (fake) startup.", "Drag a bubble into a mouth below to sell it to Big Tech."];
  hintEl.innerHTML = hints.map((h) => `<li>${escapeHtml(h)}</li>`).join("");
  await document.fonts.ready;
  build();
  renderDevoured();

  // Rebuild when the width changes meaningfully (not on mobile URL-bar
  // height changes, which fire resize too). Rebuilding resets mergers.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (Math.abs(clumpEl.clientWidth - builtWidth) > 40) build();
    }, 200);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  clumpEl.innerHTML = `<p class="clump__loading">The bubbles didn't load. Try again in a minute.</p>`;
});
