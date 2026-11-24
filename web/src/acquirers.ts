// The hungry acquirers under the clump. Each is an abstract cartoon mouth
// in a colour that hints at the company, with its name underneath: no
// logos. Mouths open wider as a dragged bubble comes near, their eyes follow
// it, and a bubble dropped in gets chomped, followed by a burp and a toast.

import { escapeHtml } from "./format.ts";

export interface Acquirer {
  id: string;
  name: string;
  color: string;
  lines: string[]; // "{name}" becomes the startup's name
}

// Representative, not comprehensive (Sonya's set, 2026-11-05).
export const ACQUIRERS: Acquirer[] = [
  {
    id: "google",
    name: "Google",
    color: "#4c8bf5",
    lines: [
      "Joining the Google family. See you in the Graveyard in 18 months.",
      "{name} is now a Google Labs experiment. Sunset date: soon.",
      "Acquired by Google. Will be relaunched three times under different names.",
    ],
  },
  {
    id: "meta",
    name: "Meta",
    color: "#7c6cff",
    lines: [
      "Acquihired by Meta. Product sunset in 90 days; team reassigned to superintelligence.",
      "{name} is now a feature in Instagram that nobody can find.",
      "Acquired by Meta for a sum best described as “yes.”",
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    color: "#7fba00",
    lines: [
      "Acquired by Microsoft. Rebranded as Copilot for {name}.",
      "{name} is now part of Microsoft Teams. Our condolences.",
      "Acquired by Microsoft. Available in 18 months for Enterprise E5 customers.",
    ],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    color: "#38c6ff",
    lines: [
      "Acquired by Salesforce. Now sold only in three-year enterprise contracts.",
      "{name} is now an Agentforce skill. Please contact your account executive.",
      "Acquired by Salesforce. The free tier is now a “conversation.”",
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    color: "#d97757",
    lines: [
      "Acquired by Anthropic. {name} is now a Claude skill, available in research preview.",
      "{name} joins Anthropic. The founders are now Members of Technical Staff.",
      "Acquired by Anthropic. {name} ships next quarter, with a five-hour usage limit.",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    color: "#e6e8ee",
    lines: [
      "Acquired by OpenAI. {name} is now a ChatGPT feature for Pro users ($200/mo).",
      "{name} joins OpenAI. Announced in a lowercase post at 11pm.",
      "Acquired by OpenAI. {name} will power a device coming “later this year.”",
    ],
  },
];

// A merger of mergers gets the regulators' attention first.
const MASHUP_PREFIX = "Antitrust review pending. ";

export function toastFor(a: Acquirer, name: string, isMashup: boolean): string {
  const line = a.lines[Math.floor(Math.random() * a.lines.length)]!.replaceAll("{name}", name);
  return (isMashup ? MASHUP_PREFIX : "") + line;
}

// The mouth: a round creature with eyes and a jaw. CSS drives the opening
// (--open, 0 to 1, which scales the whole jaw vertically) and where the
// pupils look (--lx, --ly).
//
// The jaw is an oval cavity. Each tooth sits on the cavity's rim (upper
// teeth hang from the top arc, lower teeth rise from the bottom arc), and
// teeth, tongue and all are clipped to the cavity, so nothing pokes out
// past the lips. Teeth are shorter toward the corners, as in a real mouth.
const JAW = { cx: 60, cy: 64, rx: 29, ry: 20 };

function rimY(x: number, side: -1 | 1): number {
  const t = (x - JAW.cx) / JAW.rx;
  return JAW.cy + side * JAW.ry * Math.sqrt(Math.max(0, 1 - t * t));
}

function teeth(xs: number[], side: -1 | 1, height: number): string {
  const half = 4.3; // overlap a hair so neighbouring teeth touch
  return xs
    .map((x) => {
      const t = (x - JAW.cx) / JAW.rx;
      const h = height * Math.sqrt(Math.sqrt(Math.max(0, 1 - t * t)));
      // The base starts just outside the rim (clipped away) so each tooth
      // meets the edge cleanly even where the rim slopes.
      const yl = rimY(x - half, side) + side * 2;
      const yr = rimY(x + half, side) + side * 2;
      const tip = rimY(x, side) - side * h;
      return `M${(x - half).toFixed(1)} ${yl.toFixed(1)} L${x.toFixed(1)} ${tip.toFixed(1)} L${(x + half).toFixed(1)} ${yr.toFixed(1)} Z`;
    })
    .join(" ");
}

const UPPER = teeth([36, 44, 52, 60, 68, 76, 84], -1, 8);
const LOWER = teeth([40, 48, 56, 64, 72, 80], 1, 6.5);

function mouthSvg(color: string, id: string): string {
  const clip = `mouth-clip-${id}`;
  const { cx, cy, rx, ry } = JAW;
  return `<svg class="mouth__svg" viewBox="0 0 120 104" aria-hidden="true">
    <defs><clipPath id="${clip}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" /></clipPath></defs>
    <path class="mouth__body" fill="${color}" d="M60 8 C92 8 114 30 114 58 C114 86 92 100 60 100 C28 100 6 86 6 58 C6 30 28 8 60 8 Z" />
    <path class="mouth__shine" d="M30 26 C38 18 52 15 62 16" />
    <g class="mouth__jaw">
      <ellipse class="mouth__cavity" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />
      <g clip-path="url(#${clip})">
        <ellipse class="mouth__tongue" cx="${cx}" cy="${cy + ry - 3}" rx="15" ry="8" />
        <path class="mouth__teeth" d="${UPPER}" />
        <path class="mouth__teeth" d="${LOWER}" />
      </g>
    </g>
    <g class="mouth__eyes">
      <circle cx="42" cy="38" r="9" fill="#fff" /><circle class="mouth__pupil" cx="42" cy="38" r="4" />
      <circle cx="78" cy="38" r="9" fill="#fff" /><circle class="mouth__pupil" cx="78" cy="38" r="4" />
      <rect class="mouth__lid" x="31" y="27" width="22" height="22" rx="11" fill="${color}" />
      <rect class="mouth__lid" x="67" y="27" width="22" height="22" rx="11" fill="${color}" />
    </g>
  </svg>`;
}

export class Acquirers {
  readonly el: HTMLElement;
  private mouths = new Map<string, HTMLElement>();
  private toastEl: HTMLElement;
  private counts: Record<string, number> = {};

  constructor(container: HTMLElement) {
    this.el = container;
    container.innerHTML = `
      <p class="acquirers__title">Exit opportunities</p>
      <div class="acquirers__row">
        ${ACQUIRERS.map((a) => `
          <div class="mouth" data-acquirer="${a.id}" role="img" aria-label="${escapeHtml(a.name)}, hungry">
            ${mouthSvg(a.color, a.id)}
            <span class="mouth__name">${escapeHtml(a.name)}</span>
            <span class="mouth__count" aria-hidden="true"></span>
          </div>`).join("")}
      </div>
      <div class="acquirers__toast" aria-live="polite"></div>
      <p class="acquirers__total"></p>`;
    for (const m of container.querySelectorAll<HTMLElement>(".mouth")) this.mouths.set(m.dataset.acquirer!, m);
    this.toastEl = container.querySelector(".acquirers__toast")!;
    // Idle blinking, at different times for each mouth.
    for (const m of this.mouths.values()) m.style.setProperty("--blink-delay", `${(Math.random() * 6).toFixed(1)}s`);
  }

  // While a bubble is dragged: mouths near the pointer open, every mouth
  // watches it, and the one under the pointer (if any) is returned.
  track(clientX: number, clientY: number): Acquirer | null {
    let over: Acquirer | null = null;
    for (const a of ACQUIRERS) {
      const m = this.mouths.get(a.id)!;
      const r = m.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.45;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d = Math.hypot(dx, dy);
      const open = Math.max(0, Math.min(1, 1 - (d - r.width * 0.4) / 260));
      m.style.setProperty("--open", open.toFixed(3));
      m.style.setProperty("--lx", `${((dx / (d || 1)) * 3).toFixed(2)}px`);
      m.style.setProperty("--ly", `${((dy / (d || 1)) * 3).toFixed(2)}px`);
      const pad = 10;
      const inside = clientX > r.left - pad && clientX < r.right + pad && clientY > r.top - pad && clientY < r.bottom + pad;
      m.classList.toggle("is-target", inside);
      if (inside) over = a;
    }
    return over;
  }

  // Back to idle when the drag ends.
  relax(): void {
    for (const m of this.mouths.values()) {
      m.style.setProperty("--open", "0");
      m.style.setProperty("--lx", "0px");
      m.style.setProperty("--ly", "0px");
      m.classList.remove("is-target");
    }
  }

  setActive(active: boolean): void {
    this.el.classList.toggle("is-active", active);
  }

  // The open mouth (the dark cavity when fully open), in page coordinates:
  // where a gobbled bubble goes, and how big it may be once inside. Matches
  // JAW in the 120×104 SVG.
  cavity(id: string): { x: number; y: number; w: number; h: number } | null {
    const m = this.mouths.get(id);
    if (!m) return null;
    const r = m.querySelector(".mouth__svg")!.getBoundingClientRect();
    return {
      x: r.left + r.width * (JAW.cx / 120) + window.scrollX,
      y: r.top + r.height * (JAW.cy / 104) + window.scrollY,
      w: r.width * ((JAW.rx * 2) / 120),
      h: r.height * ((JAW.ry * 2) / 104),
    };
  }

  // Open wide and look up, ready for a meal.
  gape(id: string): void {
    const m = this.mouths.get(id);
    if (!m) return;
    m.style.setProperty("--open", "1");
    m.style.setProperty("--lx", "0px");
    m.style.setProperty("--ly", "-3px");
  }

  // Snap shut (twice), then burp. The jaws first meet about 140ms in.
  chomp(id: string): void {
    const m = this.mouths.get(id);
    if (!m) return;
    m.classList.remove("is-chomping", "is-burping");
    void m.offsetWidth; // restart the animations
    m.classList.add("is-chomping");
    window.setTimeout(() => {
      m.classList.remove("is-chomping");
      m.style.setProperty("--open", "0");
      m.style.setProperty("--ly", "0px");
      m.classList.add("is-burping");
      window.setTimeout(() => m.classList.remove("is-burping"), 900);
    }, 650);
  }

  // The outcome, as a callout in the acquirer's colour.
  announce(a: Acquirer, line: string): void {
    this.toastEl.innerHTML = `<div class="deal" style="--acq: ${a.color}">
        <span class="deal__kicker">Sold to ${escapeHtml(a.name)}</span>
        <p class="deal__line">${escapeHtml(line)}</p>
      </div>`;
    this.toastEl.classList.remove("is-shown");
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("is-shown");
  }

  // Tallies are the visitor's own, since this page loaded: every visit
  // starts with a fresh board, so a shared count read as nonsense.
  private renderCounts(): void {
    let total = 0;
    for (const a of ACQUIRERS) {
      const n = this.counts[a.id] ?? 0;
      total += n;
      this.mouths.get(a.id)!.querySelector(".mouth__count")!.textContent = n ? `${n.toLocaleString()} eaten` : "";
    }
    this.el.querySelector(".acquirers__total")!.textContent = total
      ? `You have sold ${total.toLocaleString()} ${total === 1 ? "startup" : "startups"} to Big Tech so far.`
      : "";
  }

  bump(id: string): void {
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    this.renderCounts();
  }
}
