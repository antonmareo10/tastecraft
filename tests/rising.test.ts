import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockQlooServer, mockUuid } from "../scripts/mock-qloo.mjs";
import { resetHarnessCaches } from "@/lib/qloo-harness";
import { risingNearby } from "@/lib/rising";

// rising_nearby's data path: harness trends workflow -> /v2/trending (mock) -> summarizeTrend.
const { server, log } = createMockQlooServer({ quiet: true });
let base = "";
const casa = mockUuid("place:Casa Mock:Madrid");
const barcelona = mockUuid("place:Casa Mock:Barcelona");
const NOW = new Date("2026-10-16T12:00:00Z");

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

describe("risingNearby", () => {
  it("asks /v2/trending per place for the last 180 days and summarises each series", async () => {
    const r = await risingNearby([casa, barcelona, casa], 180, { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.window).toEqual({ start: "2026-04-19", end: "2026-10-16" });
    const calls = log.filter((q: { path: string }) => q.path === "/v2/trending");
    expect(calls).toHaveLength(2); // duplicates removed
    expect(calls[0].query).toMatchObject({ "filter.type": "urn:entity:place", "filter.start_date": "2026-04-19", "filter.end_date": "2026-10-16", take: "20" });
    expect(r.rows.map((x) => x.name)).toEqual(["Casa Mock", "Casa Mock"]);
    for (const row of r.rows) {
      expect(["rising", "falling", "steady"]).toContain(row.summary.direction);
      expect(row.summary.metric).toBe("percentile");
      expect(typeof row.summary.change).toBe("number");
      expect(row.summary.points.length).toBe(20);
    }
  });

  it("reports unresolvable inputs as needs_input with a readable message and no trending call", async () => {
    const r = await risingNearby([casa, "00000000-0000-4000-8000-000000000000"], 180, { now: NOW });
    expect(r).toMatchObject({ ok: false, kind: "needs_input" });
    if (r.ok || r.kind !== "needs_input") return;
    expect(r.message).toBe('"00000000-0000-4000-8000-000000000000" was not found in Qloo');
    expect(log.some((q: { path: string }) => q.path === "/v2/trending")).toBe(false);
  });

  it("names the candidates when a place name is ambiguous", async () => {
    const r = await risingNearby(["La Taberna"], 90, { now: NOW });
    expect(r).toMatchObject({ ok: false, kind: "needs_input" });
    if (r.ok || r.kind !== "needs_input") return;
    expect(r.message).toMatch(/"La Taberna" is ambiguous \(La Taberna \/ La Taberna \/ La Taberna\)/);
  });

  it("returns a plain error (not a thrown exception) when Qloo refuses the request", async () => {
    process.env.QLOO_API_KEY = "bad-key";
    resetHarnessCaches();
    const r = await risingNearby([casa], 180, { now: NOW });
    expect(r).toMatchObject({ ok: false, kind: "error", error: { code: "QLOO_AUTH", retryable: false } });
  });
});
