// Shared definitions of "a startup we show" and "a mention", used by the
// enrichment step, the board, and the report.

import { EXCLUDED_YC_STATUS, THRESHOLDS } from "../config.ts";
import type { DB } from "./db.ts";
import { now } from "./util.ts";

const excludedStatuses = [...EXCLUDED_YC_STATUS].map((s) => `'${s}'`).join(",");

// Enrichment statuses that disqualify a company (found by web search).
export const EXCLUDED_ENRICHED_STATUS = ["acquired", "public", "shut_down"];

// A SQL condition on companies aliased `c`.
export const IS_STARTUP = `(c.denylisted = 0 AND (c.allowlisted = 1 OR (c.is_company_p >= ${THRESHOLDS.isCompany} AND c.startup_p >= ${THRESHOLDS.startup}))
  AND (c.yc_slug IS NULL OR c.yc_slug NOT IN (SELECT slug FROM yc WHERE status IN (${excludedStatuses})))
  AND COALESCE(json_extract(c.enrichment, '$.status'), '') NOT IN (${EXCLUDED_ENRICHED_STATUS.map((s) => `'${s}'`).join(",")}))`;

// A "mention" counts each commenter once per thread, so a founder answering
// questions in their own launch thread, or one person repeating themselves,
// counts once. Comments use their story; posts are their own thread.
export const MENTION_KEY = "COALESCE(i.story_id, i.id) || ':' || i.author";

export const WINDOW_DAYS = 30;
export const BOARD_SIZE = 100;
export const STANDBY_SIZE = 20;

export interface Ranked {
  id: number;
  last: number;
}

// Startups in board order: most recently mentioned first.
export function rankStartups(db: DB, limit: number): Ranked[] {
  return db
    .prepare(
      `SELECT c.id, MAX(i.created_at) last
       FROM companies c JOIN mentions m ON m.company_id = c.id JOIN items i ON i.id = m.item_id
       WHERE ${IS_STARTUP} AND i.created_at >= ?
       GROUP BY c.id ORDER BY last DESC LIMIT ?`,
    )
    .all(now() - WINDOW_DAYS * 86400, limit) as unknown as Ranked[];
}
