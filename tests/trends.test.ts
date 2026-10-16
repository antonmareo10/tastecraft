import { describe, expect, it } from "vitest";
import { downsample, summarizeTrend, toTrendLine, trendWindow, type TrendPointInput } from "@/lib/trends";

// Weekly points from `start`, percentile given by f(i) (0-1 like Qloo).
function weekly(n: number, f: (i: number) => number, start = "2026-04-01"): TrendPointInput[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({ date: new Date(t0 + i * 7 * 86_400_000).toISOString().slice(0, 10), populationPercentile: f(i) }));
}

describe("summarizeTrend", () => {
  it("compares the first and last ~30 days in percentile points", () => {
    // 26 weeks rising from 0.50 to 0.75: first 30 days ≈ 0.52, last 30 days ≈ 0.73.
    const s = summarizeTrend(weekly(26, (i) => 0.5 + i * 0.01));
    expect(s.direction).toBe("rising");
    expect(s.metric).toBe("percentile");
    expect(s.earlier).toBeCloseTo(52, 0);
    expect(s.recent).toBeCloseTo(73, 0);
    expect(s.change).toBe(21);
    expect(s.points[0]).toEqual({ date: "2026-04-01", value: 50 });
  });

  it("detects falling series regardless of input order", () => {
    const pts = weekly(20, (i) => 0.9 - i * 0.02).reverse(); // Qloo sorts by date descending
    const s = summarizeTrend(pts);
    expect(s.direction).toBe("falling");
    expect(s.change).toBeLessThan(-2);
    expect(s.points[0].date < s.points.at(-1)!.date).toBe(true);
  });

  it("calls small moves steady", () => {
    const s = summarizeTrend(weekly(20, (i) => 0.6 + (i % 2) * 0.01));
    expect(s.direction).toBe("steady");
    expect(Math.abs(s.change!)).toBeLessThan(2);
  });

  it("splits short windows in halves", () => {
    // Four daily points: halves [0.4, 0.45] vs [0.5, 0.55] -> +10 points.
    const pts = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((date, i) => ({ date, populationPercentile: 0.4 + i * 0.05 }));
    expect(summarizeTrend(pts)).toMatchObject({ direction: "rising", change: 10 });
  });

  it("accepts percentiles already on a 0-100 scale", () => {
    expect(summarizeTrend(weekly(12, (i) => 40 + i * 3)).change).toBeGreaterThan(20);
  });

  it("falls back to rank, where a smaller rank is better", () => {
    const t0 = Date.parse("2026-04-01T00:00:00Z");
    const pts = Array.from({ length: 20 }, (_, i) => ({ date: new Date(t0 + i * 7 * 86_400_000).toISOString().slice(0, 10), populationRank: 1000 - i * 20 }));
    const s = summarizeTrend(pts);
    expect(s.metric).toBe("rank");
    expect(s.direction).toBe("rising");
    expect(s.change).toBeGreaterThan(0);
  });

  it("reports no trend data for empty, undated or single-point series", () => {
    expect(summarizeTrend([])).toMatchObject({ direction: "no_data", change: null, metric: null });
    expect(summarizeTrend([{ date: "2026-10-01", populationPercentile: 0.5 }])).toMatchObject({ direction: "no_data", change: null });
    expect(summarizeTrend([{ date: "not a date", populationPercentile: 0.5 }, { date: "", populationPercentile: 0.6 }]).direction).toBe("no_data");
    expect(summarizeTrend([{ date: "2026-10-01" }, { date: "2026-10-08" }]).direction).toBe("no_data");
  });
});

describe("downsample / trendWindow / toTrendLine", () => {
  it("keeps at most 26 points, including the first and the last", () => {
    const pts = Array.from({ length: 100 }, (_, i) => i);
    const d = downsample(pts, 26);
    expect(d).toHaveLength(26);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(99);
    expect(downsample([1, 2, 3], 26)).toEqual([1, 2, 3]);
  });

  it("builds a real-date window ending today (UTC)", () => {
    expect(trendWindow(180, new Date("2026-10-16T22:30:00Z"))).toEqual({ start: "2026-04-19", end: "2026-10-16" });
    expect(trendWindow(30, new Date("2026-03-01T00:00:00Z"))).toEqual({ start: "2026-01-30", end: "2026-03-01" });
  });

  it("maps a summary to the UI line with downsampled points", () => {
    const sum = summarizeTrend(weekly(52, (i) => 0.3 + i * 0.005));
    const line = toTrendLine({ entityId: "E1", name: "Bar X" }, sum);
    expect(line).toMatchObject({ entity_id: "E1", name: "Bar X", direction: "rising", metric: "percentile" });
    expect(line.points.length).toBeLessThanOrEqual(26);
  });
});
