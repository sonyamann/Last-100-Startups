// TypeSafe's Jev: typed judgments with probabilities.
// Docs: https://docs.typesafe.ai/api

import { need } from "./env.ts";
import { logUsage, type DB } from "./db.ts";
import { fetchRetry } from "./util.ts";

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export async function ask<Q extends Record<string, Question>>(
  db: DB,
  state: unknown,
  questions: Q,
  purpose: string,
): Promise<{ [K in keyof Q]: Answer }> {
  const res = await fetchRetry("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${need("TYPESAFE_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  const json = (await res.json()) as { model?: string; answers?: Record<string, Answer>; usage?: { input_tokens: number; output_tokens: number } };
  if (!res.ok || !json.answers) throw new Error(`Jev ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  if (json.usage) logUsage(db, { provider: "typesafe", model: json.model, purpose, input: json.usage.input_tokens, output: json.usage.output_tokens });
  return json.answers as { [K in keyof Q]: Answer };
}

export const noul = (a: Answer): number => (a.type === "noul" ? a.noul : NaN);
