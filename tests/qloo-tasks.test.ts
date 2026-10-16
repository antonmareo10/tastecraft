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

describe("tasteGaps", () => {
  it("weights tags by affinity, drops the restaurant's own and generic tags", async () => {
    const place = (id: string, a: number, tags: string[]) => ({
      entity_id: id,
      name: `Place ${id}`,
      query: { affinity: a },
      tags: tags.map((t) => ({ name: t })),
    });
    mockFetch(() => ({
      results: {
        entities: [
          place("1", 0.9, ["Vermouth", "Tapas", "Restaurant"]),
          place("2", 0.8, ["Vermouth", "Natural wine"]),
          place("3", 0.5, ["Natural wine"]),
          place("4", 0.4, ["Karaoke"]),
        ],
      },
    }));
    const { tasteGaps } = await load();
    const { gaps } = await tasteGaps({
      restaurant: { entity_id: "R1", name: "R", all_tags: ["Tapas"] },
      city: "Madrid",
    });
    const names = gaps.map((g) => g.tag);
    expect(names[0]).toBe("Vermouth"); // 0.9 + 0.8
    expect(names).toContain("Natural wine");
    expect(names).not.toContain("Tapas"); // already on the menu
    expect(names).not.toContain("Restaurant"); // generic
    expect(gaps[0].examples).toEqual(["Place 1", "Place 2"]);
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

  it("throws a QlooError with the status on failure", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const { qlooGet, QlooError } = await import("@/lib/qloo");
    await expect(qlooGet("/v2/insights", { "filter.type": "urn:entity:place" })).rejects.toBeInstanceOf(QlooError);
  });
});
