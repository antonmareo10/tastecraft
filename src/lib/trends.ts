// Pure helpers for Qloo /v2/trending series (fetched through the official qloo-harness `trends` workflow).
// Qloo returns popularity rows per date; we turn each series into a plain verdict an owner can read:
// rising, falling or steady, with the change in percentile points between the start and the end of the window.

import type { TrendDirection, TrendLine } from "./types";

/** One /v2/trending row as mapped by src/lib/qloo-harness.ts (fields are optional: shapes vary). */
export type TrendPointInput = {
  date: string;
  populationPercentile?: number;
  populationRank?: number;
  populationRankVelocity?: number;
  velocityFoldChange?: number;
  populationPercentDelta?: number;
};

export type TrendSummary = {
  direction: TrendDirection;
  /** Rounded change between the early and the recent part of the window: percentile points (metric
   *  "percentile") or rank positions gained (metric "rank"). Null when there is no usable data. */
  change: number | null;
  metric: "percentile" | "rank" | null;
  /** Mean value over the early and the recent part of the window (same unit as `change`). */
  earlier: number | null;
  recent: number | null;
  /** The series in ascending date order, in the chosen metric (percentile 0-100 or rank). */
  points: { date: string; value: number }[];
};

const DAY_MS = 86_400_000;
/** Size of the "first" and "last" slices of the window that are compared. */
export const TREND_SLICE_DAYS = 30;
/** Below this many percentile points (or 5% of the rank) the series counts as steady. */
export const STEADY_POINTS = 2;
const STEADY_RANK_SHARE = 0.05;

const time = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Picks the metric (popularity percentile first, rank as a fallback) and returns the series in ascending date order. */
function series(points: TrendPointInput[]): { metric: TrendSummary["metric"]; values: { date: string; t: number; value: number }[] } {
  const dated = points.filter((p) => typeof p.date === "string" && Number.isFinite(time(p.date)));
  const pct = dated.filter((p) => typeof p.populationPercentile === "number" && Number.isFinite(p.populationPercentile));
  if (pct.length > 0) {
    // Qloo documents percentiles as 0-1; accept 0-100 too.
    const scale = pct.every((p) => (p.populationPercentile as number) <= 1) ? 100 : 1;
    return {
      metric: "percentile",
      values: pct.map((p) => ({ date: p.date.slice(0, 10), t: time(p.date), value: (p.populationPercentile as number) * scale })).sort((a, b) => a.t - b.t),
    };
  }
  const rank = dated.filter((p) => typeof p.populationRank === "number" && Number.isFinite(p.populationRank));
  if (rank.length > 0) {
    return { metric: "rank", values: rank.map((p) => ({ date: p.date.slice(0, 10), t: time(p.date), value: p.populationRank as number })).sort((a, b) => a.t - b.t) };
  }
  return { metric: null, values: [] };
}

/**
 * Compares the mean over the first ~30 days of the returned window with the mean over the last ~30 days.
 * When the returned window is shorter than two slices, it compares the first and second half instead.
 * Fewer than two dated points means "no trend data".
 */
export function summarizeTrend(points: TrendPointInput[]): TrendSummary {
  const { metric, values } = series(points);
  const out = values.map(({ date, value }) => ({ date, value: Number(value.toFixed(2)) }));
  if (!metric || values.length < 2) {
    return { direction: "no_data", change: null, metric, earlier: null, recent: null, points: out };
  }
  const first = values[0].t;
  const last = values[values.length - 1].t;
  let early: number[];
  let late: number[];
  if (last - first >= 2 * TREND_SLICE_DAYS * DAY_MS) {
    early = values.filter((v) => v.t <= first + TREND_SLICE_DAYS * DAY_MS).map((v) => v.value);
    late = values.filter((v) => v.t >= last - TREND_SLICE_DAYS * DAY_MS).map((v) => v.value);
  } else {
    const half = Math.floor(values.length / 2);
    early = values.slice(0, half).map((v) => v.value);
    late = values.slice(values.length - half).map((v) => v.value);
  }
  const earlier = mean(early);
  const recent = mean(late);
  // For ranks a smaller number is better, so climbing means the rank went down.
  const delta = metric === "rank" ? earlier - recent : recent - earlier;
  const threshold = metric === "rank" ? Math.max(1, Math.abs(earlier) * STEADY_RANK_SHARE) : STEADY_POINTS;
  const direction: TrendDirection = Math.abs(delta) < threshold ? "steady" : delta > 0 ? "rising" : "falling";
  return {
    direction,
    change: Math.round(delta),
    metric,
    earlier: Number(earlier.toFixed(1)),
    recent: Number(recent.toFixed(1)),
    points: out,
  };
}

/** Evenly thins a series to at most `max` points, always keeping the first and the last. */
export function downsample<T>(points: T[], max = 26): T[] {
  if (points.length <= max) return points;
  if (max <= 1) return points.slice(-1);
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Inclusive YYYY-MM-DD window ending today (UTC), always real calendar dates. */
export function trendWindow(days: number, now: Date = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - Math.max(1, Math.round(days)) * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** The UI/event shape for one entity. */
export function toTrendLine(entity: { entityId: string; name: string }, summary: TrendSummary, maxPoints = 26): TrendLine {
  return {
    entity_id: entity.entityId,
    name: entity.name,
    direction: summary.direction,
    change: summary.change,
    ...(summary.metric ? { metric: summary.metric } : {}),
    points: downsample(summary.points, maxPoints),
  };
}
