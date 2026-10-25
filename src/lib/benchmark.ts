// The headline result, from the pre-registered held-out check in eval/HELDOUT_30.md
// (scripts/benchmark-holdout.ts --eval30, run on 2026-10-25). The 22 new restaurants, the metrics and the
// decision rule were committed before the run (eval/PREREGISTRATION_30.md), and by that rule the headline
// is the lower of two ratios, the 22 new restaurants' (this one) or all 30's. 5 random splits, the same
// model at the same effort in every arm, dishes scored only on restaurants the model was not shown.
// Kept in one place so every screen quotes the same numbers; update it together with eval/HELDOUT_30.md.
export const HELD_OUT = {
  withQloo: 1.2174, // geometric-mean crowd lift with Qloo's crowd-vs-city contrast from the other half
  alone: 1.1088, // the same model with no Qloo data
  ratio: 1.0979, // per-restaurant ratio to the model alone (geometric mean)
  ciLow: 0.9559, // 95% bootstrap interval over restaurants
  ciHigh: 1.2668,
  better: 13, // restaurants where it beats the model alone
  restaurants: 22,
  // The same contrast against Qloo's affinity data alone (a secondary, pre-registered metric).
  vsAffinity: { ratio: 1.2866, ciLow: 1.1649, ciHigh: 1.4411, better: 19 },
  url: "https://github.com/antonmareo10/tastecraft/blob/main/eval/HELDOUT_30.md",
} as const;

/** The pre-registered decision: shown only when the whole 95% interval is above ×1. */
export const HELD_OUT_SHOWN = HELD_OUT.ciLow > 1;

/** ×1.27 -> "+27%". */
export function gainPct(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return `${p >= 0 ? "+" : "−"}${Math.abs(p)}%`;
}

/** "95% CI −4% to +27%". */
export function gainCi(r: { ciLow: number; ciHigh: number }): string {
  return `95% CI ${gainPct(r.ciLow)} to ${gainPct(r.ciHigh)}`;
}
