import { describe, expect, it } from "vitest";
import { headerTags, tagNoise } from "@/lib/place-tags";

// Invented tag lists in the shape Qloo returns (names only, as in recorded runs).
describe("tagNoise", () => {
  it("flags age buckets and other codes with digits", () => {
    expect(tagNoise("35 44")).toBe("digits");
    expect(tagNoise("25-34")).toBe("digits");
  });

  it("flags pandemic-era health notices", () => {
    for (const t of ["Staff wear masks", "Mask required", "Social distancing", "Contactless payments", "Temperature checks", "Hand sanitizer"]) {
      expect(tagNoise(t), t).toBe("health");
    }
  });

  it("flags landmarks and nearby attractions", () => {
    for (const t of ["Royal palace of madrid", "Near Central Park", "Union Station", "Art museum nearby", "Theatre district"]) {
      expect(tagNoise(t), t).toBe("landmark");
    }
  });

  it("flags logistics, payment and access", () => {
    for (const t of ["Reservations", "Wheelchair accessible seating", "Table service", "Street view", "Free Wi-Fi", "Credit cards", "Parking"]) {
      expect(tagNoise(t), t).toBe("logistics");
    }
  });

  it("keeps taste and vibe tags, matching whole words only", () => {
    for (const t of ["Authentic", "Old world tavern", "Corned beef sandwich", "Outdoor seating", "Parkside grill", "Viewpoint brunch", "Stylish", "Tourists", "Takeout", "Casual"]) {
      expect(tagNoise(t), t).toBeNull();
    }
  });
});

describe("headerTags", () => {
  it("drops noise and duplicates and keeps Qloo's order", () => {
    const tags = ["35 44", "Royal palace of madrid", "Touristic", "Couples", "Staff wear masks", "Old world tavern", "Large group"];
    expect(headerTags(tags)).toEqual(["Touristic", "Couples", "Old world tavern", "Large group"]);
  });

  it("removes repeats regardless of case, accents and spacing, keeping the first spelling", () => {
    const tags = ["Takeout", "Authentic", "Street view", "authentic ", "Beef brisket", "Café", "Cafe", "Outdoor  seating", "Outdoor seating"];
    expect(headerTags(tags)).toEqual(["Takeout", "Authentic", "Beef brisket", "Café", "Outdoor seating"]);
  });

  it("stops at max after filtering, so noise never takes a slot", () => {
    const tags = ["Reservations", "Stylish", "Wheelchair accessible seating", "Urban", "35 44", "American", "Brunch"];
    expect(headerTags(tags, 3)).toEqual(["Stylish", "Urban", "American"]);
  });

  it("handles missing and empty input", () => {
    expect(headerTags(undefined)).toEqual([]);
    expect(headerTags(["", "  ", null, undefined])).toEqual([]);
  });
});
