import { describe, expect, it } from "vitest";
import type { RawEntity } from "@/lib/qloo";
import { bootstrapRatio, hash32, signTest, splitHalves, verdict } from "../scripts/holdout-split";

const places = (prefix: string, n: number): RawEntity[] => Array.from({ length: n }, (_, i) => ({ entity_id: `${prefix}${i}`, name: `${prefix}${i}` }));

describe("splitHalves (held-out benchmark)", () => {
  const shared = places("S", 40); // restaurants in both the crowd and the city set
  const data = { crowd: [...shared, ...places("C", 110)], city: [...shared, ...places("T", 110)] };

  it("is deterministic for a seed and changes with the seed", () => {
    const one = splitHalves(data, 1);
    expect(splitHalves(data, 1)).toEqual(one);
    expect(splitHalves(data, 2).a.crowd.map((e) => e.entity_id)).not.toEqual(one.a.crowd.map((e) => e.entity_id));
  });

  it("puts every place in exactly one half, and a shared place in the same half of both sets", () => {
    const { a, b } = splitHalves(data, 3);
    expect(a.crowd.length + b.crowd.length).toBe(150);
    expect(a.city.length + b.city.length).toBe(150);
    const inA = new Set([...a.crowd, ...a.city].map((e) => e.entity_id));
    for (const e of [...b.crowd, ...b.city]) expect(inA.has(e.entity_id)).toBe(false);
  });

  it("splits roughly in half and always keeps the places shown to the model in half A", () => {
    const shown = new Set(["C1", "C2", "S3"]);
    const { a, b } = splitHalves(data, 4, shown);
    expect(a.crowd.length).toBeGreaterThan(50);
    expect(b.crowd.length).toBeGreaterThan(50);
    for (const id of shown) expect(b.crowd.some((e) => e.entity_id === id) || b.city.some((e) => e.entity_id === id)).toBe(false);
  });

  it("hashes to unsigned 32-bit integers", () => {
    expect(hash32("1:abc")).toBe(hash32("1:abc"));
    expect(hash32("1:abc")).toBeGreaterThanOrEqual(0);
    expect(hash32("1:abc")).toBeLessThan(2 ** 32);
  });
});

describe("signTest and bootstrapRatio", () => {
  it("gives exact two-sided sign-test p-values", () => {
    expect(signTest(8, 0)).toBeCloseTo(2 / 256, 6);
    expect(signTest(6, 2)).toBeCloseTo(74 / 256, 6);
    expect(signTest(4, 4)).toBe(1);
    expect(signTest(0, 0)).toBe(1);
  });

  it("brackets the geometric-mean ratio and is reproducible", () => {
    const logs = [0.1, 0.3, -0.05, 0.2, 0.25, 0.15, 0.4, -0.1].map((x) => x);
    const r = bootstrapRatio(logs);
    expect(r.ratio).toBeCloseTo(Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length), 10);
    expect(r.low).toBeLessThan(r.ratio);
    expect(r.high).toBeGreaterThan(r.ratio);
    expect(bootstrapRatio(logs)).toEqual(r);
  });
});

describe("verdict (pre-registered decision rule)", () => {
  it("confirms only when the whole interval is above x1", () => {
    expect(verdict({ low: 1.02, high: 1.4 })).toBe("confirmed");
    expect(verdict({ low: 1, high: 1.4 })).toBe("not shown");
    expect(verdict({ low: 0.9, high: 1.3 })).toBe("not shown");
    expect(verdict({ low: 0.7, high: 0.95 })).toBe("reversed");
    expect(verdict({ low: NaN, high: NaN })).toBe("not shown");
  });
});
