import { describe, expect, it } from "vitest";
import { byContrast, flipOf, keyTerm, type QlooFlip } from "@/lib/flip";
import type { AgentEvent, Playbook } from "@/lib/types";

// Synthetic run: restaurant, dishes, counts and lifts are invented; only the plumbing matters.
const t = (term: string, crowd: number, city: number, lift: number) => ({ term, crowd, city, lift });

const playbook = (over: Partial<Playbook> = {}): AgentEvent =>
  ({
    type: "playbook",
    playbook: {
      headline: "Guests here also love late-night noodle bars.",
      menu_moves: [
        { dish: "Smoked Noodle Bowl", lift: 2.4, lift_terms: [t("Smoked", 6, 2, 1.9), t("Noodle", 12, 3, 3.0)] },
        { dish: "Pickled Plum Soda", lift: 1.6, lift_terms: [t("Pickled Plum", 2, 0, 2.9)] },
        { dish: "House Bread", lift: null, lift_terms: [] },
      ],
      crowd_lift: {
        score: 2.1,
        matched: 2,
        total: 3,
        crowd_n: 120,
        city_n: 110,
        city: "Springfield",
        baseline: {
          score: 0.8,
          matched: 2,
          total: 3,
          dishes: [
            { dish: "Fusion Taco Pizza", lift: 0.7, terms: [t("Taco", 3, 6, 0.6), t("Pizza", 10, 11, 0.9)] },
            { dish: "Truffle Fries", lift: 0.9, terms: [t("Truffle Fries", 4, 4, 0.9)] },
            { dish: "Mystery Dessert", lift: null, terms: [] },
          ],
        },
      },
      ...over,
    } as unknown as Playbook,
  }) as AgentEvent;

const run = (events: AgentEvent[]) => ({
  slug: "noodle-house-springfield",
  restaurant: "Noodle House",
  city: "Springfield",
  goal: "Fill quiet weeknights",
  recordedAt: "2026-10-20T10:00:00.000Z",
  events,
});

describe("keyTerm", () => {
  it("explains a favoured dish by its strongest term and an unfavoured one by its weakest", () => {
    const terms = [t("Smoked", 6, 2, 1.9), t("Noodle", 12, 3, 3.0)];
    expect(keyTerm(terms, 2.4)?.term).toBe("Noodle");
    expect(keyTerm([t("Taco", 3, 6, 0.6), t("Pizza", 10, 11, 0.9)], 0.7)?.term).toBe("Taco");
  });

  it("has nothing to show for an unscored dish", () => {
    expect(keyTerm([], 1.2)).toBeNull();
    expect(keyTerm([t("Noodle", 12, 3, 3.0)], null)).toBeNull();
  });
});

describe("flipOf", () => {
  it("sets the no-Qloo dishes against the agent's, with the run's own crowd lifts", () => {
    const f = flipOf(run([{ type: "note", text: "start" }, playbook()])) as QlooFlip;
    expect(f.without.score).toBe(0.8);
    expect(f.with.score).toBe(2.1);
    expect(f.without.dishes.map((d) => d.dish)).toEqual(["Fusion Taco Pizza", "Truffle Fries", "Mystery Dessert"]);
    expect(f.with.dishes.map((d) => d.dish)).toEqual(["Smoked Noodle Bowl", "Pickled Plum Soda", "House Bread"]);
    expect([f.crowd_n, f.city_n]).toEqual([120, 110]);
    expect(f.headline).toBe("Guests here also love late-night noodle bars.");
  });

  it("marks low-count dishes and keeps unmatched ones without a term", () => {
    const f = flipOf(run([playbook()])) as QlooFlip;
    expect(f.with.dishes[1]).toMatchObject({ low: true, term: { term: "Pickled Plum" } }); // 2 + 0 menus
    expect(f.with.dishes[0].low).toBe(false);
    expect(f.with.dishes[2]).toMatchObject({ lift: null, low: false, term: null });
    expect(f.without.dishes[1]).toMatchObject({ low: false, term: { term: "Truffle Fries" } });
  });

  it("returns null when there is nothing fair to compare", () => {
    expect(flipOf(run([{ type: "note", text: "no playbook" }]))).toBeNull();
    expect(flipOf(run([playbook({ crowd_lift: undefined })]))).toBeNull();
    const noBaseline = playbook();
    delete (noBaseline as Extract<AgentEvent, { type: "playbook" }>).playbook.crowd_lift!.baseline;
    expect(flipOf(run([noBaseline]))).toBeNull();
  });
});

describe("byContrast", () => {
  it("puts the run whose two answers differ most first", () => {
    const f = flipOf(run([playbook()])) as QlooFlip;
    const mild = { ...f, slug: "mild", with: { ...f.with, score: 1.2 }, without: { ...f.without, score: 1.0 } };
    const sharp = { ...f, slug: "sharp", with: { ...f.with, score: 3.0 }, without: { ...f.without, score: 0.75 } };
    expect([mild, sharp].sort(byContrast).map((x) => x.slug)).toEqual(["sharp", "mild"]);
  });
});

describe("no-Qloo reasons", () => {
  it("keeps the reason the model gave for each no-Qloo dish, verbatim", () => {
    const baseline: AgentEvent = {
      type: "baseline",
      text: "Dish 1: Fusion Taco Pizza | Shareable - and built for photos.\nDish 2: Truffle Fries — Comfort food for groups.\nDish 3: Mystery Dessert\nEvent: Trivia night.",
    };
    const f = flipOf(run([baseline, playbook()])) as QlooFlip;
    expect(f.without.dishes.map((d) => d.why)).toEqual(["Shareable - and built for photos.", "Comfort food for groups.", undefined]);
    expect(f.with.dishes.every((d) => d.why === undefined)).toBe(true);
  });
});
