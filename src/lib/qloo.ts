// Thin, cached client for the Qloo hackathon API.
// Docs: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
// - Base URL: https://hackathon.api.qloo.com (hackathon keys do not work elsewhere)
// - Auth: X-Api-Key header. All endpoints used here are GET with query-string params.

import type { EntityRef } from "./types";

const BASE_URL = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const TTL_MS = 6 * 60 * 60 * 1000; // private server-side cache (allowed by Qloo's FAQ)

type Params = Record<string, string | number | boolean | undefined | null>;

// Failure codes follow the official qloo-harness naming so errors read the same across Qloo tools.
export type QlooErrorCode = "QLOO_AUTH" | "QLOO_RATE_LIMIT" | "QLOO_TIMEOUT" | "QLOO_CONNECT" | "QLOO_BAD_REQUEST" | "QLOO_UPSTREAM" | "QLOO_CONFIG";

export class QlooError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: QlooErrorCode = "QLOO_UPSTREAM",
    public retryable = false,
  ) {
    super(message);
  }
}

function errorFor(status: number, path: string, body: string): QlooError {
  if (status === 401 || status === 403)
    return new QlooError(status, `Qloo rejected the API key (${status}). Check QLOO_API_KEY; retrying will not help.`, "QLOO_AUTH");
  if (status === 429) return new QlooError(status, "Qloo rate limit reached (429). Wait a minute before trying again.", "QLOO_RATE_LIMIT", true);
  if (status >= 500) return new QlooError(status, `Qloo is having trouble (${status} on ${path}). Try again shortly.`, "QLOO_UPSTREAM", true);
  return new QlooError(status, `Qloo ${status} on ${path}: ${body}`, "QLOO_BAD_REQUEST");
}

const cache = new Map<string, { at: number; value: unknown }>();

function buildUrl(path: string, params: Params): string {
  const url = new URL(path, BASE_URL);
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(key, String(v));
  }
  return url.toString();
}

export function qlooConfigured(): boolean {
  return Boolean(process.env.QLOO_API_KEY);
}

export async function qlooGet<T = unknown>(path: string, params: Params = {}): Promise<T> {
  const apiKey = process.env.QLOO_API_KEY;
  if (!apiKey) throw new QlooError(500, "QLOO_API_KEY is not configured on the server.", "QLOO_CONFIG");
  const url = buildUrl(path, params);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  // At most one retry, and only for transient failures (rate limit with a short wait, 5xx, network).
  for (let attempt = 0; ; attempt++) {
    let err: QlooError;
    try {
      const res = await fetch(url, {
        headers: { "X-Api-Key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const json = (await res.json()) as T;
        cache.set(url, { at: Date.now(), value: json });
        return json;
      }
      err = errorFor(res.status, path, (await res.text()).slice(0, 300));
      const wait = Number(res.headers.get("retry-after"));
      if (err.code === "QLOO_RATE_LIMIT" && !(wait > 0 && wait <= 5)) err.retryable = false;
      if (attempt === 0 && err.retryable) {
        await new Promise((r) => setTimeout(r, wait > 0 ? wait * 1000 : 800));
        continue;
      }
    } catch (e) {
      if (e instanceof QlooError) throw e;
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      err = timedOut
        ? new QlooError(0, `Qloo did not answer within 20 s on ${path}.`, "QLOO_TIMEOUT", true)
        : new QlooError(0, `Could not reach Qloo (${e instanceof Error ? e.message : String(e)}).`, "QLOO_CONNECT", true);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Response normalisation. Qloo entities share a common shape; we keep only what
// the agent and the UI need, so prompts stay small and the UI stays simple.

export type RawTag = { id?: string; tag_id?: string; name?: string; type?: string; subtype?: string };
export type RawEntity = {
  entity_id?: string;
  id?: string;
  name?: string;
  types?: string[];
  subtype?: string;
  popularity?: number;
  query?: { affinity?: number; [k: string]: unknown };
  properties?: {
    address?: string;
    business_rating?: number;
    price_level?: number;
    image?: { url?: string };
    geocode?: { city?: string; name?: string; country_code?: string };
    [k: string]: unknown;
  };
  location?: { lat?: number; lon?: number; lng?: number };
  tags?: RawTag[];
  [k: string]: unknown;
};

export function entityId(e: RawEntity): string {
  return String(e.entity_id ?? e.id ?? "");
}

export function tagName(t: RawTag): string {
  return String(t.name ?? t.id ?? t.tag_id ?? "");
}

export function toEntityRef(e: RawEntity, maxTags = 6): EntityRef {
  const props = e.properties ?? {};
  const subtitle =
    (typeof props.address === "string" && props.address) ||
    [props.geocode?.name, props.geocode?.city].filter(Boolean).join(", ") ||
    undefined;
  return {
    entity_id: entityId(e),
    name: e.name ?? "Unknown",
    affinity: typeof e.query?.affinity === "number" ? e.query.affinity : undefined,
    popularity: typeof e.popularity === "number" ? e.popularity : undefined,
    subtitle: subtitle || undefined,
    tags: (e.tags ?? []).map(tagName).filter(Boolean).slice(0, maxTags),
    image: props.image?.url,
  };
}

export function entitiesFrom(json: unknown): RawEntity[] {
  const j = json as { results?: { entities?: RawEntity[] } | RawEntity[]; entities?: RawEntity[] };
  if (Array.isArray(j?.results)) return j.results;
  if (j?.results && Array.isArray((j.results as { entities?: RawEntity[] }).entities)) {
    return (j.results as { entities: RawEntity[] }).entities;
  }
  if (Array.isArray(j?.entities)) return j.entities;
  return [];
}
