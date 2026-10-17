import { describe, expect, it } from "vitest";
import { EvidenceLedger, normalizeName, tasteFit } from "@/lib/ledger";
import type { MenuMove } from "@/lib/types";

describe("normalizeName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeName("Malasaña")).toBe("malasana");
    expect(normalizeName("  Joe's  Pizza! ")).toBe("joe s pizza");
    expect(normalizeName("30_to_34")).toBe("30 to 34");
  });
});

describe("EvidenceLedger", () => {
  const ledger = new EvidenceLedger();
  ledger.record("Vermouth", "taste_analysis", 95.4);
  ledger.record("Natural wine", "taste_analysis", 88);
  ledger.record("Sample Bodega", "insights", 92);
  ledger.record("Malasaña", "heatmap");

  it("verifies a name returned by Qloo with a matching score", () => {
    expect(ledger.verifyCite("vermouth", 95)).toBe(true);
    expect(ledger.verifyCite("Vermouth", 96)).toBe(true); // ±1 rounding tolerance
  });

  it("rejects a wrong score or an unknown name", () => {
    expect(ledger.verifyCite("Vermouth", 70)).toBe(false);
    expect(ledger.verifyCite("Invented Place", 90)).toBe(false);
  });

  it("accepts names without a quoted score", () => {
    expect(ledger.verifyCite("Malasana", null)).toBe(true);
  });

  it("marks each evidence item and counts them", () => {
    const res = ledger.verify([
      { text: "ok", cites: [{ name: "Vermouth", score: 95 }, { name: "Natural wine", score: 88 }] },
      { text: "one bad cite fails the item", cites: [{ name: "Vermouth", score: 95 }, { name: "Made up", score: 50 }] },
      { text: "no cites is not verified", cites: [] },
    ]);
    expect(res.items.map((i) => i.verified)).toEqual([true, false, false]);
    expect(res).toMatchObject({ checked: 3, verified: 1 });
  });

  it("returns the strongest recorded affinity, or null", () => {
    const l = new EvidenceLedger();
    l.record("Vermouth", "taste_analysis", 95.4);
    l.record("Vermouth", "insights", 90); // keep the strongest
    l.record("Malasaña", "heatmap"); // no numeric score
    expect(l.affinityOf("vermouth")).toBe(95);
    expect(l.affinityOf("Malasana")).toBeNull();
    expect(l.affinityOf("Unknown")).toBeNull();
  });
});

describe("tasteFit", () => {
  const l = new EvidenceLedger();
  l.record("Vermouth", "taste_analysis", 90);
  l.record("Natural wine", "taste_analysis", 80);
  l.record("Croquetas", "taste_analysis", 70);

  const move = (dish: string, evidence: MenuMove["evidence"]): MenuMove => ({
    dish,
    description: "",
    price: 10,
    why: "",
    ingredients: [],
    evidence,
  });

  it("averages the Qloo affinity of verified cited facts only", () => {
    const moves = [
      move("A", [
        { text: "", cites: [{ name: "Vermouth", score: 90 }], verified: true },
        { text: "", cites: [{ name: "Natural wine", score: 80 }], verified: true },
      ]),
      move("B", [
        { text: "", cites: [{ name: "Croquetas", score: 70 }], verified: true },
        { text: "", cites: [{ name: "Not checked", score: 50 }], verified: false }, // ignored
      ]),
    ];
    // (90 + 80 + 70) / 3 = 80
    expect(tasteFit(moves, l)).toEqual({ score: 80, facts: 3, moves_grounded: 2, moves_total: 2 });
  });

  it("returns undefined when no verified cite has a numeric affinity", () => {
    const l2 = new EvidenceLedger();
    l2.record("Malasaña", "heatmap"); // no numeric score
    const moves = [move("C", [{ text: "", cites: [{ name: "Malasaña" }], verified: true }])];
    expect(tasteFit(moves, l2)).toBeUndefined();
  });
});
