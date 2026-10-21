import { describe, expect, it } from "vitest";
import { ageLabel, lensLabel, stepLabel, withLens } from "@/lib/lens";

describe("lens labels", () => {
  it("turns Qloo age buckets and genders into plain words", () => {
    expect(ageLabel("24_and_younger")).toBe("ages 24 and younger");
    expect(ageLabel("25_to_29")).toBe("ages 25 to 29");
    expect(ageLabel("55_and_older")).toBe("ages 55 and older");
    expect(ageLabel("some_new_bucket")).toBe("some new bucket");
    expect(lensLabel({ age: "35_to_44", gender: "female" })).toBe("ages 35 to 44, women");
    expect(lensLabel({ gender: "male" })).toBe("men");
    expect(lensLabel({})).toBeUndefined();
    expect(lensLabel(undefined)).toBeUndefined();
  });

  it("adds the lens to a step label", () => {
    expect(withLens("Places your guests also love nearby", { age: "24_and_younger" })).toBe("Places your guests also love nearby (ages 24 and younger)");
    expect(withLens("Brands your guests love")).toBe("Brands your guests love");
  });
});

describe("stepLabel", () => {
  it("rewrites the raw lens suffix of older recordings", () => {
    expect(stepLabel("Places your guests also love nearby (lens: 24_and_younger)")).toBe("Places your guests also love nearby (ages 24 and younger)");
    expect(stepLabel("Music your guests love (lens: 25_to_29, female)")).toBe("Music your guests love (ages 25 to 29, women)");
  });

  it("names the lens of steps whose label did not carry it, once", () => {
    expect(stepLabel("Finding taste gaps in Los Angeles", { city: "Los Angeles", lens_age: "24_and_younger" })).toBe(
      "Finding taste gaps in Los Angeles (ages 24 and younger)",
    );
    expect(stepLabel("Finding taste gaps in Los Angeles (ages 24 and younger)", { lens_age: "24_and_younger" })).toBe(
      "Finding taste gaps in Los Angeles (ages 24 and younger)",
    );
    expect(stepLabel("Finding taste gaps in Los Angeles", { city: "Los Angeles" })).toBe("Finding taste gaps in Los Angeles");
  });

  it("never leaves an underscore enum in a label", () => {
    for (const age of ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]) {
      expect(stepLabel(`Places (lens: ${age})`)).not.toMatch(/_/);
      expect(stepLabel("Dishes your audience craves", { lens_age: age })).not.toMatch(/_/);
    }
  });
});
