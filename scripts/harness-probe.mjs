// DEV-ONLY: runs every @qloo/qloo-harness workflow through the in-process direct executor against
// the logging mock (scripts/mock-qloo-harness.mjs) and records, per case, the exact HTTP requests sent
// and the returned envelope (or the thrown QlooWorkflowExecutionError). No real Qloo key is used.
//
// Usage: node scripts/harness-probe.mjs [out.json]
// QLOO_HOME is forced to a temp folder so the harness never writes into the user's home directory.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockQlooServer, mockUuid } from "./mock-qloo-harness.mjs";

const out = process.argv[2];
const { server, log } = createMockQlooServer({ quiet: true });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const home = process.env.QLOO_HOME || mkdtempSync(join(tmpdir(), "qloo-home-"));

const { createDirectQlooWorkflowExecutorFromEnvironment, QlooWorkflowExecutionError } = await import("@qloo/qloo-harness");

function executor(apiKey = "dummy-key", extra = {}) {
  return createDirectQlooWorkflowExecutorFromEnvironment({
    env: { QLOO_HOME: home, QLOO_API_KEY: apiKey, QLOO_BASE_URL: base, QLOO_TRUSTED_BASE_URL: base, ...extra },
    readConfigFile: () => "",
    executionObserver: {}, // no file logs
  });
}

const casaId = mockUuid("place:Casa Mock:Madrid");
const cases = [
  ["recommend", "recommend", { target_type: "place", signals: ["Casa Mock Madrid"], signal_tags: ["Croquetas"], signal_location: "Madrid", demographic: "women 25-34", filter_location: "Madrid", limit: 5 }],
  ["recommend_empty_results", "recommend", { target_type: "place", signals: [casaId], filter_location: "Nowhere", limit: 5 }],
  ["recommend_demographic_without_location", "recommend", { target_type: "artist", demographic: "millennials" }],
  ["rank_places_by_name", "rank", { options: ["Mock Bar Uno", "Mock Bar Dos", "Mock Bar Tres"], option_type: "place", signals: ["Casa Mock Madrid"], signal_location: "Madrid" }],
  ["rank_by_uuid_with_demographic", "rank", { options: [mockUuid("place:Casa Mock:Madrid"), mockUuid("place:Casa Mock:Barcelona")], option_type: "place", signal_location: "Madrid", demographic: "young women" }],
  ["rank_tag_urns_as_options", "rank", { options: ["urn:tag:specialty_dish:place:croquetas", "urn:tag:menu_highlight:qloo:vermouth"], option_type: "place", signals: [casaId] }],
  ["rank_without_signal", "rank", { options: ["Mock Bar Uno"], option_type: "place" }],
  ["describe_semantic", "describe", { entity: "Casa Mock Madrid", type: "place" }],
  ["describe_uuid", "describe", { entity: casaId }],
  ["describe_ambiguous", "describe", { entity: "La Taberna", type: "place" }],
  ["describe_not_found", "describe", { entity: "zzz nowhere", type: "place" }],
  ["where_popular", "where_popular", { entity: casaId, within: "Madrid", limit: 5 }],
  ["where_popular_empty", "where_popular", { entity: casaId, within: "Nowhere" }],
  ["compare_audiences", "compare_audiences", { group_a: [casaId], group_b: ["Mock Rival"], target_type: "place", limit: 5 }],
  ["entity_tags", "entity_tags", { entities: [casaId], limit: 5 }],
  ["audience_demographics", "audience_demographics", { entity: casaId }],
  ["trends", "trends", { entities: [casaId, "Mock Rival"], entity_type: "place", start_date: "2026-07-01", end_date: "2026-09-30", limit: 4 }],
  ["trends_bad_calendar_date", "trends", { entities: [casaId], entity_type: "place", start_date: "2026-02-30", end_date: "2026-03-30" }],
  ["trends_unsupported_type", "trends", { entities: [casaId], entity_type: "destination", start_date: "2026-07-01", end_date: "2026-09-30" }],
  ["find_tags", "find_tags", { query: "croquetas", limit: 5 }],
  ["find_tags_cozy", "find_tags", { query: "cozy", limit: 5 }],
  ["recommend_ambiguous_tag", "recommend", { target_type: "place", signal_tags: ["cozy"], signal_location: "Madrid" }],
  ["recommend_tag_urn", "recommend", { target_type: "place", signal_tags: ["urn:tag:ambience:qloo:cozy_atmosphere"], signal_location: "Madrid", limit: 3, explain: false }],
  ["input_invalid", "rank", { options: ["x"] }],
  ["http_401", "describe", { entity: "force 401" }],
  ["http_429", "describe", { entity: "force 429" }],
  ["http_500", "describe", { entity: "force 500" }],
];

function plainError(e) {
  if (e instanceof QlooWorkflowExecutionError) {
    return { name: e.name, code: e.code, layer: e.layer, retryable: e.retryable, expected: e.expected, recovery: e.recovery, correlationId: e.correlationId, durationMs: e.durationMs, message: e.message };
  }
  return { name: e?.name, message: String(e?.message ?? e) };
}

const results = {};
for (const [name, op, input] of cases) {
  log.length = 0;
  const started = Date.now();
  let envelope;
  let error;
  try {
    // Fresh executor per case: the native resolver caches outcomes in memory for 15 minutes, and a
    // cold cache is what a serverless invocation sees.
    envelope = (await executor().execute(op, input, { correlationId: `probe-${name}` })).result;
  } catch (e) {
    error = plainError(e);
  }
  results[name] = {
    operation: op,
    input,
    wall_ms: Date.now() - started,
    requests: log.map(({ method, path, query, correlation_id }) => ({ method, path, query, correlation_id })),
    ...(envelope ? { envelope } : { error }),
  };
  const r = results[name];
  console.log(`${name.padEnd(40)} ${r.envelope ? `status=${r.envelope.status}` : `THROW ${r.error.code ?? r.error.name}`}  requests=${r.requests.map((q) => q.path).join(",") || "-"}`);
}

// Configuration edge cases (no requests involved).
const config = {};
config.no_key = executor("") === undefined ? "returns undefined" : "returns executor";
try {
  createDirectQlooWorkflowExecutorFromEnvironment({ env: { QLOO_HOME: home, QLOO_API_KEY: "dummy-key", QLOO_BASE_URL: base }, readConfigFile: () => "", executionObserver: {} });
  config.untrusted_custom_base_url = "accepted";
} catch (e) {
  config.untrusted_custom_base_url = `throws ${e.name}: ${e.message}`;
}
log.length = 0;
try {
  await executor("bad-key").execute("find_tags", { query: "x" });
} catch (e) {
  config.bad_key = plainError(e);
}
results.__config = config;
console.log("config:", JSON.stringify(config, null, 1));

if (out) writeFileSync(out, JSON.stringify(results, null, 2));
server.close();
