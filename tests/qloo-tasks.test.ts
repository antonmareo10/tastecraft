import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test gets a fresh module graph so the in-memory Qloo cache does not leak between tests.
async function load() {
  vi.resetModules();
  return import("@/lib/qloo-tasks");
}

function mockFetch(handler: (url: URL) => unknown) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify(handler(url)), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env.QLOO_API_KEY = "test-key";
  process.env.QLOO_BASE_URL = "https://hackathon.api.qloo.com";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audienceAffinity", () => {
  it("filters places to the city but localises other domains with a geo signal", async () => {
    const calls = mockFetch(() => ({ results: { entities: [{ entity_id: "A", name: "Artist A", query: { affinity: 0.9 } }] } }));
    const { audienceAffinity } = await load();
    await audienceAffinity({ entityIds: ["R1"], domain: "place", city: "Madrid" });
    await audienceAffinity({ entityIds: ["R1"], domain: "artist", city: "Madrid" });
    const [place, artist] = calls;
    expect(place.pathname).toBe("/v2/insights");
    expect(place.searchParams.get("filter.type")).toBe("urn:entity:place");
    expect(place.searchParams.get("filter.location.query")).toBe("Madrid");
    expect(place.searchParams.get("filter.exclude.entities")).toBe("R1");
    expect(artist.searchParams.get("signal.location.query")).toBe("Madrid");
    expect(artist.searchParams.get("filter.location.query")).toBeNull();
  });

  it("normalises entities and keeps affinity", async () => {
    mockFetch(() => ({ results: { entities: [{ entity_id: "A", name: "Artist A", query: { affinity: 0.9 }, tags: [{ name: "Pop" }] }] } }));
    const { audienceAffinity } = await load();
    const res = await audienceAffinity({ entityIds: ["R1"], domain: "artist", city: "Madrid" });
    expect(res[0]).toMatchObject({ entity_id: "A", name: "Artist A", affinity: 0.9, tags: ["Pop"] });
  });
});

describe("findRestaurant", () => {
  it("searches the name alone when the city words drown it, and the resolver then picks the restaurant", async () => {
    const calls = mockFetch((url) => ({
      results:
        url.searchParams.get("query") === "Gjelina"
          ? [{ entity_id: "G1", name: "Gjelina", properties: { address: "1429 Abbot Kinney Blvd Venice, CA 90291" } }]
          : [{ entity_id: "L1", name: "Los Angeles Convention Center", properties: { address: "1201 S Figueroa St Los Angeles, CA" } }],
    }));
    const { findRestaurant, resolveRestaurant } = await load();
    const matches = await findRestaurant("Gjelina", "Los Angeles");
    expect(calls.map((u) => u.searchParams.get("query"))).toEqual(["Gjelina Los Angeles", "Gjelina"]);
    expect(resolveRestaurant("Gjelina", "Los Angeles", matches).selected?.entity_id).toBe("G1");
  });

  it("does not search again when the first results carry the name", async () => {
    const calls = mockFetch(() => ({ results: [{ entity_id: "K1", name: "Katz's Delicatessen", properties: { address: "205 E Houston St New York" } }] }));
    const { findRestaurant } = await load();
    await findRestaurant("Katz's Delicatessen", "New York");
    expect(calls).toHaveLength(1);
  });
});

describe("compareAudiences (head-to-head)", () => {
  const t = (name: string, subtype: string, score?: number) => ({ tag_id: `urn:x:${name}`, name, subtype, query: score == null ? { count: "1" } : { score } });

  it("shows what only one place carries, compared by name, ordered by Qloo's weight, with no score", async () => {
    const calls = mockFetch(() => ({
      results: {
        // the merged list: shared tags all sit at sigmoid(1) = 0.731, which is what the UI used to print as "73"
        tags: [t("Lively", "urn:tag:ambience:qloo", 0.99), t("Late night", "urn:tag:ambience:qloo", 0.9), t("Deli", "urn:tag:genre:place", 0.731), t("Bagel Shop", "urn:tag:genre:place", 0.85)],
        a: [t("Deli", "urn:tag:genre:place:restaurant:deli"), t("Late night", "urn:tag:ambience:qloo"), t("Lively", "urn:tag:ambience:qloo"), t("Visa", "urn:tag:payments:place"), t("Place", "urn:tag:genre:place")],
        b: [t("Deli", "urn:tag:cuisine:qloo"), t("Bagel Shop", "urn:tag:genre:place:bagel_shop"), t("Breakfast", "urn:tag:dining_options:place")],
      },
    }));
    const { compareAudiences } = await load();
    const h = await compareAudiences({ a: "A1", b: "B1", city: "New York" });
    expect(h).toEqual({ onlyA: ["Lively", "Late night"], onlyB: ["Bagel Shop"], shared: ["Deli"] });
    expect(calls[0].pathname).toBe("/v2/analysis/compare");
    expect(calls[0].searchParams.get("a.signal.interests.entities")).toBe("A1");
    expect(calls[0].searchParams.get("b.signal.interests.entities")).toBe("B1");
  });

  it("keeps cuisine tags that merely start like a generic word", async () => {
    mockFetch(() => ({ results: { tags: [], a: [t("Barbecue", "urn:tag:genre:place:restaurant:barbecue")], b: [t("Bar", "urn:tag:genre:place:bar")] } }));
    const { compareAudiences } = await load();
    const h = await compareAudiences({ a: "A1", b: "B1", city: "Austin" });
    expect(h.onlyA).toEqual(["Barbecue"]);
    expect(h.onlyB).toEqual([]); // "Bar" alone says nothing about taste
  });
});

describe("tasteGaps", () => {
  type Tag = { name: string; type: string };
  const tag = (name: string, type = "urn:tag:ambience:qloo"): Tag => ({ name, type });
  const dish = (name: string): Tag => tag(name, "urn:tag:specialty_dish:place");
  const place = (id: string, tags: Tag[]) => ({ entity_id: id, name: `Place ${id}`, query: { affinity: 0.9 }, tags });
  // crowd: 6 restaurants the audience loves; city: the 6 most popular restaurants (no audience signal)
  const crowd = [
    place("c1", [tag("Vermouth"), tag("Tapas"), tag("Restaurant", "urn:tag:genre:place:restaurant"), tag("Visa", "urn:tag:payments:place"), dish("Croquetas de jamón")]),
    place("c2", [tag("Vermouth"), tag("Natural wine"), tag("Visa", "urn:tag:payments:place"), dish("Croquetas de jamón")]),
    place("c3", [tag("Vermouth"), tag("Natural wine"), dish("Croquetas de jamón")]),
    place("c4", [tag("Vermouth"), tag("Natural wine"), dish("Croquetas de jamón"), dish("Burger")]),
    place("c5", [tag("Tapas")]),
    place("c6", [tag("Karaoke")]),
  ];
  const city = [
    place("t1", [tag("Vermouth"), tag("Natural wine"), dish("Burger")]),
    place("t2", [tag("Natural wine"), dish("Burger")]),
    place("t3", [tag("Natural wine"), dish("Burger")]),
    place("t4", [dish("Burger")]),
    place("t5", [dish("Burger")]),
    place("t6", [dish("Burger")]),
  ];

  it("ranks tags the crowd's restaurants carry more often than the city's, minus own, generic and non-taste tags", async () => {
    const calls = mockFetch((url) => ({
      results: { entities: url.searchParams.get("signal.interests.entities") ? crowd : city },
    }));
    const { tasteGaps } = await load();
    const { gaps, menu, crowd_n, city_n } = await tasteGaps({
      restaurant: { entity_id: "R1", name: "R", all_tags: ["Tapas"] },
      city: "Madrid",
    });
    expect([crowd_n, city_n]).toEqual([6, 6]);
    // Vermouth: crowd 4/6, city 1/6 -> (5/8)/(2/8) = 2.5. Natural wine: 3 vs 3 -> 1.0, not a gap.
    expect(gaps.map((g) => g.tag)).toEqual(["Vermouth"]);
    expect(gaps[0]).toMatchObject({ crowd: 4, city: 1, crowd_pct: 67, city_pct: 17, lift: 2.5 });
    expect(gaps[0].examples).toEqual(["Place c1", "Place c2", "Place c3"]);
    // Menu terms: croquetas favoured, burgers avoided.
    expect(menu.over.map((t) => t.term)).toEqual(["Croquetas de jamón"]);
    expect(menu.under.map((t) => t.term)).toEqual(["Burger"]);
    // Both sets are restaurants in the city, without the restaurant itself; only the crowd has the audience signal.
    const [a, b] = calls;
    for (const u of [a, b]) {
      expect(u.searchParams.get("filter.tags")).toBe("urn:tag:genre:place:restaurant");
      expect(u.searchParams.get("filter.location.query")).toBe("Madrid");
      expect(u.searchParams.get("filter.exclude.entities")).toBe("R1");
      expect(u.searchParams.get("page")).toBe("1");
    }
    expect(calls.filter((u) => u.searchParams.get("signal.interests.entities") === "R1")).toHaveLength(1); // short page: no page 2
  });
});

describe("tasteHeatmap", () => {
  it("decodes geohashes, normalises affinity and picks distinct hotspots", async () => {
    mockFetch(() => ({
      results: {
        heatmap: [
          { location: { geohash: "ezjmgtw" }, query: { affinity: 0.2 } },
          { location: { geohash: "ezjmgtx" }, query: { affinity: 0.9 } }, // next to the one below
          { location: { geohash: "ezjmgty" }, query: { affinity: 0.85 } },
          { location: { geohash: "ezjq1b2" }, query: { affinity: 0.6 } }, // far away
        ],
      },
    }));
    const { tasteHeatmap } = await load();
    const { cells, top } = await tasteHeatmap({ entityId: "R1", city: "Madrid" });
    expect(cells).toHaveLength(4);
    expect(Math.max(...cells.map((c) => c.affinity))).toBe(1);
    expect(Math.min(...cells.map((c) => c.affinity))).toBe(0);
    for (const c of cells) {
      expect(c.bbox[0]).toBeLessThan(c.bbox[2]);
      expect(c.lat).toBeGreaterThan(40);
    }
    // Adjacent hot cells collapse into one hotspot; the far cell becomes the second.
    expect(top[0].geohash).toBe("ezjmgtx");
    expect(top.map((t) => t.geohash)).toContain("ezjq1b2");
    expect(top.map((t) => t.geohash)).not.toContain("ezjmgty");
  });
});

describe("qlooGet", () => {
  it("sends the API key header and caches identical requests", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { qlooGet } = await import("@/lib/qloo");
    await qlooGet("/search", { query: "x", types: "urn:entity:place" });
    await qlooGet("/search", { types: "urn:entity:place", query: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
  });

  it("does not retry a rejected key and labels it QLOO_AUTH", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { qlooGet } = await import("@/lib/qloo");
    await expect(qlooGet("/search", { query: "x" })).rejects.toMatchObject({ code: "QLOO_AUTH", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx once, then succeeds", async () => {
    vi.resetModules();
    let n = 0;
    const fetchMock = vi.fn(async () =>
      ++n === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { qlooGet } = await import("@/lib/qloo");
    await expect(qlooGet("/search", { query: "y" })).resolves.toEqual({ results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit (honouring retry-after) up to 3 attempts, then gives up", async () => {
    vi.resetModules();
    const limited = () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
    let n = 0;
    const fetchMock = vi.fn(async () => (++n < 3 ? limited() : new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { qlooGet } = await import("@/lib/qloo");
    await expect(qlooGet("/search", { query: "z" })).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const always = vi.fn(async () => limited());
    vi.stubGlobal("fetch", always);
    await expect(qlooGet("/search", { query: "w" })).rejects.toMatchObject({ code: "QLOO_RATE_LIMIT" });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("keeps at most 4 requests in flight", async () => {
    vi.resetModules();
    let live = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live -= 1;
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    const { qlooGet } = await import("@/lib/qloo");
    await Promise.all(Array.from({ length: 10 }, (_, i) => qlooGet("/search", { query: `q${i}` })));
    expect(peak).toBe(4);
  });

  it("throws a QlooError with the status on failure", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const { qlooGet, QlooError } = await import("@/lib/qloo");
    await expect(qlooGet("/v2/insights", { "filter.type": "urn:entity:place" })).rejects.toBeInstanceOf(QlooError);
  });
});
