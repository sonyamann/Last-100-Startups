// The shape of /startups/board.json. Keep in sync with Bubble and Board in
// src/pipeline/board.ts (the pipeline writes it; this page only reads it).

export interface Bubble {
  slug: string;
  name: string;
  size: number;
  last_mentioned_at: number;
  lean: "loved" | "roasted" | "mixed" | null;
  website: string | null;
  one_liner: string | null;
  founded_year: number | null;
  hq: string | null;
  funding: {
    total_usd: number | null;
    last_round: string | null;
    last_round_usd: number | null;
    last_round_date: string | null;
    investors: string[];
  } | null;
  status: string | null;
  yc_batch: string | null;
  latest: { quote: string; author: string; url: string; at: number; thread: string | null };
  sources: string[];
}

// Already acquired, but still mentioned on HN this month. Keep in sync with
// Devoured in src/pipeline/board.ts.
export interface Devoured {
  slug: string;
  name: string;
  acquirer: string;
  acquired_date: string | null;
  size: number;
  one_liner: string | null;
  website: string | null;
  latest: Bubble["latest"];
}

export interface Board {
  generated_at: number;
  window_days: number;
  bubbles: Bubble[];
  standby: Bubble[];
  devoured?: Devoured[];
}

// A fantasy merger, from POST /startups/api/merge. Keep in sync with Mashup
// in src/lib/mashup.ts.
export interface Mashup {
  key: string;
  name: string;
  tagline: string;
  pitch: string;
  round: string;
  investor_quote: { quote: string; who: string };
  metric: string;
  hn_comment: { text: string; user: string };
  made_from: string[];
  created_at: number;
}
