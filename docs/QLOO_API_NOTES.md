# Qloo API — implementation notes (hackathon)

Source: docs.qloo.com (reference + recipes), read 2026-10-16. Hackathon guide page updated 2026-10-07.
"UNKNOWN" = not documented. "CONFLICT" = docs disagree with each other; verify with a live call.

## 1. Basics

- Base URL: `https://hackathon.api.qloo.com` (hackathon keys return 401 on `api.qloo.com` / `staging.api.qloo.com`).
  Doc examples use `https://api.qloo.com`; swap the host.
- Auth: header `X-Api-Key: <key>`. Not `Authorization: Bearer` and not a query param (401 "No API key found in request").
- Method: **GET only, params in the query string.** Hackathon guide: POST + JSON body to `/v2/insights` fails
  ("No path matching request parameters"). So every POST-only feature below is unusable here.
- Arrays in GET: comma-separated string, e.g. `signal.interests.entities=ID1,ID2`.
- Paths: `/search`, `/entities`, `/v2/insights`, `/v2/tags`, `/v2/tags/types`, `/v2/audiences`, `/v2/audiences/types`,
  `/v2/analysis/compare`, `/v2/trending`, `/` (API info). `/v2/insights/search` does not exist.
  Do not use `/recommendations` or `/recs` (legacy, not supported).
- Unknown or invalid params are **silently ignored**: you get 200 with an empty `results.entities`, not an error.
- Errors seen in docs:
  - 401: wrong host or missing key.
  - 403 `"You do not have permission to access urn:entity:..."`: the entity type isn't enabled for the key.
  - `"at least one valid signal or filter is required"`: bad tag or audience IDs, or no signal or filter.
  - 400: a `*.query` locality or entity didn't resolve.
  - 404: no results.
  - 429: rate limit.
  - Error body schema: `{ "code": number, "reason": string, "message": string }`.
- Rate and quota numbers: UNKNOWN (the guide only says "high"; ask in Discord #api-help to raise them). Keys expire after judging.
- You can't filter response fields (they can be verbose, e.g. `akas`). Private server-side caching is allowed. Don't commit responses to a public repo.

## 2. Entity types / IDs

- Hackathon-supported `filter.type` for `/v2/insights`: `urn:entity:artist`, `book`, `brand`, `destination`, `movie`,
  `person`, `place`, `podcast`, `tv_show`, `video_game` (all prefixed `urn:entity:`).
- CONFLICT: the OpenAPI enum for filter.type is: `urn:entity:artist|book|brand|locality|movie|person|place|podcast|tv_show|videogame`,
  `urn:heatmap`, `urn:entity:audience` (deprecated).
  - It has no `destination`.
  - It spells the game type `videogame`; the hackathon guide spells it `video_game`.
  - Prefer the hackathon spelling and fall back to the other on 403.
- Other `filter.type` values documented on use-case pages: `urn:heatmap`, `urn:demographics`, `urn:tag`.
  - None of them is in the hackathon list, but all three work on the hackathon key: Tastecraft calls them on every run (see 7.7–7.9).
  - A 403 means the type isn't supported.
- `/search` `types` accepts the same enum plus legacy search-only `urn:entity:actor|album|author|director|locality`.
- Entity ID = uppercase UUID string, e.g. `FCE8B172-4795-43E4-B222-3B550DC05FD9` (Balthazar NYC).
- Tag ID = URN, e.g. `urn:tag:genre:place:restaurant:italian`.
- Audience ID = URN, e.g. `urn:audience:hobbies_and_interests:outdoors`.
- Locality = entity with subtype `urn:entity:locality`, e.g. New York City `81E61924-6CEE-4AB4-93D3-282A5C784AB8`.

## 3. GET /search — entity lookup by name

| param | format / notes |
|---|---|
| `query` | text to search, e.g. `Balthazar` |
| `types` | array, comma-separated entity types, e.g. `urn:entity:place` |
| `filter.location` | `latitude,longitude` pair (**lat first**, e.g. `40.742306,-74.003494`), WKT `POINT(lon lat)`, or a Qloo entity UUID |
| `filter.radius` | float, **miles** (not meters), default 10, min 0, max 100; only for geolocated categories |
| `filter.address` | partial string match; comma-separated terms OK (`123 Main St,New York,NY`) |
| `filter.tags` | comma-separated tag IDs; `operator.filter.tags` = `union` (default) or `intersection` |
| `filter.exists` | e.g. `external.resy`, `external.michelin` (pattern `^external\.\w+$`) |
| `filter.rating` | 0–5, the lowest business rating |
| `filter.popularity` | 0–1, the minimum popularity |
| `sort_by` | `match` (default), `distance`, or `popularity` |
| `page` | int 1–100, default 1 |
| `take` | int, must be < 200; the default is UNKNOWN |

Response (flat array, not `results.entities`):
```json
{ "success": true, "duration": 0.1,
  "results": [ { "name": "Balthazar", "entity_id": "FCE8B172-4795-43E4-B222-3B550DC05FD9",
                 "types": ["urn:entity:place"], "popularity": 0.998, "properties": { } } ] }
```
- `/search` returns `types` (an array). `/v2/insights` returns `type: "urn:entity"` plus a `subtype`.
- The full `properties` shape for a place in /search is UNKNOWN; the recipe shows `{}`.

**Restaurant by name in a city:**
`GET /search?query=Balthazar&types=urn:entity:place&filter.location=40.7128,-74.0060&filter.radius=10&take=5`
- Alternative: use `filter.address=New York`, or a locality UUID in `filter.location`.
- Alternative via insights (GET single string):
  `/v2/insights?filter.type=urn:entity:place&filter.results.entities.query=Balthazar&filter.location.query=New York City`.

## 4. GET /entities — lookup by ID

- `entity_ids`: array of UUIDs, e.g. `E12201A5-CC50-40AF-97AE-C54A2CA303F7,F6754C46-...`.
  - Comma-separated serialization is assumed; the docs only show an array.
  - The 400 example message is `"entity_ids must be specified."`
- External ID lookup params: `external.<ns>.ids` with ns in:
  facebook, goodreads, goodreads_author, igdb, imdb, instagram, isbn10, isbn13, itunes, lastfm, library_of_congress,
  metacritic, michelin, musicbrainz, rottentomatoes, soundcloud, spotify, tablet, twitch, twitter, wikidata, resy.
- Response: flat `results[]`, same item shape as /search, e.g.
  `{ "name", "entity_id", "types": ["urn:entity:artist"], "properties": { "external": { "spotify": { "id": "..." } } } }`.
- Pagination params: UNKNOWN (a recipe uses `take=1`).

## 5. GET /v2/tags — tag search (the only way to get valid tag IDs; there is no static list)

| param | notes |
|---|---|
| `filter.query` | partial string on the tag name, e.g. `italian`, `rooftop bar` |
| `filter.tag.types` | comma-separated exact tag types, e.g. `urn:tag:genre:place`, `urn:tag:cuisine:qloo` |
| `filter.parents.types` | comma-separated parent types (see below) |
| `feature.typo_tolerance` | bool, default false |
| `feature.semantic_search` | bool, default false (beta); use with `filter.query` |
| `filter.results.tags` | comma-separated tag IDs |
| `filter.popularity.min` / `filter.popularity.max` | 0–1 |
| `page` | 1–100 |
| `take` | 1–50, default 20 |

Notes:
- CONFLICT on `filter.parents.types`: the OpenAPI enum lists audience types, but the recipes and the Taste Analysis page pass entity types like `urn:entity:place`.

Response (recipe):
```json
{ "success": true, "results": { "tags": [
  { "id": "urn:tag:amenity:place:rooftop_bar", "name": "Rooftop Bar", "type": "urn:tag:amenity:place",
    "parents": [ { "type": "urn:entity:place" } ], "popularity": 0.95 } ] } }
```

Place and cuisine tag types (from the Schema & Taxonomy page):
- `urn:tag:genre:place`: e.g. `...:restaurant`, `...:restaurant:italian|japanese|american|asian|bakery|bar|barbecue|cafe|fine_dining|mediterranean|seafood|steak_house|vegan`, `...:hotel`, `...:museum`, `...:park`.
- `urn:tag:cuisine:qloo`, `urn:tag:category:place`, `urn:tag:dining_option:qloo`, `urn:tag:dining_options:place` (meal periods), `urn:tag:ambience:qloo`.
- More place tag types: `urn:tag:amenity:place`, `urn:tag:menu_highlight:qloo`, `urn:tag:specialty_dish:place`, `urn:tag:good_for:qloo`, `urn:tag:decor:qloo`, `urn:tag:setting:qloo`, `urn:tag:service_options:place`, `urn:tag:payments:place`.
- Recipe examples: `urn:tag:category:place:italian_restaurant`, `urn:tag:culinary_style:qloo:fast_food`.
- Docs spell Italian three ways: `urn:tag:genre:place:restaurant:italian`, `urn:tag:category:place:italian_restaurant` and `urn:tag:genre:restaurant:Italian`. Resolve IDs via `/v2/tags`; never hardcode them.
- Cuisine lookup: `GET /v2/tags?filter.query=italian&filter.tag.types=urn:tag:genre:place&take=10`.
  - Or use `filter.parents.types=urn:entity:place` instead of `filter.tag.types`.
- Brand genres: `urn:tag:genre:brand:<cat>[:<sub>]`, e.g. `urn:tag:genre:brand:food_and_beverage`.
- Media genres: `urn:tag:genre:media:<x>` (`comedy`, `horror`, `action`, `non_fiction`).

**GET /v2/tags/types**:
- Params: `filter.parents.types`, `page` (1–100), `take` (1–50).
- Response shape: UNKNOWN.

## 6. GET /v2/audiences, GET /v2/audiences/types

- `/v2/audiences` params:
  - `filter.query` (e.g. `sustainability`), `filter.audience.types` (e.g. `urn:audience:communities`).
  - `filter.parents.types`, `filter.results.audiences`, `filter.popularity.min` / `filter.popularity.max`.
  - `page` (1–100), `take` (1–50, default 20).
- Response (recipe):
  `{ "success": true, "results": { "audiences": [ { "id": "urn:audience:global_issues:sustainability", "entity_id": "...", "name": "Sustainability", "type": "urn:audience:global_issues", "parents": [] } ] } }`.
  CONFLICT: the OpenAPI schema says `results.entities[]`.
- **Pass the URN `id` (not `entity_id`) to `signal.demographics.audiences`.**
- `/v2/audiences/types` params: `filter.parents.types`, `page`, `take`. Response shape UNKNOWN.
- Audience type values (from the enum): `urn:audience:` + one of
  communities, global_issues, hobbies_and_interests, investing_interests, leisure, life_stage,
  lifestyle_preferences_beliefs, political_preferences, professional_area, spending_habits.

## 7. GET /v2/insights

Required: `filter.type`, plus at least one valid filter or signal.

### 7.1 Filters (common)

- `filter.tags`: comma-separated tag IDs. `operator.filter.tags` = `union` (default) or `intersection`.
- `filter.exclude.tags`, with operator `operator.exclude.tags`. The deep dive names it `operator.filter.exclude.tags`. Both default to `union`.
- `filter.exclude.entities`: comma-separated IDs to remove.
- `filter.results.entities`: comma-separated IDs. Restricts results to these, so you can read their affinity to the signal.
- `filter.results.entities.query`: a name string (GET: a single name).
- `filter.popularity.min` / `filter.popularity.max`: 0–1 percentile, e.g. 0.98.
- `filter.external.exists`: `resy`, `michelin` or `tablet`, comma-separated, with `operator.filter.external.exists`.
- `filter.exists` (deep dive only): `properties.image` or `properties.description`.
- Movie / TV:
  - `filter.release_year.min|max` (int), `filter.release_date.min|max` (YYYY-MM-DD).
  - `filter.content_rating`: e.g. `PG-13,R,TV-MA`.
  - `filter.release_country`, `filter.rating.min|max` (0–5).
- TV only: `filter.finale_year.*`, `filter.latest_known_year.*`.
- Books: `filter.publication_year.*`.
- Person: `filter.gender`, `filter.date_of_birth.*`, `filter.date_of_death.*`.

### 7.2 Filters (place / destination; location)

- `filter.location`: any of
  - WKT `POINT(lon lat)`: **longitude first**, e.g. `POINT(-73.99823 40.722668)`.
  - `POLYGON((lon lat, ...))`, closed (the last pair equals the first); also `MULTIPOLYGON`.
  - A single locality Qloo ID.
  - Deep dive only: a `latitude,longitude` pair (lat first).
- `filter.location.query`: fuzzy, case-insensitive locality **name** (e.g. `New York City`, `Lower East Side`, `The Big Apple`).
  - GET takes a single string.
  - It is not a UUID; use `filter.location` for IDs.
  - 400 if not found.
  - It is listed for Place in the Parameter Reference and used for places in 4 recipes, but missing from the Entity Type guide's Place table.
- `filter.location.radius`: integer, meters, max 800000; the schema default is 15000.
  - With a locality and no radius, the boundary is padded by min(10% of the locality's diameter, 2414 m).
  - `0` means strictly inside the boundary.
- `filter.exclude.location`: same formats as `filter.location`.
- `filter.exclude.location.query`: name string.
- `filter.exclude.location.radius`.
- `filter.location.geohash` / `filter.exclude.location.geohash`: prefix match on 12-character pygeohash values, e.g. `dr5rs`.
- `filter.geocode.name`: **exact** match on `properties.geocode.name` (the city).
- Also exact match: `filter.geocode.admin1_region` (e.g. `NY`), `filter.geocode.admin2_region` (e.g. `New York County`), `filter.geocode.country_code` (e.g. `US`).
- `filter.location.metro` (deep dive only): exact match on `properties.geocode.metro`.
- Price, rating and hours:
  - `filter.price_level.min|max`: int 1–4.
  - `filter.properties.business_rating.min|max`: 1–5.
  - `filter.hours`: `monday` … `sunday`.
- Hotel: `filter.hotel_class.min|max` (1–5).
- Hotel price range: CONFLICT on names. `filter.price_range.from|to` (deep dive and Entity Type guide) vs `.min|.max` (Parameter Reference); 0–1000000.
- Resy and Tripadvisor:
  - `filter.external.resy.rating.min|max`, `filter.external.resy.count.min|max`, `filter.external.resy.party_size.min|max`.
  - `filter.external.tripadvisor.rating.min|max`, `filter.external.tripadvisor.rating.count.min|max`.
- `filter.references_brand`: comma-separated brand IDs (places of that brand).

### 7.3 Signals

- `signal.interests.entities`: comma-separated entity IDs (any type; cross-domain is allowed).
  - Per-entity weights need POST (`[{ "entity": "<id>", "weight": 10 }]`), so they are unavailable in the hackathon.
  - Global weight: `signal.interests.entities.weight` = a number ≥0 or `very_low|low|mid|medium|high|very_high`.
- `signal.interests.entities.query`: **POST only**, so unusable. Its `resolve_to` option is `self|urn:reference:brand|both` in the reference vs `place|brand|both` in the deep dive.
- `signal.interests.tags`: comma-separated tag IDs.
  - `operator.signal.interests.tags`: `union` (scores by the best-matching tag) or `intersection` (empty means intersection).
  - `signal.interests.tags.weight`: global weight.
  - A recipe uses `signal.interests.tags.weights=20,7` (a parallel list in GET). It isn't in the Parameter Reference; unverified.
- `signal.demographics.age`, comma-separated buckets:
  - `24_and_younger`, `25_to_29`, `30_to_34`, `35_to_44`, `45_to_54`, `55_and_older`.
  - Legacy values also in the enum: `35_and_younger`, `36_to_55`.
  - Weight: `signal.demographics.age.weight`.
- `signal.demographics.gender`: `male` or `female`. Weight: `signal.demographics.gender.weight`.
- `signal.demographics.audiences`: comma-separated audience URNs. Weight: `signal.demographics.audiences.weight`.
- `signal.location`: WKT POINT/POLYGON or a locality ID. The docs call it "the geolocation to use for geospatial results", e.g. movies with high affinity in the Lower East Side. It works for every type.
  - `filter.location*` is the documented hard filter, for Place and Destination only.
- `signal.location.query`: a locality name.
- `signal.location.radius`: meters, max 800000. Docs advise avoiding it.
- `signal.location.weight`.
- `bias.trends`: `off|very_low|low|mid|medium|high|very_high`, default `medium`.
- `bias.content_based`: 0–1, default 0.5.
- `bias.quality`: places only. A number >0 or a weight string. Places without a quality score are dropped.
- Deep dive only:
  - `backfill.cross_domain.take` (1–20, default 20) and `backfill.content_based.take` (1–10, default 10).
  - `signal.interests.entities.include` and `filter.entities.query`.

### 7.4 Output

- `take`: default 20, max 50.
- `page`: 1–100, default 1. This is the recommended paging.
- `offset`: skip N results (alternative to `page`).
- `sort_by`:
  - `affinity`, `distance` (needs `filter.location`), `rating`, `quality` (places only).
- `diversify.by`: `properties.geocode.city`, `properties.geocode.metro`, or `subtype` (only with `filter.type=urn:tag`).
  - `diversify.take` ≥1 sets the per-group cap.
  - Set `take` ≥ groups × `diversify.take`.
- `feature.explainability=true`: see 7.9.

### 7.5 Entity response shape

Fields compiled from the basic, location and recipe examples:
```json
{ "success": true, "duration": 34,
  "results": { "entities": [ {
    "name": "Catch NYC", "entity_id": "8119141A-D38C-428E-819D-CAA5027120C2",
    "type": "urn:entity", "subtype": "urn:entity:place",
    "popularity": 0.998,
    "properties": { "description": "...", "image": { "url": "https://...jpg" },
                    "geocode": { "city": "Chicago" } },
    "tags": [ { "id": "urn:tag:keyword:media:multiverse", "name": "Multiverse", "type": "urn:tag:keyword:media" } ],
    "query": { "affinity": 0.97, "distance": 1817.0, "measurements": { "audience_growth": -0.04 } },
    "disambiguation": "...", "external": { "imdb": [ { "id": "tt6710474", "user_rating": 7.8 } ] }
  } ] },
  "query": { } }
```

Field notes:
- `query.affinity`: 0–1, or **null when no signal is given** (results are then ranked by popularity).
- `query.distance`: meters; present with a location filter; can be null.
- `popularity`: a 0–1 percentile at the entity top level.
- Movie `properties` include:
  - `release_year`, `release_date`, `description`, `content_rating`, `duration`.
  - `image.url`, `akas[{value, languages[]}]`, `short_descriptions[]`.
  - `production_companies[]`, `release_country[]`, `filming_location`, `websites[]`.
- Place `properties` nesting is UNKNOWN beyond `properties.geocode.{name, city, metro, admin1_region, admin2_region, country_code}` (from filter descriptions).
  - The Schema & Taxonomy page only shows a **flattened** place view with these fields: `address`, `city`, `admin1_region`, `admin2_region`, `country`, `country_code`, `metro`, `neighborhood`, `lat`, `lon`, `phone`, `website`, `menu_url`, `business_rating`, `price_level` (1–4), `currency`, `price_range.from|to`, `hotel_class`, `number_of_rooms`, `is_closed`, `description`, `short_description`, `url` (image).
  - In /search and insights responses Tastecraft reads `properties.address`, `properties.price_level`, `properties.business_rating`, `properties.image.url` and `location.lat|lon` (`toRestaurantMatch` and `toEntityRef` in src/lib/qloo-tasks.ts and src/lib/qloo.ts; they fall back to `properties.geocode` for coordinates).
- Top-level `query` echo:
  - `query.locality.signal` holds the matched locality for `*.location.query`.
  - `query.entities.signal` / `query.entities.exclude` are for the POST `.query` params.
  - CONFLICT: the heatmap example shows `query.localities.filter` instead.
- Some recipes show `properties.affinity` and `type: "urn:entity:<x>"` instead. Treat `query.affinity` + `subtype` as canonical, but read both defensively.

### 7.6 Recipes for this app

- Places with affinity to a place, restricted to a city:
  `/v2/insights?filter.type=urn:entity:place&signal.interests.entities=<PLACE_ID>&filter.location.query=New York City&take=10`
  - Add `filter.location.radius=0` for a strict boundary.
  - Add `filter.tags=<cuisine tag>` or `filter.geocode.name=<exact city>`.
  - Add `filter.exclude.entities=<PLACE_ID>` to drop the seed. Whether the seed is auto-excluded is UNKNOWN.
- Near a point: `filter.location=POINT(-74.0060 40.7128)&filter.location.radius=2000`, and optionally `sort_by=distance`.
- Brands / artists / movies with affinity to a place: the same `signal.interests.entities=<PLACE_ID>` with `filter.type=urn:entity:brand|artist|movie|tv_show`.
  - The Entity Type guide doesn't list `filter.location*` for those types.
  - Use `signal.location.query` to localize them instead.
- Top N per city: `diversify.by=properties.geocode.city&diversify.take=2&take=10`.
- Cold start: `filter.popularity.min=0.9&filter.location.query=...` (no signal; affinity is null).
- Destination requires `signal.interests.entities` (Entity Type guide).

### 7.7 Heatmap (`filter.type=urn:heatmap`; works on the hackathon key)

- Used by Tastecraft's taste map: `filter.type=urn:heatmap&signal.interests.entities=<PLACE_ID>&filter.location.query=<city>` (`tasteHeatmap` in src/lib/qloo-tasks.ts).
- It returns `results.heatmap[]`, one geohash cell per row with an affinity (the code accepts `location.geohash` or `geohash`, and `query.affinity`, `query.affinity_rank` or `affinity`). Without `take`, recorded runs got 535 to 1,072 cells per city.

- Required:
  - One of `filter.location.query` (e.g. `NYC`) or `filter.location` (WKT/locality UUID).
  - At least one of `signal.interests.entities` or `signal.interests.tags`.
- Optional:
  - `filter.location.radius`, `signal.demographics.age|gender|audiences`, `signal.demographics.audiences.weight`, `bias.trends`, `take`.
  - `output.heatmap.boundary`: default geohashes; also "city or neighborhood". The exact values are UNKNOWN except `urn:geohash` (referenced) and the example `urn:entity:locality`.
  - `heatmap.dimensions`: comma-separated `quality,popularity,hotel_class,price_level`. Requires `output.heatmap.boundary=urn:geohash`.
    - Each dimension adds `<dim>_affinity_rank` (0–1) and `<dim>_affinity` (percent rank). Their position in the object is UNKNOWN.
  - `filter.dimensions.price_level` (1–4 list) and `filter.dimensions.hotel_class` (1–5 list) add `<dim>_count_affinity(_rank)`.

Example: `/v2/insights?filter.type=urn:heatmap&filter.location.query=NYC&signal.interests.entities=<ID>`
```json
{ "success": true,
  "results": { "heatmap": [
    { "location": { "latitude": 40.591736, "longitude": -73.756714, "geohash": "dr5wct" },
      "query": { "affinity": 1, "affinity_rank": 0.9976, "popularity": 0.9717 } } ] },
  "query": { "localities": { "filter": { "entity_id": "81E61924-6CEE-4AB4-93D3-282A5C784AB8", "name": "New York",
      "subtype": "urn:entity:locality", "location": { "lat": -73.93889, "lng": 40.66320 },
      "popularity": 1, "disambiguation": "New York, New York, United States of America" } } },
  "duration": 75 }
```

Field meanings:
- `affinity`: interest in the signal at this cell vs other entities locally and globally.
- `affinity_rank`: the signal vs itself across cells; where it over- or under-performs.
- `popularity`: the cell's signal-density percentile.
- Geohash length varies: examples show 6 (`dr5wct`) and 7 (`dr5rsj6`) characters, from dynamic density.
- The MUJI example returned `affinity: 0, popularity: 0` with no `affinity_rank`, so treat every field as optional.
- The max `take` for heatmaps is UNKNOWN; the default already returns hundreds of cells per city (see above).

### 7.8 Demographics (`filter.type=urn:demographics`; works on the hackathon key)

- Used by Tastecraft's audience profile with `signal.interests.entities=<PLACE_ID>` (`audienceDemographics` in src/lib/qloo-tasks.ts); the response matches the shape below.

- Request: `signal.interests.entities=<ID>` and/or `signal.interests.tags=<TAG>`.
- Response has one block per input:
```json
{ "success": true, "results": { "demographics": [ { "entity_id": "B8BEE72B-B321-481F-B81A-A44881D094D6",
    "query": { "age": { "24_and_younger": -0.09, "25_to_29": 0.36, "30_to_34": 0.70, "35_to_44": 0.17,
                        "45_to_54": -0.53, "55_and_older": -0.32 },
               "gender": { "male": 0.16, "female": -0.16 } } } ] }, "duration": 77 }
```
- Positive = over-indexes, negative = under-indexes. The numeric range is UNKNOWN (examples fall within about −0.53 to 0.7).
- For a tag input, `entity_id` holds the tag URN.

### 7.9 Taste analysis (`filter.type=urn:tag`; works on the hackathon key)

- Used by Tastecraft's taste tags (`tasteTags` in src/lib/qloo-tasks.ts: `filter.tag.types` = a tag family, `signal.interests.entities`, `signal.location.query`) and by the benchmark's affinity check (`filter.results.tags`); the response matches the shape below.

- Inputs: one or more of `signal.interests.entities`, `signal.interests.tags`, `signal.demographics.audiences`, `signal.location(.query)`, `filter.tag.types`, `filter.parents.types` (e.g. `urn:entity:movie,urn:entity:tv_show`).
- Output params: `take`, `offset`, `diversify.by=subtype` + `diversify.take`.
- Example: `/v2/insights?filter.type=urn:tag&filter.tag.types=urn:tag:ambience:qloo&signal.interests.entities=<PLACE_ID>&take=10`
- Response: `results.tags[]` items:
  `{ "tag_id": "urn:tag:ambience:qloo:intimate", "name": "Intimate", "types": [...], "subtype": "urn:tag:ambience:qloo", "tag_value": "urn:tag:...", "query": { "affinity": 0.992 } }`.
  - The key here is `tag_id`, not `id`. With no signal, `query` is `{}`.

### 7.10 Explainability (`feature.explainability=true`; default false)

- Each result gets `query.explainability`: which input entities (`signal.interests.entities`) contributed, with scores normalized 0–1.
  - Scores ≥0.1 are always included; lower ones may be omitted.
- The top-level `query.explainability` gives each input's average influence across top-N subsets (top 3, 5, 10, all).
- If it can't be computed: `query.explainability.warning`, and results still return.
- **Exact JSON keys and nesting: UNKNOWN** (no example in the docs). Parse defensively and log a live sample.

## 8. Analysis and trends

- **GET /v2/analysis/compare**
  - Required: `a.signal.interests.entities` and `b.signal.interests.entities` (comma-separated IDs). Each side accepts insights params with an `a.` / `b.` prefix.
  - Optional:
    - `filter.type` (array), `filter.subtype` (`urn:tag:occupation` or `urn:tag:genre`), `model` (`descriptive` or `predictive`).
    - `filter.location.query`, `filter.location.radius`, `filter.exclude.location.query`, `filter.exclude.location.radius`.
    - `take` (1–50), `page`, `offset`.
  - Response (recipe): `{ "duration": 0.42, "results": { "tags": [ { "tag_id": "urn:tag:style:qloo:athletic", "name": "Athletic", "type": "urn:tag", "subtype": "urn:tag:style:qloo", "popularity": 0.91, "query": { "score": 0.729 } } ] } }`.
  - It always returns tags. Per the recipe there is no `success` key; the OpenAPI schema claims a generic `{success, duration, results[]}` (CONFLICT).
- **GET /v2/trending**
  - Required: `filter.type`, `filter.start_date` and `filter.end_date` (YYYY-MM-DD).
  - Optional: `signal.interests.entities`, `take` (1–50), `offset`, `page`.
  - Schema response: `results.trending[] { date, population_percentile, population_rank, population_rank_velocity, velocity_fold_change, population_percent_delta }`, sorted by date descending.
  - CONFLICT: the recipe (no entity) shows `results.entities[]` with `properties.trend_rank`.

## 9. Gotchas

1. Hackathon host only. GET only. Header `X-Api-Key`.
2. Coordinate order differs by format:
   - WKT is **lon lat**: `POINT(-73.99 40.72)`.
   - A plain pair is **lat,lon**: `40.74,-74.00` (/search `filter.location`, and the deep dive for insights).
   - In the heatmap example the locality `location` has `lat`/`lng` **swapped**: lat=-73.9 is actually the longitude. Don't trust it; cell `latitude`/`longitude` are correct.
3. Radius units: `/search filter.radius` is in **miles** (max 100). Insights `filter.location.radius` is in **meters** (max 800000).
4. Invalid or unsupported params are silently ignored, giving 200 with an empty array. Validate against the Entity Type guide (§7.1–7.2).
5. Tag and audience IDs must come from `/v2/tags` / `/v2/audiences`. Freeform strings cause the error "at least one valid signal or filter is required".
6. `filter.location.query` needs a name, not a UUID. Locality IDs go in `filter.location`. It returns 400 if the name doesn't resolve.
7. Use `filter.location*` for "places in city X" (Place and Destination only). `signal.location*` is a geo signal and works for all types (e.g. artists popular in NYC).
8. Response containers differ:
   - `/search` and `/entities`: `results[]`.
   - Insights: `results.entities[]`, `results.heatmap[]`, `results.demographics[]` or `results.tags[]`.
   - Tags: `results.tags[]`. Audiences: `results.audiences[]` (recipe).
9. Tag objects: `{id,name,type}` in entities and in `/v2/tags`, but `{tag_id,name,subtype,types,query}` in `urn:tag` insights and compare results.
10. `query.affinity` is null without a signal. Handle `null`, missing and `properties.affinity` variants.
11. `take` max is 50 for insights, tags and audiences; `/search` allows <200; `page` max is 100.
12. Entity type spellings: `video_game` vs `videogame`, and `destination` vs `locality`. A 403 means the type isn't enabled.
13. Per-entity weights and `*.query` arrays need POST, which is unsupported. Use comma-separated IDs plus the global `*.weight` params.
14. Hackathon data may be sparse for some entities or regions; an empty result is not necessarily a bug.

## 10. UNKNOWN / to verify live

- Place fields beyond the ones the code reads (see section 7 above), e.g. opening hours.
- The exact JSON shape of explainability.
- `output.heatmap.boundary` values for city and neighborhood, and where heatmap dimension columns go in the response (Tastecraft uses the default geohash cells and no dimensions).
- Which spelling works: `urn:entity:video_game` or `videogame`.
- The demographics score range.
- The default `take` for /search. Pagination for /entities. Response shapes for /v2/tags/types and /v2/audiences/types.
- Rate-limit numbers.
- Whether the seed entity is excluded from its own recommendations.
- Whether the `signal.interests.tags.weights` GET param is supported.
