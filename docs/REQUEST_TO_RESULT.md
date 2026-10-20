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
- **Used for:** the "Cravings" lists and the evidence behind each menu move.

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

## 6. What do locals love that this restaurant doesn't offer? (taste gaps, computed by Tastecraft)

```
GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=<RESTAURANT_ID>&filter.location.query=<city>&filter.exclude.entities=<RESTAURANT_ID>&take=50
```

- **Computed locally:** for the ~50 local places these guests love most, Tastecraft weights each place's tags by its affinity, ranks the tags and drops the ones the restaurant already carries. A gap is shown with the share of loved places that carry the tag and examples. This is Tastecraft's analysis of Qloo data, and it is labelled as such.

## 7. Where in the city does this taste live? (heatmap)

```
GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<RESTAURANT_ID>&filter.location.query=<city>
```

- **Used for:** the taste map. Geohash cells are decoded locally and the top distinct hotspots are named with OpenStreetMap (Nominatim) reverse geocoding. These become the target neighbourhoods for the local campaign.

## 8. From results to a playbook

1. Every name and score that Qloo returned in this run is recorded in an **evidence ledger** on the server.
2. Claude writes the playbook through a schema-validated `publish_playbook` tool call. Every evidence line must list the exact names and scores it relies on.
3. The server checks each cited name and score against the ledger (±1 on scores) and marks it **verified** (✓) or **not verified** (⚠) before the owner sees it. The header reports how many cited facts were verified.
4. The UI keeps the two layers apart: **Qloo evidence** (facts, with their check marks) and **Our read** (Tastecraft's interpretation, framed as bets to test).

## Failure handling

| Situation | What happens |
|---|---|
| Key missing or rejected (`QLOO_CONFIG`, `QLOO_AUTH`) | The run stops immediately with a plain message. No playbook is produced without data. |
| Rate limit (`QLOO_RATE_LIMIT`) | At most 4 Qloo requests in flight; a 429 is retried up to 3 attempts in total (honouring `retry-after`, capped at 10 s), like Qloo's official client; then a clear "wait a minute" message. |
| Timeout, network error or 5xx | One retry, then the gap is reported in the playbook's caveats. |
| Empty result | Reported as "No results"; the agent works with what it has and says so in caveats. |

Identical requests are cached privately on the server for six hours, to stay well inside the event quota.
