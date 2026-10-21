// Seeded split of the crowd and city restaurant sets into two halves, for the held-out benchmark
// (scripts/benchmark-holdout.ts). Pure, so it is unit-tested (tests/holdout-split.test.ts).

import { entityId, type RawEntity } from "../src/lib/qloo";
import type { CrowdData } from "../src/lib/qloo-tasks";

/** 32-bit FNV-1a with a murmur3 finaliser: a stable, well-mixed hash of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Splits both sets by Qloo entity id, so a restaurant that is in the crowd set and in the city set
 * lands in the same half of each. Ids in `alwaysA` (places the model is shown by name) go to half A.
 */
export function splitHalves(data: CrowdData, seed: number, alwaysA: ReadonlySet<string> = new Set()): { a: CrowdData; b: CrowdData } {
  const inA = (e: RawEntity) => {
    const id = entityId(e);
    return alwaysA.has(id) || hash32(`${seed}:${id}`) % 2 === 0;
  };
  return {
    a: { crowd: data.crowd.filter(inA), city: data.city.filter(inA) },
    b: { crowd: data.crowd.filter((e) => !inA(e)), city: data.city.filter((e) => !inA(e)) },
  };
}

/** Exact two-sided sign test: probability of a split at least this uneven if wins and losses were equally likely. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/**
 * Percentile bootstrap over units (here, restaurants) of the geometric-mean ratio exp(mean(logRatios)).
 * Deterministic: a fixed-seed linear congruential generator, so the published interval is reproducible.
 */
export function bootstrapRatio(logRatios: number[], draws = 10_000, seed = 12345): { ratio: number; low: number; high: number } {
  const n = logRatios.length;
  const ratio = Math.exp(logRatios.reduce((s, x) => s + x, 0) / Math.max(1, n));
  if (!n) return { ratio: NaN, low: NaN, high: NaN };
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const means: number[] = [];
  for (let b = 0; b < draws; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += logRatios[Math.floor(next() * n)];
    means.push(Math.exp(s / n));
  }
  means.sort((x, y) => x - y);
  return { ratio, low: means[Math.floor(draws * 0.025)], high: means[Math.ceil(draws * 0.975) - 1] };
}
