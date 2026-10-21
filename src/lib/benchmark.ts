// The headline result, from the held-out check in eval/SUMMARY.md (scripts/benchmark-holdout.ts, run on
// 2026-10-21): 8 restaurants in 8 cities, 5 random splits, the same model at the same effort in every arm,
// dishes scored only on restaurants the model was not shown. Kept in one place so every screen quotes
// the same numbers; update it together with eval/SUMMARY.md.
export const HELD_OUT = {
  withQloo: 1.15, // geometric-mean crowd lift with Qloo's crowd-vs-city contrast from the other half
  alone: 0.9, // the same model with no Qloo data
  ratio: 1.27, // per-restaurant ratio to the model alone (geometric mean)
  ciLow: 1.07, // 95% bootstrap interval over restaurants
  ciHigh: 1.48,
  better: 6, // restaurants where it beats the model alone
  restaurants: 8,
  url: "https://github.com/antonmareo10/tastecraft/blob/main/eval/SUMMARY.md",
} as const;

/** ×1.27 -> "+27%". */
export function gainPct(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return `${p >= 0 ? "+" : "−"}${Math.abs(p)}%`;
}
