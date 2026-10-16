import { describe, expect, it } from "vitest";
import { resolveRestaurant, type RestaurantMatch } from "@/lib/qloo-tasks";

const place = (entity_id: string, name: string, subtitle?: string): RestaurantMatch => ({
  entity_id,
  name,
  subtitle,
  all_tags: [],
});

describe("resolveRestaurant", () => {
  it("reports not_found when Qloo returns nothing", () => {
    const { selected, resolution } = resolveRestaurant("Nowhere", "Madrid", []);
    expect(selected).toBeNull();
    expect(resolution.status).toBe("not_found");
  });

  it("resolves a single exact name in the right city", () => {
    const { selected, resolution } = resolveRestaurant("Casa Lucio", "Madrid", [
      place("B", "Lucio's Grill", "Main St, Austin"),
      place("A", "Casa Lucio", "Calle Cava Baja 35, Madrid"),
    ]);
    expect(selected?.entity_id).toBe("A");
    expect(resolution).toMatchObject({ status: "resolved", match: "exact" });
    expect(resolution.alternatives.map((a) => a.entity_id)).toEqual(["B"]);
  });

  it("ignores accents, case and apostrophes when comparing names", () => {
    const { resolution } = resolveRestaurant("katz's delicatessen", "New York", [
      place("K", "Katz’s Delicatessen", "205 E Houston St, New York, NY"),
    ]);
    expect(resolution.match).toBe("exact");
  });

  it("flags two branches with the same name as ambiguous", () => {
    const { resolution } = resolveRestaurant("Joe's Pizza", "New York", [
      place("J1", "Joe's Pizza", "7 Carmine St, New York, NY"),
      place("J2", "Joe's Pizza", "1435 Broadway, New York, NY"),
    ]);
    expect(resolution.status).toBe("ambiguous");
    expect(resolution.alternatives).toHaveLength(1);
  });

  it("prefers the candidate in the requested city", () => {
    const { selected } = resolveRestaurant("Dishoom", "London", [
      place("E", "Dishoom", "Edinburgh"),
      place("L", "Dishoom", "Shoreditch, London"),
    ]);
    expect(selected?.entity_id).toBe("L");
  });

  it("treats a partial name as a close, ambiguous match", () => {
    const { resolution } = resolveRestaurant("Gjelina", "Los Angeles", [
      place("G", "Gjelina Take Away", "Abbot Kinney Blvd, Los Angeles"),
    ]);
    expect(resolution).toMatchObject({ status: "ambiguous", match: "close" });
  });

  it("always honours the owner's pick", () => {
    const { selected, resolution } = resolveRestaurant("Joe's Pizza", "New York", [
      place("J1", "Joe's Pizza", "7 Carmine St, New York, NY"),
      place("J2", "Joe's Pizza", "1435 Broadway, New York, NY"),
    ], "J2");
    expect(selected?.entity_id).toBe("J2");
    expect(resolution).toMatchObject({ status: "resolved", match: "owner_confirmed" });
  });
});
