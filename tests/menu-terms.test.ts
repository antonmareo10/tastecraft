import { describe, expect, it } from "vitest";
import { rankTerms, type MenuPlace } from "@/lib/lift";
import { displayMenuTerms, favoursSummary, isMenuFragment } from "@/lib/menu-terms";

// Synthetic terms and counts (no recorded Qloo data).
const t = (term: string, crowd = 4, city = 0, lift = 3.1) => ({ term, crowd, city, lift });

describe("isMenuFragment", () => {
  it("drops pieces cut from longer dish names", () => {
    expect(isMenuFragment("Spicy salmon crispy")).toBe(true); // "Spicy salmon crispy rice", cut at three words
    expect(isMenuFragment("country cured")).toBe(true); // "Country cured ham"
    expect(isMenuFragment("Triple triple")).toBe(true);
    expect(isMenuFragment("style tacos")).toBe(true); // "Baja style tacos"
    expect(isMenuFragment("Signature bakes")).toBe(true);
    expect(isMenuFragment("gem")).toBe(true); // "Little gem salad"
    expect(isMenuFragment("Grandma")).toBe(true); // "Grandma pie"
    expect(isMenuFragment("brews")).toBe(true);
    expect(isMenuFragment("")).toBe(true);
  });

  it("keeps dishes and foods, including format nouns and post-noun adjectives", () => {
    for (const term of ["Poke bowl", "Cold brew", "Spicy salmon", "Fish tacos", "carbonara", "Patatas fritas", "Sopa de ajo", "Cheese board", "Grilled octopus", "Ox", "dog", "Beef carpaccio"]) {
      expect(isMenuFragment(term), term).toBe(false);
    }
  });
});

describe("displayMenuTerms", () => {
  it("folds a word into a longer term that is shown, but not into a dropped fragment", () => {
    const list = [t("Poke bowl", 9), t("sole", 6), t("pumpkin", 12, 3), t("Spicy salmon crispy"), t("salmon", 7, 1), t("Dover sole"), t("pumpkin soup", 10, 3)];
    expect(displayMenuTerms(list).map((x) => x.term)).toEqual(["Poke bowl", "salmon", "Dover sole", "pumpkin soup"]);
  });

  it("matches folded plurals and keeps the original order", () => {
    const list = [t("onion", 9, 1), t("Onion rings", 7), t("pepper pizza", 5), t("Sweet pepper pizza"), t("matcha")];
    expect(displayMenuTerms(list).map((x) => x.term)).toEqual(["Onion rings", "Sweet pepper pizza", "matcha"]);
  });

  it("never hides a term behind a longer term outside the visible rows (the squash case)", () => {
    // "pumpkin" is strong evidence (14 vs 2); "pumpkin flowers" exists but ranks below the six rows shown.
    const list = [t("Poke bowl", 8), t("sole", 5), t("pumpkin", 14, 2), t("carbonara"), t("burrata salad"), t("Dover sole"), t("Cold brew"), t("coffee", 8, 1), t("pumpkin flowers", 11, 2)];
    const shown = displayMenuTerms(list, 6).map((x) => x.term);
    expect(shown).toContain("pumpkin");
    expect(shown).not.toContain("pumpkin flowers");
    // "sole" (5) folds into "Dover sole" (4, at least half), both visible; its row goes to the next term.
    expect(shown).toEqual(["Poke bowl", "pumpkin", "carbonara", "burrata salad", "Dover sole", "Cold brew"]);
  });

  it("never hides a strong generic term behind a weak specific one", () => {
    const list = [t("pumpkin", 14, 2), t("pumpkin soup", 3, 0), t("sole", 5), t("Dover sole", 4)];
    expect(displayMenuTerms(list, 6).map((x) => x.term)).toEqual(["pumpkin", "pumpkin soup", "Dover sole"]);
  });

  it("weighs the city count for terms the crowd avoids", () => {
    const avoids = [t("burger", 1, 27, 0.1), t("double burger", 0, 6, 0.2), t("milkshakes", 0, 8, 0.1), t("smash burger", 0, 20, 0.1)];
    // "burger" (27 city menus) folds into "smash burger" (20, at least half) but not into "double burger" alone.
    expect(displayMenuTerms(avoids, 4, (x) => x.city).map((x) => x.term)).toEqual(["double burger", "milkshakes", "smash burger"]);
  });

  it("returns the original rows, so counts and lifts are exactly the ones lift.ts computed", () => {
    const sets: { crowd: MenuPlace[]; city: MenuPlace[] } = {
      crowd: [
        ...Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, menu: ["Dover sole", "Poke bowl"] })),
        ...Array.from({ length: 4 }, (_, i) => ({ name: `d${i}`, menu: ["Spicy salmon crispy rice"] })),
      ],
      city: Array.from({ length: 9 }, (_, i) => ({ name: `k${i}`, menu: ["Burger"] })),
    };
    const { over } = rankTerms(sets);
    const before = JSON.stringify(over);
    const shown = displayMenuTerms(over);
    expect(JSON.stringify(over)).toBe(before); // the ranked list itself is not modified
    for (const row of shown) expect(over).toContain(row); // same objects, same counts and lifts
    const terms = shown.map((x) => x.term);
    expect(over.map((x) => x.term)).toContain("Spicy salmon crispy"); // lift.ts still ranks it
    expect(terms).not.toContain("Spicy salmon crispy"); // but it is not shown
    expect(terms).toEqual(expect.arrayContaining(["Dover sole", "Poke bowl", "salmon crispy rice"]));
  });
});

describe("favoursSummary", () => {
  it("rebuilds the log line from the top three shown terms of the full list", () => {
    const favours = [t("Poke bowl", 9, 0, 7.12), t("brews", 6, 0, 5.24), t("sole", 6, 0, 5.24), t("carbonara"), t("Dover sole")];
    // "brews" is dropped; "sole" stays because "Dover sole" is not among the three shown.
    expect(favoursSummary("Your crowd favours: Poke bowl ×7.1, brews ×5.2, sole ×5.2", favours)).toBe(
      "Your crowd favours: Poke bowl ×7.1, sole ×5.2, carbonara ×3.1",
    );
  });

  it("filters the line's own items when there is no list (lensed calls)", () => {
    expect(favoursSummary("Your crowd favours: Matcha ×6.1, brew ×6.1, oat milk ×4.4")).toBe("Your crowd favours: Matcha ×6.1, oat milk ×4.4");
  });

  it("leaves other summaries alone", () => {
    expect(favoursSummary("Top gaps: Wine bar, Coffee shop")).toBe("Top gaps: Wine bar, Coffee shop");
    expect(favoursSummary("No clear gaps")).toBe("No clear gaps");
  });
});
