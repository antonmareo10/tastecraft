import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockQlooServer, mockUuid } from "../scripts/mock-qloo.mjs";
import { attachFanMatch, matchConcerts, rankArtistsForAudience, type RankFn } from "@/lib/concerts";
import type { HarnessProvenance, HarnessResult, RankedOption } from "@/lib/qloo-harness";
import { resetHarnessCaches } from "@/lib/qloo-harness";
import { billedArtists, upcomingMusicEvents, type MusicListing } from "@/lib/qloo-tasks";

const prov: HarnessProvenance = { operation: "rank", transport: "direct", requests: [], resolution: [], warnings: [], cached: false };
const ok = (data: RankedOption[]): HarnessResult<RankedOption[]> => ({ ok: true, status: "ok", data, provenance: prov });
const option = (input: string, rank: number, affinity?: number): RankedOption => ({ rank, entityId: `ID-${input}`, name: input, input, ...(affinity != null ? { affinity } : {}) });

function listing(artist: string, date: string, extra: Partial<MusicListing> = {}): MusicListing {
  return { artist, attractions: [artist], event: `${artist} live`, venue: "Sala Mock", date, kind: "music", distance_km: 2, ...extra };
}

describe("rankArtistsForAudience", () => {
  it("drops ambiguous options after needs_input and retries exactly once", async () => {
    const calls: string[][] = [];
    const rankFn: RankFn = async ({ options }) => {
      calls.push(options);
      if (calls.length === 1) {
        return {
          ok: false,
          status: "needs_input",
          summary: "Choose or correct the unresolved ranking inputs.",
          issues: [
            { input: "The Twins", status: "ambiguous", field: "options", inputKind: "entity", candidates: [{ id: "a", name: "The Twins" }, { id: "b", name: "The Twins" }] },
            { input: "Nobody", status: "not_found", field: "options", inputKind: "entity" },
          ],
          provenance: prov,
        };
      }
      return ok([option("Band B", 1, 0.91), option("Band A", 2, 0.42)]);
    };
    const r = await rankArtistsForAudience({ artists: ["Band A", "The Twins", "Band B", "Nobody", "band a"], restaurantId: "R1", city: "Madrid" }, rankFn);
    expect(calls).toEqual([["Band A", "The Twins", "Band B", "Nobody"], ["Band A", "Band B"]]);
    expect(r).toMatchObject({ ok: true, calls: 2, dropped: ["The Twins", "Nobody"] });
    if (!r.ok) return;
    expect(r.scores).toEqual([
      { input: "Band B", name: "Band B", entityId: "ID-Band B", rank: 1, fanMatch: 91 },
      { input: "Band A", name: "Band A", entityId: "ID-Band A", rank: 2, fanMatch: 42 },
    ]);
  });

  it("never makes a third call", async () => {
    const rankFn = vi.fn<RankFn>(async ({ options }) => ({
      ok: false,
      status: "needs_input",
      summary: "unresolved",
      issues: [{ input: options[0], status: "ambiguous", field: "options" }],
      provenance: prov,
    }));
    const r = await rankArtistsForAudience({ artists: ["A", "B", "C"], restaurantId: "R1" }, rankFn);
    expect(rankFn).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
  });

  it("does not retry when the problem is not an option (e.g. the restaurant signal)", async () => {
    const rankFn = vi.fn<RankFn>(async () => ({
      ok: false,
      status: "needs_input",
      summary: "Choose or correct the unresolved ranking inputs.",
      issues: [{ input: "R1", status: "not_found", field: "signals" }],
      provenance: prov,
    }));
    const r = await rankArtistsForAudience({ artists: ["A", "B"], restaurantId: "R1" }, rankFn);
    expect(rankFn).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, calls: 1 });
  });

  it("waits and repeats an attempt that hit Qloo's rate limit", async () => {
    const waits: number[] = [];
    let n = 0;
    const rankFn = vi.fn<RankFn>(async () => {
      n += 1;
      if (n <= 2) {
        return { ok: false, status: "error", error: { code: "QLOO_RATE_LIMIT", layer: "transport", retryable: true, expected: true, recovery: "", message: "429" }, provenance: prov };
      }
      return ok([option("A", 1, 0.8)]);
    });
    const r = await rankArtistsForAudience({ artists: ["A"], restaurantId: "R1" }, rankFn, async (ms) => void waits.push(ms));
    expect(waits).toEqual([2500, 5000]);
    expect(rankFn).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: true, calls: 3 });
  });

  it("gives up after two rate-limit waits", async () => {
    const rankFn = vi.fn<RankFn>(async () => ({
      ok: false,
      status: "error",
      error: { code: "QLOO_RATE_LIMIT", layer: "transport", retryable: true, expected: true, recovery: "", message: "429" },
      provenance: prov,
    }));
    const r = await rankArtistsForAudience({ artists: ["A"], restaurantId: "R1" }, rankFn, async () => undefined);
    expect(rankFn).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: false, calls: 3 });
  });

  it("passes the restaurant as the signal, the city as location and caps options at 10", async () => {
    const rankFn = vi.fn<RankFn>(async () => ok([]));
    await rankArtistsForAudience({ artists: Array.from({ length: 14 }, (_, i) => `Artist ${i}`), restaurantId: "R1", city: "Madrid" }, rankFn);
    const arg = rankFn.mock.calls[0][0];
    expect(arg).toMatchObject({ optionType: "artist", signals: ["R1"], location: "Madrid" });
    expect(arg.options).toHaveLength(10);
  });
});

describe("attachFanMatch", () => {
  it("scores each concert by its best billed artist, sorts by fan match and keeps the top 5", () => {
    const listings = [
      listing("Headliner", "2026-10-20", { attractions: ["Headliner", "Support Act"] }),
      listing("Low", "2026-10-21"),
      listing("Unranked", "2026-10-22"),
      ...["A", "B", "C", "D"].map((a, i) => listing(a, `2026-11-0${i + 1}`)),
    ];
    const shows = attachFanMatch(listings, [
      { input: "Support Act", name: "Support Act", entityId: "s", rank: 1, fanMatch: 88 },
      { input: "Headliner", name: "Headliner", entityId: "h", rank: 3, fanMatch: 70 },
      { input: "A", name: "A", entityId: "a", rank: 2, fanMatch: 80 },
      { input: "B", name: "B", entityId: "b", rank: 4, fanMatch: 60 },
      { input: "C", name: "C", entityId: "c", rank: 5, fanMatch: 50 },
      { input: "D", name: "D", entityId: "d", rank: 6, fanMatch: 40 },
      { input: "Low", name: "Low", entityId: "l", rank: 7, fanMatch: 10 },
    ]);
    expect(shows.map((s) => [s.artist, s.fan_match])).toEqual([
      ["Support Act", 88],
      ["A", 80],
      ["B", 60],
      ["C", 50],
      ["D", 40],
    ]);
    expect(shows[0]).toMatchObject({ event: "Headliner live", venue: "Sala Mock", date: "2026-10-20", kind: "music" });
    expect(shows[0]).not.toHaveProperty("attractions");
  });

  it("matches artist names regardless of case and accents", () => {
    const shows = attachFanMatch([listing("Rosalía", "2026-10-20")], [{ input: "ROSALIA", name: "Rosalia", entityId: "r", rank: 1, fanMatch: 77 }]);
    expect(shows).toEqual([expect.objectContaining({ artist: "Rosalía", fan_match: 77 })]);
  });
});

describe("matchConcerts", () => {
  const base = { lat: 40.41, lon: -3.7, city: "Madrid", restaurantId: "R1", artists: ["Fallback Artist"] };

  it("ranks the listed artists and returns concerts with fan_match", async () => {
    const r = await matchConcerts(base, {
      listEvents: async () => [listing("X", "2026-10-20"), listing("Y", "2026-10-21")],
      rank: async () => ok([option("Y", 1, 0.9), option("X", 2, 0.5)]),
      keywordSearch: async () => {
        throw new Error("should not fall back");
      },
    });
    expect(r.strategy).toBe("qloo_rank");
    expect(r.shows.map((s) => [s.artist, s.fan_match])).toEqual([["Y", 90], ["X", 50]]);
  });

  it("falls back to the keyword search when ranking fails entirely", async () => {
    const keywordSearch = vi.fn(async () => [{ artist: "Fallback Artist", event: "Fallback live", venue: "V", date: "2026-10-25", kind: "music" as const }]);
    const r = await matchConcerts(base, {
      listEvents: async () => [listing("X", "2026-10-20")],
      rank: async () => ({
        ok: false,
        status: "error",
        error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, expected: true, recovery: "", message: "403" },
        provenance: prov,
      }),
      keywordSearch,
    });
    expect(r.strategy).toBe("keyword_fallback");
    expect(r.note).toMatch(/QLOO_AUTH/);
    expect(keywordSearch).toHaveBeenCalledWith({ artists: ["Fallback Artist"], lat: 40.41, lon: -3.7 });
    expect(r.shows[0].fan_match).toBeUndefined();
  });

  it("falls back when the listing is unavailable or there is no restaurant entity", async () => {
    const keywordSearch = vi.fn(async () => []);
    const rank = vi.fn<RankFn>(async () => ok([]));
    expect((await matchConcerts(base, { listEvents: async () => null, rank, keywordSearch })).strategy).toBe("keyword_fallback");
    expect((await matchConcerts({ ...base, restaurantId: undefined }, { listEvents: async () => [], rank, keywordSearch })).strategy).toBe("keyword_fallback");
    expect(rank).not.toHaveBeenCalled();
  });

  it("does not call Qloo when nothing is listed nearby", async () => {
    const rank = vi.fn<RankFn>(async () => ok([]));
    const r = await matchConcerts(base, { listEvents: async () => [], rank, keywordSearch: async () => [] });
    expect(r).toMatchObject({ strategy: "qloo_rank", shows: [], rankCalls: 0 });
    expect(rank).not.toHaveBeenCalled();
  });
});

describe("Ticketmaster music listing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TICKETMASTER_API_KEY;
  });

  it("lists billed music events, drops non-shows and orders artists nearest first", async () => {
    process.env.TICKETMASTER_API_KEY = "tm-test";
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        urls.push(new URL(String(input)));
        const ev = (name: string, date: string, distance: number, attractions: string[]) => ({
          name,
          url: `https://tm.example/${encodeURIComponent(name)}`,
          distance,
          dates: { start: { localDate: date } },
          _embedded: { venues: [{ name: "Sala Mock" }], attractions: attractions.map((a) => ({ name: a })) },
        });
        return new Response(
          JSON.stringify({
            _embedded: {
              events: [
                ev("Far Band live", "2026-10-18", 20, ["Far Band"]),
                ev("Near Band + Guest", "2026-10-25", 1.2, ["Near Band", "Guest"]),
                ev("Tribute to Someone", "2026-10-19", 2, ["Tribute Band"]),
                ev("No billing", "2026-10-20", 3, []),
                ev("Near Band + Guest", "2026-10-25", 1.2, ["Near Band", "Guest"]),
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const list = await upcomingMusicEvents({ lat: 40.41, lon: -3.7 });
    expect(urls[0].searchParams.get("classificationName")).toBe("music");
    expect(urls[0].searchParams.get("size")).toBe("50");
    expect(urls[0].searchParams.get("radius")).toBe("25");
    expect(urls[0].searchParams.get("keyword")).toBeNull();
    expect(list?.map((l) => l.event)).toEqual(["Far Band live", "Near Band + Guest"]);
    expect(billedArtists(list!)).toEqual(["Near Band", "Guest", "Far Band"]);
    expect(billedArtists(list!, 2)).toEqual(["Near Band", "Guest"]);
  });

  it("returns null when Ticketmaster fails, so the caller can fall back", async () => {
    process.env.TICKETMASTER_API_KEY = "tm-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await upcomingMusicEvents({ lat: 1, lon: 2 })).toBeNull();
  });
});

describe("artist ranking through the real harness (mock Qloo)", () => {
  const { server, log } = createMockQlooServer({ quiet: true });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    process.env.QLOO_API_KEY = "test-key";
    process.env.QLOO_BASE_URL = base;
    process.env.QLOO_TRUSTED_BASE_URL = base;
    resetHarnessCaches();
    log.length = 0;
  });

  it("drops the ambiguous artist, retries once and scores the rest", async () => {
    const restaurant = mockUuid("place:Casa Mock:Madrid");
    const r = await rankArtistsForAudience({ artists: ["Mock Band One", "The Twins", "Mock Band Two"], restaurantId: restaurant, city: "Madrid" });
    expect(r).toMatchObject({ ok: true, calls: 2, dropped: ["The Twins"] });
    if (!r.ok) return;
    expect(r.scores.map((s) => s.input).sort()).toEqual(["Mock Band One", "Mock Band Two"]);
    expect(r.scores.every((s) => typeof s.fanMatch === "number" && s.fanMatch >= 0 && s.fanMatch <= 100)).toBe(true);
    const insights = log.filter((q: { path: string }) => q.path === "/v2/insights");
    expect(insights).toHaveLength(1); // the first call stopped at needs_input before querying
    expect(insights[0].query).toMatchObject({ "filter.type": "urn:entity:artist", "signal.interests.entities": restaurant, "signal.location.query": "Madrid", take: "2" });
  });
});
