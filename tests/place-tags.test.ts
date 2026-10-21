import { describe, expect, it } from "vitest";
import { headerTags, tagNoise } from "@/lib/place-tags";

// Invented tag lists in the shape Qloo returns (names only, as in recorded runs). No recorded Qloo data.
describe("tagNoise", () => {
  it("flags age buckets and other codes with digits", () => {
    expect(tagNoise("18 24")).toBe("digits");
    expect(tagNoise("25-34")).toBe("digits");
  });

  it("flags pandemic-era health notices", () => {
    for (const t of ["Masks for staff", "Mask required", "Social distancing", "Contactless payments", "Temperature checks", "Hand sanitizer"]) {
      expect(tagNoise(t), t).toBe("health");
    }
  });

  it("flags landmarks and nearby attractions", () => {
    for (const t of ["Next to the royal palace", "Near Central Park", "Union Station", "Art museum nearby", "Theatre district"]) {
      expect(tagNoise(t), t).toBe("landmark");
    }
  });

  it("flags logistics, payment and access", () => {
    for (const t of ["Takes reservations", "Wheelchair-friendly entrance", "Table service", "Harbour view", "Free Wi-Fi", "Credit cards", "Parking"]) {
      expect(tagNoise(t), t).toBe("logistics");
    }
  });

  it("keeps taste and vibe tags, matching whole words only", () => {
    for (const t of ["Rustic", "Old harbour inn", "Smoked trout plate", "Patio seating", "Parkside grill", "Viewpoint brunch", "Trendy", "Locals", "Counter pickup", "Laid back"]) {
      expect(tagNoise(t), t).toBeNull();
    }
  });
});

describe("headerTags", () => {
  it("drops noise and duplicates and keeps Qloo's order", () => {
    const tags = ["18 24", "Near the old cathedral", "Romantic", "Late night", "Masks required", "Wood-fired", "Big groups"];
    expect(headerTags(tags)).toEqual(["Romantic", "Late night", "Wood-fired", "Big groups"]);
  });

  it("removes repeats regardless of case, accents and spacing, keeping the first spelling", () => {
    const tags = ["Delivery", "Cozy", "Garden view", "cozy ", "Lamb shank", "Café", "Cafe", "Family  style", "Family style"];
    expect(headerTags(tags)).toEqual(["Delivery", "Cozy", "Lamb shank", "Café", "Family style"]);
  });

  it("stops at max after filtering, so noise never takes a slot", () => {
    const tags = ["Takes reservations", "Lively", "Wheelchair-friendly entrance", "Hip", "25 34", "Thai", "Brunch"];
    expect(headerTags(tags, 3)).toEqual(["Lively", "Hip", "Thai"]);
  });

  it("handles missing and empty input", () => {
    expect(headerTags(undefined)).toEqual([]);
    expect(headerTags(["", "  ", null, undefined])).toEqual([]);
  });
});
