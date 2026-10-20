import { describe, expect, it } from "vitest";
import { EvidenceLedger, normalizeName } from "@/lib/ledger";

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
