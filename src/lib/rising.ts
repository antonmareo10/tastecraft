// "Rising around you": popularity trends for the restaurant and its local peers, fetched through Qloo's
// official harness `trends` workflow (one /v2/trending call per place) and summarised by src/lib/trends.ts.

import { trends as harnessTrends, type HarnessError } from "./qloo-harness";
import { summarizeTrend, trendWindow, type TrendSummary } from "./trends";

export type RisingRow = { entityId: string; name: string; summary: TrendSummary };

export type RisingResult =
  | { ok: true; window: { start: string; end: string }; rows: RisingRow[] }
  | { ok: false; kind: "needs_input"; message: string }
  | { ok: false; kind: "error"; error: HarnessError };

export const DEFAULT_TREND_DAYS = 180;

export async function risingNearby(
  entityIds: string[],
  days = DEFAULT_TREND_DAYS,
  opts: { now?: Date; trendsFn?: typeof harnessTrends } = {},
): Promise<RisingResult> {
  const window = trendWindow(Math.min(365, Math.max(1, days)), opts.now);
  const r = await (opts.trendsFn ?? harnessTrends)({
    entities: [...new Set(entityIds)].slice(0, 5),
    entityType: "place",
    startDate: window.start,
    endDate: window.end,
    limit: 20, // the harness maximum per entity
  });
  if (r.status === "needs_input") {
    const which = r.issues
      .map((i) =>
        i.status === "ambiguous"
          ? `"${i.input}" is ambiguous (${(i.candidates ?? []).slice(0, 3).map((c) => c.name).join(" / ") || "several candidates"})`
          : `"${i.input}" was not found in Qloo`,
      )
      .join("; ");
    return { ok: false, kind: "needs_input", message: which || r.summary };
  }
  if (!r.ok) return { ok: false, kind: "error", error: r.error };
  return { ok: true, window, rows: r.data.map((s) => ({ entityId: s.entityId, name: s.name, summary: summarizeTrend(s.points) })) };
}
