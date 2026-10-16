import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockQlooServer, mockUuid } from "../scripts/mock-qloo-harness.mjs";
import {
  compareAudiences,
  describe as describeEntity,
  findTags,
  harnessReadiness,
  rank,
  resetHarnessCaches,
  runWorkflow,
  trends,
  wherePopular,
} from "@/lib/qloo-harness";

// Exercises the harness wrapper end to end: real @qloo/qloo-harness executor, real HTTP, synthetic mock API.
const { server, log } = createMockQlooServer({ quiet: true });
let base = "";
const casaId = mockUuid("place:Casa Mock:Madrid");
const paths = () => log.map((r: { path: string }) => r.path);

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

describe("qloo-harness wrapper", () => {
  it("reports readiness without calling Qloo", async () => {
    expect(await harnessReadiness()).toEqual({ configured: true, transport: "direct", resolutionProvider: "qloo_api" });
    expect(log).toHaveLength(0);
  });

  it("findTags hits /v2/tags with semantic search and maps tags", async () => {
    const r = await findTags({ query: "croquetas", limit: 5 });
    expect(r.ok && r.status).toBe("ok");
    if (!r.ok) return;
    expect(r.data[0]).toMatchObject({ id: "urn:tag:specialty_dish:place:croquetas", name: "Croquetas" });
    expect(log[0]).toMatchObject({ path: "/v2/tags", query: { "filter.query": "croquetas", "feature.semantic_search": "true", take: "5" } });
    expect(r.provenance).toMatchObject({ operation: "find_tags", transport: "direct", cached: false });
    expect(r.provenance.requests[0].path).toBe("/v2/tags");
  });

  it("serves repeated calls from the wrapper cache", async () => {
    await findTags({ query: "croquetas" });
    const again = await findTags({ query: "croquetas" });
    expect(again.provenance.cached).toBe(true);
    expect(paths()).toEqual(["/v2/tags"]);
  });

  it("rank resolves each option, then sends one Insights call restricted to the options", async () => {
    const r = await rank({ options: ["Mock Bar Uno", "Mock Bar Dos", "Mock Bar Tres"], optionType: "place", signals: [casaId], location: "Madrid" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(paths().sort()).toEqual(["/entities", "/search", "/search", "/search", "/v2/insights"]);
    const insights = log.find((q: { path: string }) => q.path === "/v2/insights")!;
    expect(insights.query).toMatchObject({ "filter.type": "urn:entity:place", take: "3", "signal.interests.entities": casaId, "signal.location.query": "Madrid" });
    expect(insights.query["filter.results.entities"].split(",")).toHaveLength(3);
    expect(r.data.map((o) => o.rank)).toEqual([1, 2, 3]);
    expect(r.data.map((o) => o.input).sort()).toEqual(["Mock Bar Dos", "Mock Bar Tres", "Mock Bar Uno"]);
    const affinities = r.data.map((o) => o.affinity ?? 0);
    expect([...affinities].sort((a, b) => b - a)).toEqual(affinities);
    expect(r.provenance.resolution.find((x) => x.input === casaId)).toMatchObject({ status: "resolved", match: "identifier", endpoint: "/entities" });
    expect(r.provenance.resolution.find((x) => x.input === "Mock Bar Uno")).toMatchObject({ match: "exact", endpoint: "/search" });
  });

  it("rank cannot take tag URNs as options (they are resolved as entity names)", async () => {
    const r = await rank({ options: ["urn:tag:specialty_dish:place:croquetas"], optionType: "place", signals: [casaId] });
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.issues[0]).toMatchObject({ input: "urn:tag:specialty_dish:place:croquetas", status: "not_found", field: "options", inputKind: "entity" });
    expect(paths()).not.toContain("/v2/insights");
  });

  it("surfaces ambiguity as needs_input with candidates and sends no main query", async () => {
    const r = await describeEntity({ entity: "La Taberna", type: "place" });
    expect(r.status).toBe("needs_input");
    if (r.status !== "needs_input") return;
    expect(r.issues[0].status).toBe("ambiguous");
    expect(r.issues[0].candidates?.map((c) => c.address)).toEqual(["Calle Mock 35, Madrid", "Calle Mock 36, Sevilla", "Calle Mock 37, Valencia"]);
    expect(paths()).toEqual(["/search"]);
  });

  it("describe by name hydrates properties; resolution says how the name matched", async () => {
    const r = await describeEntity({ entity: "Casa Mock Madrid", type: "place" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ entityId: casaId, name: "Casa Mock" });
    expect(r.data?.properties).toMatchObject({ address: "Calle Mock 35, Madrid" });
    expect(r.provenance.resolution[0]).toMatchObject({ status: "resolved", match: "semantic" });
    expect(r.provenance.resolution[0].alternatives?.[0].address).toBe("Calle Mock 36, Barcelona");
    expect(paths()).toEqual(["/search", "/entities"]);
  });

  it("trends sends one /v2/trending call per entity and maps the series", async () => {
    const r = await trends({ entities: [casaId, "Mock Rival"], entityType: "place", startDate: "2026-07-01", endDate: "2026-09-30", limit: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const calls = log.filter((q: { path: string }) => q.path === "/v2/trending");
    expect(calls).toHaveLength(2);
    expect(calls[0].query).toMatchObject({ "filter.type": "urn:entity:place", "filter.start_date": "2026-07-01", "filter.end_date": "2026-09-30", take: "4" });
    expect(r.data.map((s) => s.name)).toEqual(["Casa Mock", "Mock Rival"]);
    expect(r.data[0].points[0]).toMatchObject({ date: "2026-09-30", populationPercentile: expect.any(Number), velocityFoldChange: expect.any(Number) });
    expect(r.provenance.requests).toHaveLength(2);
  });

  it("trends rejects impossible calendar dates before calling Qloo", async () => {
    const r = await trends({ entities: [casaId], entityType: "place", startDate: "2026-02-30", endDate: "2026-03-30" });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.error.code).toBe("HARNESS_INTERNAL");
    expect(r.error.message).toMatch(/YYYY-MM-DD/);
    expect(log).toHaveLength(0);
  });

  it("wherePopular returns heatmap cells sorted by affinity; empty area -> status empty", async () => {
    const r = await wherePopular({ entity: casaId, within: "Madrid", limit: 5 });
    expect(r.ok && r.data).toHaveLength(5);
    if (!r.ok) return;
    expect(r.data[0]).toMatchObject({ geohash: expect.any(String), lat: expect.any(Number), lon: expect.any(Number) });
    const heat = log.find((q: { path: string }) => q.path === "/v2/insights")!;
    expect(heat.query).toMatchObject({ "filter.type": "urn:heatmap", "filter.location.query": "Madrid", take: "5" });
    const empty = await wherePopular({ entity: casaId, within: "Nowhere" });
    expect(empty).toMatchObject({ ok: true, status: "empty", data: [] });
  });

  it("compareAudiences maps compare tags with scores", async () => {
    const r = await compareAudiences({ groupA: [casaId], groupB: ["Mock Rival"], limit: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data[0]).toMatchObject({ id: "urn:tag:menu_highlight:qloo:vermouth", score: 0.8 });
    const compare = log.find((q: { path: string }) => q.path === "/v2/analysis/compare")!;
    expect(compare.query).toMatchObject({ "a.signal.interests.entities": casaId, take: "3" });
  });

  it("maps HTTP failures to plain error objects", async () => {
    const auth = await describeEntity({ entity: "force 401" });
    expect(auth).toMatchObject({ ok: false, status: "error", error: { code: "QLOO_AUTH", layer: "qloo", retryable: false } });
    const limited = await describeEntity({ entity: "force 429" });
    expect(limited).toMatchObject({ status: "error", error: { code: "QLOO_RATE_LIMIT", retryable: true } });
    expect(paths().filter((p: string) => p === "/search")).toHaveLength(1 + 3); // 429 is retried 3 times in total
  });

  it("rejects invalid input with TOOL_INPUT", async () => {
    const r = await runWorkflow("rank", { options: ["x"] } as never);
    expect(r).toMatchObject({ status: "error", error: { code: "TOOL_INPUT", layer: "tool_input" } });
  });

  it("enforces the overall time budget", async () => {
    const r = await findTags({ query: "slow tag" }, { timeoutMs: 200 });
    expect(r).toMatchObject({ status: "error", error: { code: "QLOO_TIMEOUT", retryable: true } });
  });

  it("reports configuration problems without sending the key anywhere", async () => {
    delete process.env.QLOO_TRUSTED_BASE_URL;
    resetHarnessCaches();
    const untrusted = await findTags({ query: "x" });
    expect(untrusted).toMatchObject({ status: "error", error: { code: "QLOO_CONFIG", layer: "config" } });
    process.env.QLOO_API_KEY = "";
    resetHarnessCaches();
    expect(await findTags({ query: "x" })).toMatchObject({ status: "error", error: { code: "QLOO_AUTH", layer: "config" } });
    expect(log).toHaveLength(0);
  });
});
