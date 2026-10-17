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
  ledger.record("Vermouth", "taste_analysis", 95.4, { affinity: true });
  ledger.record("Natural wine", "taste_analysis", 88, { affinity: true });
  ledger.record("Sample Bodega", "insights", 92, { affinity: true });
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

  it("affinityOf returns the strongest AFFINITY only — never popularity/trend/etc.", () => {
    const l = new EvidenceLedger();
    l.record("Vermouth", "taste_analysis", 86, { affinity: true });
    l.record("Vermouth", "insights", 95); // popularity — recorded for verification, must NOT win
    l.record("Sample Place", "insights", 60, { affinity: true });
    l.record("Sample Place", "insights", 95); // popularity
    l.record("Trendy", "trends", 73); // only a non-affinity number
    l.record("Malasaña", "heatmap"); // no numeric score
    expect(l.affinityOf("vermouth")).toBe(86); // affinity, not the higher popularity 95
    expect(l.affinityOf("Sample Place")).toBe(60); // affinity, not 95
    expect(l.affinityOf("Trendy")).toBeNull(); // no affinity-tagged number
    expect(l.affinityOf("Malasana")).toBeNull();
    expect(l.affinityOf("Unknown")).toBeNull();
  });

  it("still verifies a cite against ANY recorded number, affinity or not", () => {
    const l = new EvidenceLedger();
    l.record("Sample Place", "insights", 60, { affinity: true });
    l.record("Sample Place", "insights", 95); // popularity
    expect(l.verifyCite("Sample Place", 95)).toBe(true); // popularity is still a real Qloo number
    expect(l.verifyCite("Sample Place", 60)).toBe(true);
  });
});

describe("tasteFit", () => {
  const mk = () => {
    const l = new EvidenceLedger();
    l.record("Vermouth", "taste_analysis", 90, { affinity: true });
    l.record("Natural wine", "taste_analysis", 80, { affinity: true });
    l.record("Croquetas", "taste_analysis", 70, { affinity: true });
    return l;
  };

  const move = (dish: string, evidence: MenuMove["evidence"]): MenuMove => ({
    dish,
    description: "",
    price: 10,
    why: "",
    ingredients: [],
    evidence,
  });

  it("averages the Qloo affinity of verified cited facts only, and sets each dish's fit", () => {
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
    expect(tasteFit(moves, mk())).toEqual({ score: 80, facts: 3, moves_grounded: 2, moves_total: 2 });
    expect(moves[0].fit).toBe(85); // (90 + 80) / 2
    expect(moves[1].fit).toBe(70);
  });

  it("uses the affinity, never a higher popularity the model might quote", () => {
    const l = new EvidenceLedger();
    l.record("Popular Place", "insights", 60, { affinity: true });
    l.record("Popular Place", "insights", 95); // popularity; a model may cite 95 and it verifies
    const moves = [move("A", [{ text: "", cites: [{ name: "Popular Place", score: 95 }], verified: true }])];
    // the verified cite stands, but the fit is the AFFINITY 60, not the popularity 95
    expect(tasteFit(moves, l)).toEqual({ score: 60, facts: 1, moves_grounded: 1, moves_total: 1 });
    expect(moves[0].fit).toBe(60);
  });

  it("counts a null-score cite when its name has a recorded affinity, and shows the dish fit", () => {
    const l = new EvidenceLedger();
    l.record("Bar X", "insights", 72, { affinity: true });
    const moves = [move("A", [{ text: "", cites: [{ name: "Bar X" }], verified: true }])];
    expect(tasteFit(moves, l)).toEqual({ score: 72, facts: 1, moves_grounded: 1, moves_total: 1 });
    expect(moves[0].fit).toBe(72);
  });

  it("ignores a verified cite whose name has only non-affinity numbers; the dish fit is null", () => {
    const l = new EvidenceLedger();
    l.record("Trendy", "trends", 73); // a trend number, not an affinity
    const moves = [move("A", [{ text: "", cites: [{ name: "Trendy", score: 73 }], verified: true }])];
    expect(tasteFit(moves, l)).toBeUndefined();
    expect(moves[0].fit).toBeNull();
  });

  it("returns undefined when no verified cite has a numeric affinity", () => {
    const l2 = new EvidenceLedger();
    l2.record("Malasaña", "heatmap"); // no numeric score
    const moves = [move("C", [{ text: "", cites: [{ name: "Malasaña" }], verified: true }])];
    expect(tasteFit(moves, l2)).toBeUndefined();
    expect(moves[0].fit).toBeNull();
  });
});
