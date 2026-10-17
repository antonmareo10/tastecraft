// Server-only wrapper around Qloo's official hackathon harness (@qloo/qloo-harness).
// It drives the harness's in-process "direct" workflow executor, which is the same code path that
// `qloo exec` and `qloo mcp` use: validated inputs, name -> Qloo ID resolution with ambiguity reporting,
// and a versioned result envelope. Findings and trade-offs: docs/HARNESS_NOTES.md.
//
// Never import this from a client component: it reads QLOO_API_KEY.
//
// Configuration (the harness's own variable names):
// - QLOO_API_KEY            required.
// - QLOO_BASE_URL           optional. Same default as src/lib/qloo.ts (the hackathon host) so both paths hit one host.
// - QLOO_TRUSTED_BASE_URL   the harness refuses to send the key to any host other than https://api.qloo.com unless
//                           this equals QLOO_BASE_URL. The documented hackathon host is trusted automatically;
//                           a local mock (http://127.0.0.1:PORT) must be trusted explicitly.
// The harness's on-disk config (~/.qloo/config) and file logs are deliberately not used: on a serverless
// function the home directory is read-only, and server config should come from the environment only.

import { createHash } from "node:crypto";
import type { QlooWorkflowExecutor } from "@qloo/qloo-harness";

export const HARNESS_OPERATIONS = [
  "recommend",
  "rank",
  "describe",
  "where_popular",
  "compare_audiences",
  "entity_tags",
  "audience_demographics",
  "trends",
  "find_tags",
] as const;
export type HarnessOperation = (typeof HARNESS_OPERATIONS)[number];

/** Entity types the harness accepts for Insights-backed workflows (note: no "destination"; "videogame" spelling). */
export type InsightsType = "artist" | "book" | "brand" | "movie" | "person" | "place" | "podcast" | "tv_show" | "videogame";
/** Entity types accepted where the harness resolves through /search. */
export type SearchType = InsightsType | "locality" | "actor" | "album" | "author" | "director";

/** Harness workflow inputs (snake_case = the harness contract, v0.1.26). Limits are 1..20. */
export type WorkflowInputs = {
  recommend: {
    target_type: InsightsType;
    signals?: string[];
    signal_tags?: string[];
    signal_tags_operator?: "union" | "intersection";
    signal_location?: string;
    demographic?: string;
    filter_location?: string;
    include_tags?: string[];
    include_tags_operator?: "union" | "intersection";
    exclude_tags?: string[];
    exclude_tags_operator?: "union" | "intersection";
    explain?: boolean;
    limit?: number;
  };
  rank: {
    options: string[];
    option_type: InsightsType;
    signals?: string[];
    signal_location?: string;
    demographic?: string;
    include_tags?: string[];
    exclude_tags?: string[];
  };
  describe: { entity: string; type?: SearchType };
  where_popular: { entity: string; entity_type?: SearchType; within: string; limit?: number };
  compare_audiences: { group_a: string[]; group_b: string[]; target_type?: InsightsType; limit?: number };
  entity_tags: { entities: string[]; entity_type?: SearchType; limit?: number };
  audience_demographics: { entity: string; entity_type?: SearchType; limit?: number };
  trends: { entities: string[]; entity_type: InsightsType; start_date: string; end_date: string; limit?: number };
  find_tags: { query: string; semantic?: boolean; limit?: number };
};

// --- Result types ----------------------------------------------------------------------

export type ResolutionCandidate = {
  id: string;
  name: string;
  type?: string;
  score?: number;
  popularity?: number;
  description?: string;
  address?: unknown;
};

/** How one free-text input (entity name, UUID, tag name or tag URN) was turned into a Qloo ID. */
export type ResolutionRecord = {
  input: string;
  status: "resolved" | "ambiguous" | "not_found";
  match?: "identifier" | "exact" | "semantic";
  /** Which workflow field the input came from (only reported for unresolved inputs). */
  field?: string;
  inputKind?: "entity" | "tag";
  selected?: ResolutionCandidate;
  alternatives?: ResolutionCandidate[];
  candidates?: ResolutionCandidate[];
  /** Where the harness resolved it: /search, /entities, /v2/tags or local:tag-urn. */
  endpoint?: string;
  /** True when the harness answered from its in-memory resolution cache (15 min). */
  fromCache?: boolean;
  warnings?: string[];
};

export type HarnessRequest = { method: "GET"; path: string; query: Record<string, unknown> };

export type HarnessProvenance = {
  operation: HarnessOperation;
  transport: "direct";
  correlationId?: string;
  durationMs?: number;
  /** The main Qloo request(s) of the workflow (resolution lookups are not listed here). */
  requests: HarnessRequest[];
  resolution: ResolutionRecord[];
  warnings: string[];
  /** True when this wrapper served the result from its own TTL cache. */
  cached: boolean;
};

export type HarnessError = {
  /** Harness codes (QLOO_AUTH, QLOO_RATE_LIMIT, QLOO_TIMEOUT, TOOL_INPUT, ...) plus QLOO_CONFIG from this wrapper. */
  code: string;
  layer: string;
  retryable: boolean;
  expected: boolean;
  recovery: string;
  message: string;
};

export type HarnessResult<T> =
  | { ok: true; status: "ok" | "empty" | "partial" | "degraded"; summary?: string; data: T; provenance: HarnessProvenance }
  | { ok: false; status: "needs_input"; summary: string; issues: ResolutionRecord[]; provenance: HarnessProvenance }
  | { ok: false; status: "error"; error: HarnessError; provenance: HarnessProvenance };

export type RunOptions = {
  signal?: AbortSignal;
  /** Overall budget for the workflow, including the harness's own retries. Default 30 s. */
  timeoutMs?: number;
  correlationId?: string;
  /** Use this wrapper's 6 h result cache (default true). */
  cache?: boolean;
};

type Envelope = Record<string, unknown> & { status?: string; summary?: string };

// --- Executor lifecycle ----------------------------------------------------------------------

const HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";
const AUTO_TRUSTED_BASE_URLS = new Set([HACKATHON_BASE_URL]);
const DEFAULT_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

type HarnessModule = typeof import("@qloo/qloo-harness");
let harnessModule: Promise<HarnessModule> | undefined;
// Lazy: importing the package costs ~2 s of cold start (it also loads the Pi agent SDK), so only
// requests that actually run a workflow pay for it.
const loadHarness = () => (harnessModule ??= import("@qloo/qloo-harness"));

let current: { fingerprint: string; executor: QlooWorkflowExecutor } | undefined;
const resultCache = new Map<string, { at: number; result: HarnessResult<unknown> }>();

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function harnessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const apiKey = env.QLOO_API_KEY?.trim();
  if (apiKey) out.QLOO_API_KEY = apiKey;
  const baseUrl = trimSlash(env.QLOO_BASE_URL || HACKATHON_BASE_URL);
  out.QLOO_BASE_URL = baseUrl;
  const trusted = env.QLOO_TRUSTED_BASE_URL?.trim() || (AUTO_TRUSTED_BASE_URLS.has(baseUrl) ? baseUrl : undefined);
  if (trusted) out.QLOO_TRUSTED_BASE_URL = trusted;
  return out;
}

function configError(code: string, message: string, recovery: string): HarnessError {
  return { code, layer: "config", retryable: false, expected: true, recovery, message };
}

async function getExecutor(): Promise<{ executor: QlooWorkflowExecutor; fingerprint: string } | { error: HarnessError }> {
  const env = harnessEnv();
  if (!env.QLOO_API_KEY) {
    return { error: configError("QLOO_AUTH", "QLOO_API_KEY is not configured on the server.", "Set QLOO_API_KEY in the server environment.") };
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(env)).digest("hex");
  if (current?.fingerprint === fingerprint) return current;
  const { createDirectQlooWorkflowExecutorFromEnvironment } = await loadHarness();
  try {
    const executor = createDirectQlooWorkflowExecutorFromEnvironment({
      env: { ...env, NODE_ENV: process.env.NODE_ENV }, // only the Qloo variables, never the whole process env
      readConfigFile: () => "", // ignore ~/.qloo/config: server config comes from the environment only
      executionObserver: {}, // the default observer appends JSONL logs under QLOO_HOME
    });
    if (!executor) {
      return { error: configError("QLOO_AUTH", "The harness found no Qloo credential.", "Set QLOO_API_KEY in the server environment.") };
    }
    current = { fingerprint, executor };
    return current;
  } catch (e) {
    // e.g. "Custom Qloo base URL is not trusted. Approve the exact endpoint before sending credentials."
    return {
      error: configError(
        "QLOO_CONFIG",
        e instanceof Error ? e.message : String(e),
        "Set QLOO_TRUSTED_BASE_URL to exactly QLOO_BASE_URL (HTTPS, or http://localhost / 127.0.0.1 for a mock).",
      ),
    };
  }
}

/** Drop the cached executor and results (tests, or after changing env at runtime). */
export function resetHarnessCaches(): void {
  current = undefined;
  resultCache.clear();
}

/** Readiness without any network call. */
export async function harnessReadiness(): Promise<{
  configured: boolean;
  transport?: string;
  resolutionProvider?: string;
  error?: Pick<HarnessError, "code" | "message" | "recovery">;
}> {
  const got = await getExecutor();
  if ("error" in got) return { configured: false, error: { code: got.error.code, message: got.error.message, recovery: got.error.recovery } };
  return { configured: true, transport: got.executor.transport.kind, resolutionProvider: got.executor.resolution?.provider_id };
}

// --- Envelope -> plain objects ---------------------------------------------------------------

function rec(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function strings(value: unknown): string[] {
  return arr(value).filter((v): v is string => typeof v === "string");
}

function candidate(value: unknown): ResolutionCandidate | undefined {
  const c = rec(value);
  const id = str(c?.id);
  const name = str(c?.name);
  if (!c || !id || !name) return undefined;
  return {
    id,
    name,
    ...(str(c.type) ? { type: str(c.type) } : {}),
    ...(num(c.score) !== undefined ? { score: num(c.score) } : {}),
    ...(num(c.popularity) !== undefined ? { popularity: num(c.popularity) } : {}),
    ...(str(c.description) ? { description: str(c.description) } : {}),
    ...(c.address !== undefined ? { address: c.address } : {}),
  };
}
function candidates(value: unknown): ResolutionCandidate[] | undefined {
  const list = arr(value).map(candidate).filter((c): c is ResolutionCandidate => c !== undefined);
  return list.length > 0 ? list : undefined;
}

function resolutionRecord(value: unknown): ResolutionRecord | undefined {
  const o = rec(value);
  const input = str(o?.input);
  // Outcomes (ok envelopes) carry `status`; issues (needs_input envelopes) carry `kind`.
  const status = (str(o?.status) ?? str(o?.kind)) as ResolutionRecord["status"] | undefined;
  if (!o || !input || !status) return undefined;
  const provenance = rec(o.provenance);
  const warnings = strings(o.warnings);
  return {
    input,
    status,
    ...(str(o.match) ? { match: str(o.match) as ResolutionRecord["match"] } : {}),
    ...(str(o.field) ? { field: str(o.field) } : {}),
    ...(str(o.input_kind) ? { inputKind: str(o.input_kind) as ResolutionRecord["inputKind"] } : {}),
    ...(candidate(o.selected) ? { selected: candidate(o.selected) } : {}),
    ...(candidates(o.alternatives) ? { alternatives: candidates(o.alternatives) } : {}),
    ...(candidates(o.candidates) ? { candidates: candidates(o.candidates) } : {}),
    ...(str(provenance?.endpoint) ? { endpoint: str(provenance?.endpoint) } : {}),
    ...(provenance?.cache_status === "memory_hit" ? { fromCache: true } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function provenanceOf(operation: HarnessOperation, envelope: Envelope): HarnessProvenance {
  const execution = rec(envelope.execution);
  const resolution = rec(envelope.resolution);
  const records = [...arr(resolution?.outcomes), ...arr(resolution?.issues)]
    .map(resolutionRecord)
    .filter((r): r is ResolutionRecord => r !== undefined);
  return {
    operation,
    transport: "direct",
    correlationId: str(execution?.correlation_id),
    durationMs: num(execution?.duration_ms),
    requests: arr(rec(envelope.provenance)?.requests)
      .map(rec)
      .filter((r): r is Record<string, unknown> => r !== undefined)
      .map((r) => ({ method: "GET" as const, path: String(r.path ?? ""), query: rec(r.query) ?? {} })),
    resolution: records,
    warnings: strings(envelope.warnings),
    cached: false,
  };
}

function toHarnessError(e: unknown, timedOut: boolean): HarnessError {
  if (timedOut) {
    return {
      code: "QLOO_TIMEOUT",
      layer: "transport",
      retryable: true,
      expected: true,
      recovery: "The workflow exceeded its time budget; retry once or raise timeoutMs.",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const o = rec(e);
  if (o && o.name === "QlooWorkflowExecutionError") {
    return {
      code: String(o.code ?? "HARNESS_INTERNAL"),
      layer: String(o.layer ?? "harness"),
      retryable: o.retryable === true,
      expected: o.expected === true,
      recovery: String(o.recovery ?? ""),
      message: String(o.message ?? ""),
    };
  }
  return {
    code: "HARNESS_INTERNAL",
    layer: "harness",
    retryable: false,
    expected: false,
    recovery: "Unexpected failure inside the harness wrapper.",
    message: e instanceof Error ? e.message : String(e),
  };
}

function emptyProvenance(operation: HarnessOperation, extra: Partial<HarnessProvenance> = {}): HarnessProvenance {
  return { operation, transport: "direct", requests: [], resolution: [], warnings: [], cached: false, ...extra };
}

/**
 * Run one harness workflow and return the raw envelope as `data`, with failures and
 * needs_input mapped to plain objects. Typed helpers below build on this.
 */
export async function runWorkflow<Op extends HarnessOperation>(
  operation: Op,
  input: WorkflowInputs[Op],
  options: RunOptions = {},
): Promise<HarnessResult<Envelope>> {
  const started = Date.now();
  const got = await getExecutor();
  if ("error" in got) return { ok: false, status: "error", error: got.error, provenance: emptyProvenance(operation, { durationMs: 0 }) };

  const useCache = options.cache !== false;
  const cacheKey = `${got.fingerprint}:${operation}:${JSON.stringify(input)}`;
  const hit = useCache ? resultCache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...(hit.result as HarnessResult<Envelope>), provenance: { ...hit.result.provenance, cached: true } };
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const execution = await got.executor.execute(operation, input as never, {
      signal,
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    });
    const envelope = execution.result as Envelope;
    const provenance = provenanceOf(operation, envelope);
    let result: HarnessResult<Envelope>;
    if (envelope.status === "needs_input") {
      result = {
        ok: false,
        status: "needs_input",
        summary: str(envelope.summary) ?? "The input needs clarification.",
        issues: provenance.resolution,
        provenance,
      };
    } else if (envelope.status === "error") {
      // Not produced by the direct executor in v0.1.26 (it throws), but part of the envelope contract.
      const err = rec(envelope.error);
      result = {
        ok: false,
        status: "error",
        error: {
          code: String(err?.code ?? "HARNESS_INTERNAL"),
          layer: String(err?.layer ?? "harness"),
          retryable: err?.retryable === true,
          expected: true,
          recovery: String(err?.recovery ?? ""),
          message: str(envelope.summary) ?? "",
        },
        provenance,
      };
    } else {
      const status = (["ok", "empty", "partial", "degraded"].includes(String(envelope.status)) ? envelope.status : "ok") as
        | "ok"
        | "empty"
        | "partial"
        | "degraded";
      result = { ok: true, status, ...(str(envelope.summary) ? { summary: str(envelope.summary) } : {}), data: envelope, provenance };
    }
    if (useCache && result.ok && (result.status === "ok" || result.status === "empty")) {
      if (resultCache.size >= CACHE_MAX_ENTRIES) resultCache.delete(resultCache.keys().next().value as string);
      resultCache.set(cacheKey, { at: Date.now(), result });
    }
    return result;
  } catch (e) {
    const timedOut = timeout.aborted && !options.signal?.aborted;
    const o = rec(e);
    return {
      ok: false,
      status: "error",
      error: toHarnessError(e, timedOut),
      provenance: emptyProvenance(operation, {
        correlationId: str(o?.correlationId),
        durationMs: num(o?.durationMs) ?? Date.now() - started,
      }),
    };
  }
}

function mapData<T>(result: HarnessResult<Envelope>, map: (envelope: Envelope) => T): HarnessResult<T> {
  return result.ok ? { ...result, data: map(result.data) } : result;
}

// --- Typed helpers ----------------------------------------------------------------------------

export type RankedOption = {
  rank: number;
  entityId: string;
  name: string;
  /** The caller's original option string (name or UUID) that resolved to this entity. */
  input?: string;
  type?: string;
  affinity?: number;
  popularity?: number;
  properties?: Record<string, unknown>;
};

/**
 * Rank a shortlist of ENTITIES (all of one Insights type) for an audience. Options must be entity names or
 * Qloo UUIDs, not tags: tag URNs are looked up as names and come back as needs_input/not_found.
 * Needs at least one of signals / location / demographic (demographic also requires location).
 */
export async function rank(
  opts: {
    options: string[];
    optionType: InsightsType;
    signals?: string[];
    location?: string;
    demographic?: string;
    includeTags?: string[];
    excludeTags?: string[];
  },
  run?: RunOptions,
): Promise<HarnessResult<RankedOption[]>> {
  const result = await runWorkflow(
    "rank",
    {
      options: opts.options,
      option_type: opts.optionType,
      ...(opts.signals?.length ? { signals: opts.signals } : {}),
      ...(opts.location ? { signal_location: opts.location } : {}),
      ...(opts.demographic ? { demographic: opts.demographic } : {}),
      ...(opts.includeTags?.length ? { include_tags: opts.includeTags } : {}),
      ...(opts.excludeTags?.length ? { exclude_tags: opts.excludeTags } : {}),
    },
    run,
  );
  return mapData(result, (envelope) => {
    const inputs = new Map(
      arr(rec(envelope.interpretation)?.options)
        .map(rec)
        .filter((o): o is Record<string, unknown> => o !== undefined)
        .map((o) => [String(o.entityId), str(o.input)] as const),
    );
    return arr(envelope.results)
      .map(rec)
      .filter((e): e is Record<string, unknown> => e !== undefined && str(e.entity_id) !== undefined)
      .map((e, i) => ({
        rank: i + 1,
        entityId: String(e.entity_id),
        name: str(e.name) ?? String(e.entity_id),
        ...(inputs.get(String(e.entity_id)) ? { input: inputs.get(String(e.entity_id)) } : {}),
        ...(str(e.subtype) ?? str(e.type) ? { type: str(e.subtype) ?? str(e.type) } : {}),
        ...(num(e.affinity) !== undefined ? { affinity: num(e.affinity) } : {}),
        ...(num(e.popularity) !== undefined ? { popularity: num(e.popularity) } : {}),
        ...(rec(e.properties) ? { properties: rec(e.properties) } : {}),
      }));
  });
}

export type TrendPoint = {
  date: string;
  populationPercentile?: number;
  populationRank?: number;
  populationRankVelocity?: number;
  velocityFoldChange?: number;
  populationPercentDelta?: number;
};
export type TrendSeries = { entityId: string; name: string; input?: string; match?: string; points: TrendPoint[] };

/** Time series from /v2/trending for 1-5 entities of one Insights type; dates are inclusive YYYY-MM-DD. */
export async function trends(
  opts: { entities: string[]; entityType: InsightsType; startDate: string; endDate: string; limit?: number },
  run?: RunOptions,
): Promise<HarnessResult<TrendSeries[]>> {
  const result = await runWorkflow(
    "trends",
    {
      entities: opts.entities,
      entity_type: opts.entityType,
      start_date: opts.startDate,
      end_date: opts.endDate,
      ...(opts.limit ? { limit: opts.limit } : {}),
    },
    run,
  );
  return mapData(result, (envelope) =>
    arr(envelope.series)
      .map(rec)
      .filter((s): s is Record<string, unknown> => s !== undefined)
      .map((s) => {
        const entity = rec(s.entity) ?? {};
        return {
          entityId: String(entity.entityId ?? ""),
          name: str(entity.name) ?? String(entity.entityId ?? ""),
          ...(str(entity.input) ? { input: str(entity.input) } : {}),
          ...(str(entity.match) ? { match: str(entity.match) } : {}),
          points: arr(s.points)
            .map(rec)
            .filter((p): p is Record<string, unknown> => p !== undefined && str(p.date) !== undefined)
            .map((p) => ({
              date: String(p.date),
              populationPercentile: num(p.population_percentile),
              populationRank: num(p.population_rank),
              populationRankVelocity: num(p.population_rank_velocity),
              velocityFoldChange: num(p.velocity_fold_change),
              populationPercentDelta: num(p.population_percent_delta),
            })),
        };
      }),
  );
}

export type HeatPoint = { geohash?: string; lat?: number; lon?: number; affinity?: number; affinityRank?: number; popularity?: number };

/** Heatmap cells (urn:heatmap) where one entity over-indexes inside `within`. Capped at 20 cells by the harness. */
export async function wherePopular(
  opts: { entity: string; entityType?: SearchType; within: string; limit?: number },
  run?: RunOptions,
): Promise<HarnessResult<HeatPoint[]>> {
  const result = await runWorkflow(
    "where_popular",
    {
      entity: opts.entity,
      within: opts.within,
      ...(opts.entityType ? { entity_type: opts.entityType } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    },
    run,
  );
  return mapData(result, (envelope) =>
    arr(envelope.results)
      .map(rec)
      .filter((c): c is Record<string, unknown> => c !== undefined)
      .map((c) => {
        const location = rec(c.location) ?? {};
        const query = rec(c.query) ?? {};
        return {
          geohash: str(location.geohash),
          lat: num(location.latitude) ?? num(location.lat),
          lon: num(location.longitude) ?? num(location.lon) ?? num(location.lng),
          affinity: num(query.affinity),
          affinityRank: num(query.affinity_rank),
          popularity: num(query.popularity),
        };
      }),
  );
}

export type DescribedEntity = { entityId: string; name: string; type?: string; popularity?: number; properties?: Record<string, unknown> };

/**
 * Resolve and describe one entity. Caveat (v0.1.26): when `entity` is already a Qloo UUID the harness skips the
 * detail lookup and returns only id/name/type; pass a name to get properties.
 */
export async function describe(
  opts: { entity: string; type?: SearchType },
  run?: RunOptions,
): Promise<HarnessResult<DescribedEntity | null>> {
  const result = await runWorkflow("describe", { entity: opts.entity, ...(opts.type ? { type: opts.type } : {}) }, run);
  return mapData(result, (envelope) => {
    const e = rec(arr(envelope.results)[0]);
    if (!e || !str(e.entity_id)) return null;
    return {
      entityId: String(e.entity_id),
      name: str(e.name) ?? String(e.entity_id),
      ...(str(e.subtype) ?? str(e.type) ? { type: str(e.subtype) ?? str(e.type) } : {}),
      ...(num(e.popularity) !== undefined ? { popularity: num(e.popularity) } : {}),
      ...(rec(e.properties) ? { properties: rec(e.properties) } : {}),
    };
  });
}

export type TagMatch = { id: string; name: string; type?: string; popularity?: number; affinity?: number };

/** Search Qloo's tag ontology (/v2/tags, semantic by default). Not scoped to a parent type. */
export async function findTags(
  opts: { query: string; semantic?: boolean; limit?: number },
  run?: RunOptions,
): Promise<HarnessResult<TagMatch[]>> {
  const result = await runWorkflow(
    "find_tags",
    { query: opts.query, ...(opts.semantic !== undefined ? { semantic: opts.semantic } : {}), ...(opts.limit ? { limit: opts.limit } : {}) },
    run,
  );
  return mapData(result, (envelope) =>
    arr(envelope.results)
      .map(rec)
      .filter((t): t is Record<string, unknown> => t !== undefined && str(t.id) !== undefined)
      .map((t) => ({
        id: String(t.id),
        name: str(t.name) ?? String(t.id),
        ...(str(t.type) ? { type: str(t.type) } : {}),
        ...(num(t.popularity) !== undefined ? { popularity: num(t.popularity) } : {}),
        ...(num(t.affinity) !== undefined ? { affinity: num(t.affinity) } : {}),
      })),
  );
}

export type CompareTag = { id: string; name: string; subtype?: string; score?: number; popularity?: number };

/** /v2/analysis/compare between two groups of entities (names or UUIDs). No location filter in v0.1.26. */
export async function compareAudiences(
  opts: { groupA: string[]; groupB: string[]; targetType?: InsightsType; limit?: number },
  run?: RunOptions,
): Promise<HarnessResult<CompareTag[]>> {
  const result = await runWorkflow(
    "compare_audiences",
    {
      group_a: opts.groupA,
      group_b: opts.groupB,
      ...(opts.targetType ? { target_type: opts.targetType } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    },
    run,
  );
  return mapData(result, (envelope) => {
    const results = envelope.results;
    const tags = Array.isArray(results) ? results : arr(rec(results)?.tags);
    return tags
      .map(rec)
      .filter((t): t is Record<string, unknown> => t !== undefined)
      .map((t) => ({
        id: String(t.tag_id ?? t.id ?? ""),
        name: str(t.name) ?? String(t.tag_id ?? t.id ?? ""),
        ...(str(t.subtype) ? { subtype: str(t.subtype) } : {}),
        ...(num(rec(t.query)?.score) !== undefined ? { score: num(rec(t.query)?.score) } : {}),
        ...(num(t.popularity) !== undefined ? { popularity: num(t.popularity) } : {}),
      }))
      .filter((t) => t.id);
  });
}
