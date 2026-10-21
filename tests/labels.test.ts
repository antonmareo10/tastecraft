import { describe, expect, it } from "vitest";
import { shortLabel } from "@/lib/labels";

// Invented names.
describe("shortLabel", () => {
  it("keeps names that fit, or nearly fit, in full", () => {
    expect(shortLabel("Corner Bakery", 18)).toBe("Corner Bakery");
    expect(shortLabel("Harbor Lights Juice", 18)).toBe("Harbor Lights Juice"); // one over: no ellipsis
    expect(shortLabel("  Late   Night Eats ", 18)).toBe("Late Night Eats");
  });

  it("drops a subtitle before cutting words", () => {
    expect(shortLabel("Morning Table with Ann Lee and Friends", 18)).toBe("Morning Table");
    expect(shortLabel("Talking Shop: Conversations on Food", 18)).toBe("Talking Shop");
    expect(shortLabel("Kitchen Notebook with Sam Park", 14)).toBe("Kitchen Notebook"); // the head may also run 2 over
  });

  it("cuts at a word boundary and never ends on a small word", () => {
    expect(shortLabel("Westfield Country Store", 18)).toBe("Westfield Country…");
    expect(shortLabel("The Long Weekend Him & Her Podcast", 18)).toBe("The Long Weekend…");
    expect(shortLabel("Museum of the Modern Kitchen Arts", 18)).toBe("Museum…");
  });

  it("cuts mid-word only when the first word alone is too long", () => {
    expect(shortLabel("Supercalifragilisticexpialidocious Bar", 14)).toBe("Supercalifrag…");
  });

  it("respects the budget", () => {
    for (const name of ["Westfield Country Store", "The Long Weekend Him & Her Podcast", "Morning Table with Ann Lee and Friends", "Harbor Street Marketplace and Garden"]) {
      for (const max of [14, 18, 26, 34]) expect(shortLabel(name, max).length).toBeLessThanOrEqual(max + 2);
    }
  });
});
