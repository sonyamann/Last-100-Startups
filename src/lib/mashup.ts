// Mashups: two (or more) startups merged into one satirical fantasy startup.
// Kimi writes them; each combination is written once and cached forever
// (the `mashups` table), so a popular pair costs one call no matter how many
// people try it.

import { chat } from "./kimi.ts";
import type { DB } from "./db.ts";

// What the model knows about each real startup going in.
export interface MashupInput {
  name: string;
  one_liner: string | null;
  funding: string | null; // e.g. "≈ $18.7M raised, Series A"
  lean: string | null;    // "loved" | "roasted" | "mixed"
  quote: string | null;   // latest HN quote about it
}

// An earlier mashup that is one of the ingredients (merging a merger).
export interface Lineage {
  name: string;
  tagline: string;
  made_from: string[];
}

export interface Mashup {
  key: string;            // sorted base slugs joined by "+"
  name: string;
  tagline: string;
  pitch: string;
  round: string;          // the fake funding round
  investor_quote: { quote: string; who: string };
  metric: string;
  hn_comment: { text: string; user: string };
  made_from: string[];    // the real startups' names
  created_at: number;
}

export const MASHUP_MODEL = process.env.MASHUP_MODEL ?? "kimi-k3.1-pro-highspeed";

const SYSTEM = `You write satirical fantasy startups for "Last 100 Startups", a page that shows the startups Hacker News commenters mention as a clump of soap bubbles. When a visitor drags one bubble onto another, the companies merge, and you invent the startup they become.

The joke is the startup ecosystem itself: hype, AI-everything, growth metrics, VC-speak, HN cynicism. Dry, deadpan, specific, smart. Make it plausible enough to sting and absurd enough to laugh at. Punch up at the industry, not at the real founders or users.

How to build one:
- Find the funniest true intersection of what the real companies actually do, and push it one step too far. Use each company's actual product, not just its name.
- The name is a portmanteau or blend of the companies' names ("Typesafe" + "Kino" → "Kinotype"). It should be pronounceable and look like a real startup name.
- Example of the spirit: Typesafe (AI judgment models) + Kino (AI video editor) → "Kinotype", which presents every proposed video edit to a judgment model that swipes left or right, like Tinder.
- If it's a merger of a merger, escalate: the previous mashup is now a "legacy business", and the new company is even more over-leveraged and visionary.

Rules:
- All people, investors and funds you invent are fictional. Never name or quote a real person. Never use a real VC firm's name.
- The fictional investor's first and last names must start with the letters in "investor_initials", and the fund's name with the letter in "fund_initial". Invent fresh, specific names each time.
- No slurs, no sexual content, nothing about real tragedies, nothing that would read as a real allegation about the real companies.
- Plain text only: no markdown, no emoji, no hashtags.

Answer with JSON only:
{"name": "the merged company's name",
 "tagline": "under 10 words, the kind printed on a conference tote bag",
 "pitch": "two sentences: what the product does, then the twist that makes it absurd",
 "round": "the fake raise, e.g. '$14M seed led by Paradigm Shift Partners, at a $400M valuation'",
 "investor_quote": {"quote": "one sentence of investor hype", "who": "Fictional Name, Partner at Fictional Fund"},
 "metric": "one absurd but specific traction metric",
 "hn_comment": {"text": "the top Hacker News comment on the launch, one or two sentences, peak HN", "user": "a plausible HN username"}}`;

// Left alone, the model reuses the same few fictional investors ("Mara
// Venn" three times in an afternoon), so each mashup gets random initials.
const INITIALS = "ABCDEFGHJKLMNOPRSTVWZ";
const pick = () => INITIALS[Math.floor(Math.random() * INITIALS.length)]!;

export function mashupPrompt(parts: MashupInput[], lineage: Lineage[]): string {
  return JSON.stringify({
    merging: parts,
    ...(lineage.length ? { previous_mashups_being_merged: lineage } : {}),
    investor_initials: `${pick()}. ${pick()}.`,
    fund_initial: pick(),
  });
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function writeMashup(db: DB, key: string, parts: MashupInput[], lineage: Lineage[], model = MASHUP_MODEL): Promise<Mashup> {
  const out = await chat(db, [{ role: "system", content: SYSTEM }, { role: "user", content: mashupPrompt(parts, lineage) }], {
    model,
    purpose: "mashup",
    json: true,
    maxTokens: 700,
  });
  const j = JSON.parse(out) as Record<string, unknown>;
  const iq = (j.investor_quote ?? {}) as Record<string, unknown>;
  const hn = (j.hn_comment ?? {}) as Record<string, unknown>;
  const m: Mashup = {
    key,
    name: str(j.name, 60),
    tagline: str(j.tagline, 120),
    pitch: str(j.pitch, 500),
    round: str(j.round, 200),
    investor_quote: { quote: str(iq.quote, 300), who: str(iq.who, 100) },
    metric: str(j.metric, 200),
    hn_comment: { text: str(hn.text, 400), user: str(hn.user, 40).replace(/[^\w-]/g, "") || "throwaway" },
    made_from: parts.map((p) => p.name),
    created_at: Math.floor(Date.now() / 1000),
  };
  if (!m.name || !m.pitch) throw new Error("Mashup came back incomplete");
  return m;
}
