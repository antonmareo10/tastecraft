import { describe, expect, it } from "vitest";
import {
  dishHead,
  dishTerms,
  foodTokens,
  indexMenus,
  parseBaselineDishes,
  planLift,
  rankTerms,
  smoothedLift,
  stem,
  type MenuPlace,
} from "@/lib/lift";

const place = (name: string, ...menu: string[]): MenuPlace => ({ name, menu });

describe("tokens", () => {
  it("folds accents and case, drops stopwords and folds plurals", () => {
    expect(foodTokens("Croquetas de Jamón Ibérico").map((t) => t.key)).toEqual(["croqueta", "jamon", "iberico"]);
    expect(foodTokens("Pastrami on Rye").map((t) => t.key)).toEqual(["pastrami", "rye"]);
    expect(stem("sandwiches")).toBe("sandwich");
    expect(stem("tacos")).toBe("taco");
    expect(stem("bass")).toBe("bass");
  });

  it("keeps positions so labels come from the original text", () => {
    const [t] = foodTokens("Pulpo a la Brasa");
    expect(t).toMatchObject({ key: "pulpo", start: 0, end: 5 });
  });

  it("cuts a dish name to its core before garnish and descriptions", () => {
    expect(dishHead("Pulpo a la Brasa con Pimentón de la Vera")).toBe("Pulpo a la Brasa");
    expect(dishHead("Espresso Tiramisu with Rye Crumble")).toBe("Espresso Tiramisu");
    expect(dishHead("Croqueta de Temporada: Trufa y Jamón")).toBe("Croqueta de Temporada");
    expect(dishHead("Wood-Fired Pizza — Smoked Mozzarella")).toBe("Wood-Fired Pizza");
    expect(dishHead("Mac and Cheese")).toBe("Mac and Cheese"); // "and" is not a cut
  });
});

describe("dishTerms", () => {
  const vocab = indexMenus([
    place("A", "Matzo Ball Soup", "Dumplings", "Fried chicken"),
    place("B", "Hot pastrami", "Black and white cookie"),
  ]);

  it("prefers the longest term local menus use, then fills in the rest", () => {
    expect(dishTerms("Matzo Ball Soup Dumplings", vocab).map((t) => t.label)).toEqual(["Matzo Ball Soup", "Dumplings"]);
  });

  it("matches a word that appears inside longer menu tags", () => {
    expect(dishTerms("Pastrami Melt", vocab).map((t) => t.key)).toEqual(["pastrami"]);
  });

  it("never uses a preparation or format word on its own, but keeps it inside a dish", () => {
    expect(dishTerms("Fried Platter", vocab)).toEqual([]);
    expect(dishTerms("Fried Chicken Sandwich", vocab).map((t) => t.key)).toEqual(["fried chicken"]);
  });

  it("ignores season and temperature words, so a seasonal label does not dilute a dish", () => {
    const v = indexMenus([place("A", "Cocido madrileño", "Spring rolls", "Otoño menu")]);
    expect(dishTerms("Cocido madrileño de otoño", v).map((t) => t.key)).toEqual(["cocido madrileno"]);
    expect(dishTerms("Vegetable spring rolls", v).map((t) => t.key)).toEqual(["spring roll"]);
  });

  it("only looks at the core of the dish name", () => {
    expect(dishTerms("Dumplings with Hot Pastrami", vocab).map((t) => t.key)).toEqual(["dumpling"]);
  });
});

describe("smoothedLift", () => {
  it("is the add-one smoothed ratio of shares", () => {
    expect(smoothedLift(3, 4, 1, 4)).toBeCloseTo(2); // (4/6) / (2/6)
    expect(smoothedLift(0, 100, 0, 100)).toBe(1); // seen nowhere = no difference
    expect(smoothedLift(5, 0, 1, 10)).toBe(1); // no data = no claim
  });
});

describe("planLift", () => {
  const sets = {
    crowd: [place("C1", "Hot pastrami"), place("C2", "Pastrami sandwich", "Fries"), place("C3", "Pastrami"), place("C4", "Fries")],
    city: [place("T1", "Pastrami"), place("T2", "Fries"), place("T3", "Fries"), place("T4", "Fries", "Avocado toast")],
  };

  it("scores each dish from its food terms and the plan over matched dishes only", () => {
    const r = planLift(["Pastrami Melt", "Loaded Fries", "Kale Smoothie"], sets);
    expect(r.dishes[0]).toMatchObject({ lift: 2, terms: [{ term: "Pastrami", crowd: 3, city: 1, lift: 2 }] });
    // fries: crowd 2/4, city 3/4 -> (3/6)/(4/6) = 0.75
    expect(r.dishes[1].lift).toBe(0.75);
    expect(r.dishes[2]).toMatchObject({ lift: null, terms: [] });
    expect(r.matched).toBe(2);
    expect(r.total).toBe(3);
    expect(r.lift).toBeCloseTo(Math.sqrt(2 * 0.75), 2); // geometric mean
    expect(r.crowd_n).toBe(4);
    expect(r.city_n).toBe(4);
  });

  it("uses the geometric mean of a dish's terms", () => {
    const r = planLift(["Pastrami Fries"], sets);
    expect(r.dishes[0].terms.map((t) => t.lift)).toEqual([2, 0.75]);
    expect(r.dishes[0].lift).toBeCloseTo(Math.sqrt(1.5), 2);
  });

  it("returns no score when nothing matches", () => {
    expect(planLift(["Kale Smoothie"], sets).lift).toBeNull();
  });
});

describe("rankTerms", () => {
  const crowd = Array.from({ length: 10 }, (_, i) =>
    place(`C${i}`, ...(i < 6 ? ["Mozzarella sticks"] : []), ...(i < 5 ? ["Cocido madrileño"] : []), ...(i < 1 ? ["Burger"] : [])),
  );
  const city = Array.from({ length: 10 }, (_, i) => place(`T${i}`, ...(i < 1 ? ["Mozzarella sticks"] : []), ...(i < 8 ? ["Burger"] : [])));

  it("lists what the crowd favours and avoids, dropping words that only repeat a longer term", () => {
    const { over, under } = rankTerms({ crowd, city }, { own: ["Cocido madrileño"] });
    expect(over.map((t) => t.term)).toEqual(["Cocido madrileño", "Mozzarella sticks"]);
    expect(over[0]).toMatchObject({ crowd: 5, city: 0, on_your_menu: true });
    expect(over[1].on_your_menu).toBe(false);
    expect(under.map((t) => t.term)).toEqual(["Burger"]);
  });
});

describe("parseBaselineDishes", () => {
  it("reads the fixed baseline format and tolerates markdown", () => {
    const text = "Dish 1: Pastrami Melt | hearty\n**Dish 2:** Matzo Ball Soup — classic\n- Dish 3: Bagel Platter - light\nEvent: Comedy night";
    expect(parseBaselineDishes(text)).toEqual(["Pastrami Melt", "Matzo Ball Soup", "Bagel Platter"]);
  });

  it("returns nothing for free text", () => {
    expect(parseBaselineDishes("Add a pastrami melt and a soup.")).toEqual([]);
  });
});
