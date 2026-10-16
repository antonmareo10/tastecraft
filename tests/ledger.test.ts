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
});
