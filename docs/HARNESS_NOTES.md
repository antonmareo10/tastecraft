# Qloo harness (`@qloo/qloo-harness` 0.1.26): probe notes

Branch `harness-probe`, 2026-10-16. Sources: the compiled package (`dist/qloo-tools.js`, `dist/workflow-executor.js`,
`dist/resolution-provider.js`, `dist/chunks/*`), the Qloo hackathon kit, and runs of every workflow against a logging
mock (`scripts/mock-qloo-harness.mjs`, synthetic data, dummy key). **No live Qloo call was made**: response shapes are
the documented ones from `docs/QLOO_API_NOTES.md`, so live behaviour (sparse data, extra fields) still needs checking.

Reproduce: `node scripts/harness-probe.mjs out.json` (every workflow plus edge cases; prints requests per case) and
`npx vitest run tests/qloo-harness.test.ts` (wrapper tests, 15 cases).

## 1. What the harness is, for our purposes

- `qloo exec` and `qloo mcp` both run `createDirectQlooWorkflowExecutorFromEnvironment()`. It's an in-process
  executor: input validation (TypeBox schema), then name → ID resolution, then 1+ GET requests, then a result envelope.
  Calling it from our server runs **the same code path** as the supported `qloo exec` surface, with no subprocess.
- The package has a single entry point (`"exports": { ".": ... }`), and `dist/index.js` imports everything statically,
  including the interactive agent built on `@earendil-works/pi-coding-agent`. Importing the executor alone isn't
  possible, so every importer loads the whole Pi SDK.
- HTTP client: GET only, `X-Api-Key`, `User-Agent: agentic-qloo-client/0.1.0`, plus `X-Correlation-Id`. Arrays are
  sent comma-joined. Timeout is 20 s per attempt, with up to 3 attempts on network errors, timeouts, 429 and 5xx.
  Backoff is 250/500 ms with jitter, or `Retry-After` capped at 30 s. Responses are capped at 5 MB. None of this is
  configurable through the env-based factory.
- Config it reads (env first, then `$QLOO_HOME/config` or `~/.qloo/config`): `QLOO_API_KEY`, `QLOO_BASE_URL`,
  `QLOO_TRUSTED_BASE_URL`, and `QLOO_RESOLUTION_PROVIDER` (`native` by default; `taste-resolver` needs
  `TASTE_RESOLVER_URL` and related variables).
  - **Default base URL is `https://api.qloo.com`.** Any other host is refused with "Custom Qloo base URL is not
    trusted" unless `QLOO_TRUSTED_BASE_URL` equals it exactly. HTTP is allowed only for loopback hosts.
  - Our `.env.local` points `QLOO_BASE_URL` at `https://hackathon.api.qloo.com`. `QLOO_API_NOTES.md` says hackathon
    keys get 401 on api.qloo.com. The kit's `.env.example`, on the other hand, sets only `QLOO_API_KEY`, which
    implies the harness default works with event keys. **Verify which host accepts the event key as soon as it
    arrives.**
- By default it appends JSONL logs under `$QLOO_HOME/agent/logs` (the observer). The wrapper turns this off.
- Resolution cache: the native resolver keeps outcomes in memory for 15 min (256 entries) per executor instance.
  There is **no response cache**.

## 2. The 9 workflows: exact requests (cold executor) and results

Defaults: `limit` = 10, max 20 for every workflow. Entity inputs can be names or Qloo UUIDs; tag inputs can be names or
`urn:tag:...`. "Resolution" lists the extra lookups the harness makes before the main call. A UUID costs one
`/entities` call, a name costs one `/search` call, and a tag URN costs nothing.

| workflow | resolution lookups | main request(s) | result payload |
|---|---|---|---|
| `recommend` | `signals`: `/search?query=&take=5` (untyped) or `/entities?entity_ids=<uuid>`. `signal_tags` / `include_tags` / `exclude_tags`: `/v2/tags?filter.query=&feature.semantic_search=true&take=20` | `GET /v2/insights` with `filter.type=urn:entity:<t>`, `take`, `signal.interests.entities`, `signal.interests.tags` + `operator.signal.interests.tags` (default `intersection`), `signal.location.query`, `signal.demographics.gender/age`, `filter.location.query`, `filter.tags` / `filter.exclude.tags` + operators (default `union`), and `feature.explainability=true` (default). | `results[]` compact entities (`entity_id,name,type,subtype,popularity,affinity,explainability?,properties{description,short_description,release_*,content_rating,duration,image,geocode,address,price_level,business_rating}`), plus top-level `explainability`. |
| `rank` | each option: `/search?query=&types=urn:entity:<option_type>&take=5` or `/entities`. `signals` as above. Tags: `/v2/tags` | `GET /v2/insights` with `filter.type`, `filter.results.entities=<option ids>`, `take=<#options>`, and `signal.interests.entities`, `signal.location.query`, `signal.demographics.*`, `filter.tags`, `filter.exclude.tags` | `results[]` compact entities in Qloo's order (by affinity). `interpretation.options[]` maps each input to `entityId`. |
| `describe` | `/search?query=&types=<type>&take=5` or `/entities` | `GET /entities?entity_ids=<id>`, **only when the input was a name**. For a UUID input it returns just `{entity_id,name,type}`. | `results[0]` compact entity; `status: "empty"` when there is none. |
| `where_popular` | as `describe` (`entity_type`) | `GET /v2/insights` with `filter.type=urn:heatmap`, `signal.interests.entities`, `filter.location.query=<within>`, `take` | `results[]` raw heatmap cells, sorted by `query.affinity` descending, max 20; `status: "empty"` when there are none. |
| `compare_audiences` | each member of `group_a` / `group_b`: `/search` (untyped) or `/entities` | `GET /v2/analysis/compare` with `a.signal.interests.entities`, `b.signal.interests.entities`, `take`, and optional `filter.type` (from `target_type`). **No location parameter.** | `results` = the raw `response.results`, bounded (`{tags:[{tag_id,name,type,subtype,popularity,query.score}]}`); no `result_count`. |
| `entity_tags` | each entity: `/search?types=` or `/entities` | `GET /v2/insights` with `filter.type=urn:tag`, `signal.interests.entities`, `take`. **No `filter.tag.types`, no location or demographic signal.** | `results[]` `{id,name,type,popularity,affinity}`. |
| `audience_demographics` | as `describe` | `GET /v2/insights` with `filter.type=urn:demographics`, `signal.interests.entities`, `take` | `results[]` raw rows (`{entity_id, query:{age:{...},gender:{...}}}`). |
| `trends` | each entity: `/search?types=urn:entity:<entity_type>` or `/entities` | **One `GET /v2/trending` per entity** with `filter.type`, `filter.start_date`, `filter.end_date`, `signal.interests.entities`, `take` | `series[]` = `{entity:{input,entityId,name,type,match}, points[]}`, where the points are raw `results.trending` rows (`date, population_percentile, population_rank, population_rank_velocity, velocity_fold_change, population_percent_delta`). **No `results` key.** `result_count` = number of series. |
| `find_tags` | none | `GET /v2/tags` with `filter.query`, `feature.semantic_search=true` (default), `take`. **No `filter.tag.types` or `filter.parents.types`.** | `results[]` `{id,name,type,popularity,affinity}` (parent types are dropped). |

### `rank`: can it rank dishes or tags for our audience?

**No.** `options` must be entities of one Insights type (`artist, book, brand, movie, person, place, podcast,
tv_show, videogame`). Each option is resolved through `/search` or `/entities`. A tag URN passed as an option is
searched as an entity name and comes back as `needs_input` / `not_found` (tested). Tags can only filter
(`include_tags` / `exclude_tags`); they can't be ranked. Valid audience inputs are `signals` (e.g. the restaurant's
UUID), `signal_location`, and `demographic`. A demographic requires `signal_location`, and at least one signal is
required. Up to 10 options per call, ranked in one request so the scores are comparable.

Useful for Tastecraft: rank a shortlist of **places** (rivals, pop-up venues), **artists** (e.g. Ticketmaster
line-ups for a live-music night), or **brands** (collab or supplier candidates) for the restaurant's audience. To rank
candidate dishes, keep the direct call (`/v2/insights?filter.type=urn:tag&filter.tag.types=urn:tag:specialty_dish:place,...&signal.interests.entities=<id>&signal.location.query=<city>`)
and intersect the result with the candidates on our side, as `tasteTags()` already does.

### `trends`

- Supports 1–5 entities of one Insights type (the same 9 types; **no `destination`**, and the spelling is
  `videogame`). Entities can be names or UUIDs.
- Dates are `YYYY-MM-DD` (schema regex), then checked as real calendar dates with `start_date <= end_date`. A bad date
  such as `2026-02-30` passes the schema but throws inside the tool, which surfaces as `HARNESS_INTERNAL` with
  `expected: false`, not `TOOL_INPUT`.
- There are no tag trends ("is natural wine rising?") and no rising/falling verdict. Callers interpret the points.
  Whether `/v2/trending` returns data for places on event keys is unknown.

## 3. Envelope and statuses

Every result has: `schema_version: "1.0-preview.1"`, `operation`, `status`, `query_intent`,
`execution{transport:"direct", transport_name, correlation_id, duration_ms}`, and (on success)
`provenance{source, endpoint, documentation, requests[{method,path,query}], transport}`. The provenance requests list
**only the main call(s)**, not the resolution lookups.

- `ok`: `interpretation` (what each input resolved to), `resolution{contract_version, provider, outcomes[]}`, `results`
  (or `series`), `result_count`, and optional `warnings`. Each outcome is
  `{input, status:"resolved", match:"identifier"|"exact"|"semantic", selected{id,name,type,popularity,description,address,...}, alternatives[]?, provenance{endpoint,strategy,cache_status?}, warnings?}`.
  `recommend`, `rank`, `entity_tags`, `audience_demographics`, `compare_audiences` and `find_tags` return `ok` **even
  with 0 results**.
- `empty`: only `describe` and `where_popular` emit it, when nothing came back.
- `needs_input`: `summary` plus `resolution.issues[]`, where each issue is
  `{input, kind:"ambiguous"|"not_found", input_kind:"entity"|"tag", field, scope?, purpose?, candidates[]?, provenance, warnings?}`.
  `results: []`, and **the main Qloo call is not sent**. Precondition failures use the same status with empty
  `issues`, e.g. "Ranking requires an entity, location, or demographic signal." or "Demographic Qloo signals require
  signal_location".
- `error`: the direct executor **throws** `QlooWorkflowExecutionError`
  `{code, layer, retryable, expected, recovery, correlationId, durationMs}` instead of returning an envelope. Only the
  MCP wrapper turns that into `status:"error", error{code,layer,retryable,recovery}`. `qloo exec` prints
  `{error, operation, correlation_id}`. Codes observed: `TOOL_INPUT` (schema), `QLOO_AUTH` (401/403),
  `QLOO_RATE_LIMIT` (429 after 3 attempts), `QLOO_UPSTREAM` (5xx after 3 attempts), `QLOO_CONTRACT` (other 4xx or
  bad JSON), `QLOO_TIMEOUT`, `QLOO_DNS`, `QLOO_CONNECT`, and `HARNESS_INTERNAL`.
- `partial` and `degraded` exist in the schema, but **no code path in 0.1.26 emits them**.

### How resolution decides (native provider)

- **Entity name**: `/search` (take 5). Exactly one case-insensitive exact-name hit gives `exact`, and the other hits
  become `alternatives`. Otherwise, if every input token (e.g. "Casa Mock Madrid") appears in the
  name/type/description/address of exactly one candidate, the result is `semantic`, with a warning. Otherwise it's
  `ambiguous` with up to 5 candidates (address and description included, which is enough for a picker), or
  `not_found` when the search returns nothing.
- **UUID**: must match the RFC-4122 pattern (version 1–5, variant 8–b). It then goes through `/entities`, giving
  `identifier`, else `not_found`. An ID outside that pattern is treated as a name.
- **Tag name**: `/v2/tags` with semantic search, take 20. Candidates are scoped to the target type through
  `parents[].type`. Only an exact name match resolves. Any purely semantic hit is `ambiguous` ("choose one before the
  workflow continues"), so in practice you call `find_tags` first and pass the URNs on.

## 4. Fit with Tastecraft's current calls

| current (`src/lib/qloo-tasks.ts`) | harness equivalent | gap |
|---|---|---|
| `findRestaurant` (`/search` take 8, re-ranked by city) | `describe` | Handles ambiguity better (candidate picker). But the compact entity **drops `tags` and `location` (lat/lon)**, which we need for the gaps and the map. |
| `audienceAffinity` | `recommend` | No `filter.exclude.entities` (the seed can come back), max 20, no `destination`, plus one extra lookup per ID. |
| `tasteTags` (tag families + city + lens) | `entity_tags` | No `filter.tag.types`, location or demographics. Not equivalent. |
| `tasteGaps` (take 50) | `recommend` | Capped at 20. |
| `tasteHeatmap` (all cells + lens) | `where_popular` | Max 20 cells, no lens. Too sparse for the map. |
| `audienceDemographics` | `audience_demographics` | Equivalent, plus one `/entities` lookup. |
| `compareAudiences` (city filter) | `compare_audiences` | No location filter. |
| (none) | `rank`, `trends`, `find_tags` | New capabilities. |

## 5. Next.js 16 / Vercel

- `npm run build` **fails** when the package is bundled. Turbopack can't resolve
  `new URL("../../resources/", import.meta.url)` in `dist/runtime/resources.js`.
- With `serverExternalPackages: ["@qloo/qloo-harness"]` in `next.config.ts`, the **build passes**. `next start` then
  serves `/api/harness` and runs `find_tags` against the mock correctly.
- Size: npm adds 142 packages, about 104 MB on disk exclusive to the harness (`node_modules` grew 537 → 672 MB).
  Most of it is the Pi SDK and its LLM SDKs (`@google/genai`, `openai`, `@anthropic-ai/sdk`), plus clipboard binaries
  for every platform.
- Traced serverless function (`.nft.json`): `/api/harness` is **19.0 MB / 2,948 files**, versus 2.6 MB / 172 files
  for `/api/agent`. That is well under Vercel's 250 MB limit, but much heavier.
- Cold start: importing the package takes about 1.6–2.4 s in bare Node and about 2.9 s on the first request in
  `next start` (Windows dev box). Warm calls add only a few ms. The wrapper imports it lazily, so only routes that run
  a workflow pay this cost.
- Engines: Node >= 22.19, so the Vercel project must run Node 22.x (recent) or 24.
- The kit's MCP starter says "Serverless functions are not a supported route". That is about spawning `qloo mcp`.
  In-process use inside a Vercel function works here, but it's outside the documented deployment routes.

## 6. The prototype wrapper: `src/lib/qloo-harness.ts`

- Builds the direct executor from **only** `QLOO_API_KEY`, `QLOO_BASE_URL` (default: the hackathon host, same as
  `qloo.ts`) and `QLOO_TRUSTED_BASE_URL`. The hackathon host is trusted automatically; a mock must be trusted
  explicitly. It ignores `~/.qloo/config` and disables the file-log observer, so the harness touches no files. Nothing
  logs the key.
- Typed helpers: `rank`, `trends`, `wherePopular`, `describe`, `findTags` and `compareAudiences`, plus
  `runWorkflow(op, input)` for the raw envelope and `harnessReadiness()` (no network).
- Returns a union. On success: `{ok:true, status, data}`. On `needs_input`: `{ok:false, status:"needs_input", issues}`,
  where `issues` are resolution records with candidates. On error: `{ok:false, status:"error", error}`, where `error`
  is a plain `{code, layer, retryable, expected, recovery, message}`. Config problems get `QLOO_AUTH` / `QLOO_CONFIG`,
  and an overall time budget (default 30 s) gets `QLOO_TIMEOUT`.
- Every result carries `provenance{operation, transport, correlationId, durationMs, requests, resolution[{input, status,
  match, selected, alternatives, candidates, endpoint, fromCache}], warnings, cached}`.
- `ok` and `empty` results are cached for 6 h, which matches `qloo.ts`. The harness itself doesn't cache responses.
- `/api/harness` returns readiness only. With `HARNESS_PROBE_ROUTE=1` it also runs `find_tags?q=`. It's a probe, not
  for production.

## 7. Recommendation

**Adopt partially, behind the wrapper. Keep `qloo.ts` for the core pipeline.**

- Use the harness for **`rank`** (shortlists of places, artists or brands for the restaurant's audience), **`trends`**
  (is an artist, brand or place rising), and **`find_tags`** (turning a word a user types into tag URNs). Optionally
  use **`describe`** as the disambiguation step when a restaurant name is ambiguous: show `needs_input` candidates,
  then continue with the chosen UUID through `findRestaurant` / `/entities` to get tags and coordinates.
- Keep the direct calls for affinity, taste tags, gaps, the heatmap, compare and demographics. The harness versions
  lose parameters we rely on (`filter.tag.types`, city/lens signals, `exclude.entities`, take > 20, `destination`) and
  add one lookup request per input.
- Main risks:
  1. 19 MB / ~2.9 s cold-start cost for a small slice of features, because of the bundled Pi SDK.
  2. A preview result contract (`1.0-preview.1`, v0.1.x). The version is pinned exactly; re-run the probe and tests
     before upgrading.
  3. The base-URL/key question (api.qloo.com vs the hackathon host) must be settled on the first live call.
  4. More quota per call (resolution lookups; `trends` makes 1 + N requests).
  5. Serverless is outside the kit's documented routes.
- If the cold start matters more than literal harness use, a lighter option is to implement `QlooToolClient` over our
  cached `qlooGet` and pass it to `createDirectQlooWorkflowExecutor(client, observer)`. That keeps one host config and
  one cache, but it still imports the package, and error classification would need re-mapping because
  `QlooClientError` isn't exported.
