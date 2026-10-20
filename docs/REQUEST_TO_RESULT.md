# From request to result (redacted)

This walks through one Tastecraft run, from the owner's form to the published playbook, showing every Qloo request the agent makes, which entity and tag choices it makes along the way, and how each result is used. The API key travels only in the `X-Api-Key` header from the server; it never reaches the browser, a prompt or a log. Qloo responses are not reproduced here, in line with the hackathon API terms. Placeholders such as `<RESTAURANT_ID>` stand in for real entity IDs.

**Owner's input:** restaurant name, city, a goal (for example "Fill quiet weeknights"), an optional audience lens (age bucket or gender) and the playbook language. Nothing about any individual guest is collected or sent to Qloo: the only signal is the restaurant itself, a public place entity.

## 1. Resolve the restaurant to one Qloo entity

```
GET /search?query=<name> <city>&types=urn:entity:place&take=8
```

- **Choice:** a restaurant name is ambiguous (chains, branches, similar names), so Tastecraft scores each candidate on name similarity (accents, case and apostrophes ignored) and on whether its address is in the requested city. It labels the result *exact*, *close* or *best guess*, and *ambiguous* when two candidates fit equally well, such as two branches with the same name.
- **Shown to the owner:** a "Qloo match" badge on the playbook. When the match is uncertain, the alternatives are listed under "Not your restaurant?"; picking one re-runs the analysis with that entity, and the owner's pick always wins over the agent's. If the picked entity is not among the search results, Tastecraft looks it up directly:

```
GET /entities?entity_ids=<RESTAURANT_ID>
```

## 2. Who else do these guests love? (cross-domain taste DNA)

```
GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=<RESTAURANT_ID>&filter.location.query=<city>&filter.exclude.entities=<RESTAURANT_ID>&take=12
GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<RESTAURANT_ID>&signal.location.query=<city>&take=12
```

- **Choice:** places are *filtered* to the city, because a restaurant's local peers are what matter for menu and collaboration ideas. Every other domain (artist, brand, movie, TV show, podcast, book, destination) is only *localised* with a location signal, because tastes in music or brands are not bound to the city's borders. The restaurant itself is excluded from its own results.
- **Used for:** the taste constellation and the "What your guests also love" lists (0–100 affinity), the playlist, collaboration partners and the closest rival.
- **Optional lens:** `signal.demographics.age` / `signal.demographics.gender` when the owner targets a specific audience.

## 3. What does this audience crave here? (tags)

```
GET /v2/insights?filter.type=urn:tag&filter.tag.types=urn:tag:specialty_dish:place,urn:tag:menu_highlight:qloo&signal.interests.entities=<RESTAURANT_ID>&signal.location.query=<city>&take=15
```

- **Choice:** Qloo has many tag families, and "jazz" or "brunch" can exist in several of them. Tastecraft asks three explicit families, never a free-text tag:
  - **dishes:** `specialty_dish:place`, `menu_highlight:qloo`
  - **cuisines:** `genre:place`, `cuisine:qloo`
  - **vibe:** `ambience:qloo`, `good_for:qloo`, `setting:qloo`
- **Used for:** the cuisine and vibe lists (shown in Qloo's order) and evidence behind menu moves. These affinities sit near 100 for whatever is popular everywhere (for example fries or tiramisu), so they are not used on their own to pick dishes; step 6 adds the city contrast.

## 4. Who are they? (demographics)

```
GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<RESTAURANT_ID>
```

- **Used for:** the "Who over-indexes" chart: age buckets and gender above or below the average. It is shown as an aggregate skew, never as a statement about a person.

## 5. What sets this crowd apart from the closest rival?

```
GET /v2/analysis/compare?a.signal.interests.entities=<RESTAURANT_ID>&b.signal.interests.entities=<RIVAL_ID>&filter.location.query=<city>&take=20
```

- **Choice:** the agent picks the rival from step 2: a nearby place with a similar cuisine and price and high affinity.
- **What we read:** with one place per side, the response lists each place's own Qloo tags (`results.a`, `results.b`). Tastecraft shows the tags only one of the two carries, compared by name (a "Deli" genre on one side and a "Deli" cuisine on the other count as shared), and drops payment, access and service-option tags. The merged `results.tags[].query.score` is an undocumented sigmoid weight (tags both places share all sit at 0.731), so it only orders the tags and is never shown as a number.
- **Used for:** the "Head-to-head" section and the positioning of the menu moves. It describes how Qloo characterises each place, not a measured difference between the two audiences.

## 6. What does this crowd favour that the city at large doesn't? (crowd vs city, computed by Tastecraft)

```
GET /v2/insights?filter.type=urn:entity:place&filter.tags=urn:tag:genre:place:restaurant&filter.location.query=<city>&filter.exclude.entities=<RESTAURANT_ID>&signal.interests.entities=<RESTAURANT_ID>&take=50&page=1..3
GET /v2/insights?filter.type=urn:entity:place&filter.tags=urn:tag:genre:place:restaurant&filter.location.query=<city>&filter.exclude.entities=<RESTAURANT_ID>&take=50&page=1..3
```

- **Choice:** the first query returns the ~150 restaurants in the city this audience has the highest affinity for (the *crowd*); the second, the same query without the audience signal, returns the city's ~150 most popular restaurants (the *baseline*). Both are restricted to restaurants so hotels, museums and venues do not distort the comparison.
- **Computed locally:** for every tag (cuisine, format, vibe) and every food term in the places' menu tags (specialty dishes, menu highlights), Tastecraft compares the share of crowd restaurants that carry it with the share of baseline restaurants that do (lift, add-one smoothed). Tag affinities from step 3 are near 100 for whatever is popular everywhere; this contrast shows what is specific to this crowd.
- **Used for:** the agent's taste gaps (over-represented tags the restaurant lacks) and menu terms the crowd favours or avoids; the "On your crowd's menus" card; and, at publish time, the **crowd lift** of the plan's dishes and of the no-Qloo baseline's dishes (src/lib/lift.ts).

## 7. Where in the city does this taste live? (heatmap)

```
GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<RESTAURANT_ID>&filter.location.query=<city>
```

- **Used for:** the taste map. Geohash cells are decoded locally and the top distinct hotspots are named with OpenStreetMap (Nominatim) reverse geocoding. These become the target neighbourhoods for the local campaign.

## 8. From results to a playbook

1. Every name and score that Qloo returned in this run is recorded in an **evidence ledger** on the server.
2. Claude writes the playbook through a schema-validated `publish_playbook` tool call. Every evidence line must list the exact names and scores it relies on. If the streamed JSON is malformed, the last step is retried once with server-validated input.
3. The server checks each cited name and score against the ledger (±1 on scores) and marks it **verified** (✓) or **not verified** (⚠) before the owner sees it. The header reports how many cited facts were verified.
4. The server computes the **crowd lift** of the three dishes from their names and the two restaurant sets of step 6, and the same score for the dishes of the same model's answer without Qloo. The model never writes these numbers.
5. The UI keeps the layers apart: **Qloo evidence** (facts, with their check marks), the crowd lift (computed), and **Our read** (Tastecraft's interpretation, framed as bets to test).

## Failure handling

| Situation | What happens |
|---|---|
| Key missing or rejected (`QLOO_CONFIG`, `QLOO_AUTH`) | The run stops immediately with a plain message. No playbook is produced without data. |
| Rate limit (`QLOO_RATE_LIMIT`) | At most 4 Qloo requests in flight; a 429 is retried up to 3 attempts in total (honouring `retry-after`, capped at 10 s), like Qloo's official client; then a clear "wait a minute" message. |
| Timeout, network error or 5xx | One retry, then the gap is reported in the playbook's caveats. |
| Empty result | Reported as "No results"; the agent works with what it has and says so in caveats. |

Identical requests are cached privately on the server for six hours, to stay well inside the event quota.
