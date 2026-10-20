# Tastecraft — the taste data team for independent restaurants

> Chains have insight teams. Independent restaurants decide their menu, their events and their marketing on gut feel.
> **Tastecraft is an AI agent that reads Qloo's taste graph around a restaurant and turns it into decisions an owner can act on this week** — three dishes to test, an event, a ready-to-post campaign aimed at the right neighborhoods, and a supplier shopping list — with the Qloo evidence behind every call.

**Live demo:** **https://tastecraft-xi.vercel.app** · Built for the Qloo Agentic Hackathon (2026)

## Judge in 60 seconds

1. Open the live demo and click **Gjelina, Los Angeles** (or any of the three) under *Instant replays of real runs*. Each is a recorded real run (Qloo + Claude), replayed in about 15 seconds.
2. Look at the **crowd lift** badge under the headline: how much more often the restaurants this crowd loves serve the proposed dishes than the city's most popular restaurants, next to the same score for the same model *without* Qloo.
3. Scroll to **Three dishes to test**: each dish shows its lift and the local-menu counts behind it, and every Qloo fact is marked as checked against the run's own Qloo responses.
4. **Generic AI vs. Tastecraft** scores both answers with the same formula. **Cravings** shows what is specific to this crowd ("On your crowd's menus" vs the city), and **Head-to-head** shows what only this restaurant, or only its closest rival, is known for.
5. Want it live? Type any restaurant and city. A live run takes about **2 minutes** (median 128 s over 5 runs, 102–178 s) and live runs are capped per day; replays are always instant.

The numbers behind the claim are in **[eval/SUMMARY.md](eval/SUMMARY.md)**: on 8 restaurants in 8 cities, the same model's dishes score **×0.91** crowd lift on their own, **×1.02** when given Qloo affinity data, and **×2.44** with Tastecraft's crowd-vs-city contrast (better than the model alone in 7 of 8); recorded full-agent playbooks score **×3.07** vs **×0.90** for their own no-Qloo answers (n = 3).

## How this maps to the judging criteria

| Criterion | Where to look |
|---|---|
| **Technological implementation** (how thoroughly and skillfully Qloo is used) | Eight Qloo workflows over `/search`, `/entities`, `/v2/insights` (entity, tag, demographics and heatmap outputs) and `/v2/analysis/compare` ([below](#how-tastecraft-uses-qloo)); a crowd-vs-city contrast built from two Qloo queries that separates what a crowd favours from what is popular everywhere ([src/lib/lift.ts](src/lib/lift.ts)); every cited fact verified against the run's own Qloo responses ([src/lib/ledger.ts](src/lib/ledger.ts)); bounded retries and request smoothing like Qloo's official client; 97 unit tests (no keys, no network) and CI. |
| **Design** | Streaming agent log, live playbook draft, taste constellation, taste map, per-dish evidence with ✓/⚠, side-by-side with/without Qloo, PDF export, English/Spanish. |
| **Potential impact** | Independent restaurants (7 in 10 US restaurants are single-unit) get an insight team's output: dishes, an event, a campaign, a shopping list and a week plan. MCP endpoint so POS or reservation assistants can call it. |
| **Quality of the idea** (creative, non-obvious use of Qloo) | Uses the audience's *other* tastes (places, music, brands) and contrasts them with the city to find what is specific to this crowd — for example, Katz's guests' other favourite places are cheap pizza slices, hot-dog counters and dive bars, which leads to a weeknight pub-snack menu rather than more deli classics. |

## How this maps to Qloo's submission guide

| Qloo kit asks for | Where it is |
|---|---|
| A short product problem statement | The top of this README and [/about](src/app/about/page.tsx) |
| The Qloo workflows used and why | [How Tastecraft uses Qloo](#how-tastecraft-uses-qloo) |
| A redacted request-to-result explanation, with entity and tag choices | [docs/REQUEST_TO_RESULT.md](docs/REQUEST_TO_RESULT.md) |
| A demo with no credentials or personal data | The live demo and its instant replays of real runs |
| Setup another participant can run from a clean environment | [Run it locally](#run-it-locally), including a no-keys mode |
| Known limitations, including what the results do not establish | [Known limitations](#known-limitations-what-the-results-do-not-establish) |
| Data handling | [Qloo data handling](#qloo-data-handling) |

## How Tastecraft uses Qloo

Ask a general-purpose LLM what a tapas bar in Madrid should add to its menu and you get the same answer every tapas bar gets. Tastecraft starts from **who actually goes to *this* restaurant**, as seen through Qloo's cross-domain taste graph, and only then reasons about food:

| Question an owner has | What Tastecraft asks Qloo | Endpoint |
|---|---|---|
| Is my restaurant in the graph, and how is it tagged? | Entity search (falls back to the name alone when the city words drown it) | `GET /search`, `GET /entities` |
| What else do my guests love — nearby places, music, brands, films? | Cross-domain affinity from the restaurant entity (places filtered to the city; other domains localised with a location signal) | `GET /v2/insights` (`filter.type=urn:entity:*`) |
| What does my crowd favour that the city at large doesn't? | **Crowd vs city:** the ~150 restaurants my audience loves most vs the city's ~150 most popular, compared tag by tag and menu term by menu term (lift) | `GET /v2/insights` (`filter.type=urn:entity:place`, `filter.tags=…restaurant`, with and without `signal.interests.entities`) |
| Which dishes, cuisines and vibes does my crowd lean towards? | Taste analysis on tag families (specialty dishes, menu highlights, cuisines, ambience) | `GET /v2/insights` (`filter.type=urn:tag`) |
| Who are my guests? | Age and gender over/under-indexing | `GET /v2/insights` (`filter.type=urn:demographics`) |
| How am I positioned against my closest rival? | Head-to-head of the two places: tags only one of them carries | `GET /v2/analysis/compare` |
| Where in the city does my kind of guest live and go out? | Heatmap of taste affinity by geohash, then the top distinct neighborhoods | `GET /v2/insights` (`filter.type=urn:heatmap`) |
| Which concerts nearby would my guests go to? (optional, with a Ticketmaster key) | Ranks the billed artists for this audience with Qloo's official harness (`rank` workflow) | `@qloo/qloo-harness` over `/search` + `/v2/insights` |

### Crowd lift: the score on every playbook

Qloo's tag affinity is percentile-like and saturates at the top for any audience: the top-10 dish tags average 99.2 for a restaurant's audience and 99.6 for the city overall ([eval/SUMMARY.md](eval/SUMMARY.md)). An average of affinities therefore reads ~96–100 for any plan. Crowd lift compares the audience with a baseline instead:

- **crowd** = the ~150 restaurants in the city this restaurant's audience has the highest Qloo affinity for; **city** = the city's ~150 most popular restaurants (same query, no audience signal).
- A dish name is split into the food terms local Qloo menu tags use (a multi-word term must appear on at least 3 menus; preparation, season and format words never count alone).
- Term lift = share of crowd restaurants whose menu tags mention it ÷ share of city restaurants that do, add-one smoothed (×1.0 = no difference). Dish and plan scores are geometric means.
- Computed on the server from Qloo data and the dish names, never written by the model. The same function scores the no-Qloo baseline, the benchmark ([scripts/benchmark.ts](scripts/benchmark.ts)) and the replays.

## What the owner gets

- **Crowd lift** for the plan and for each dish, with the local-menu counts behind it, next to the same score for a no-Qloo answer.
- **Audience taste DNA** — places, artists, brands and titles their guests love, with Qloo affinity scores.
- **Cravings & crowd** — the menu terms their crowd's favourite restaurants serve far more (or less) often than the city's, Qloo's cuisine and vibe leanings, and an age/gender profile.
- **Taste map** — where people with this taste live and go out, with named neighborhoods to target.
- **Head-to-head** — what only this restaurant, or only its closest rival, is known for.
- **Taste gaps** — cuisines, formats and vibes the crowd's favourite places have that the restaurant lacks.
- **Three menu moves** with price, rationale and the checked Qloo facts behind them; **an event and a playlist**; **a ready-to-post Instagram caption and collab partners**; **a supplier shopping list** (CSV and order email); **a 7-day plan**. English or Spanish, and save as PDF.

## How the agent works

```
Browser ──POST /api/agent──▶ Next.js route (streams NDJSON events)
                               │
                               ├─ Claude (claude-opus-5-5) via the Anthropic SDK tool runner
                               │    tools: find_restaurant · audience_affinity · taste_tags · audience_profile
                               │           compare_rival · taste_gaps · taste_map · nearby_shows · publish_playbook
                               │
                               ├─ each tool → Qloo hackathon API (cached server-side, ≤4 requests in flight) → compact JSON
                               │                                                                              → events for the UI
                               └─ publish → facts checked against this run's Qloo responses → crowd lift (plan + no-Qloo baseline)
```

- **The right restaurant first.** Each match is labelled exact, close or best guess, and the owner can switch to another candidate ("Not your restaurant?"). Their pick always wins over the agent's.
- **Grounding rules.** Every recommendation must cite concrete Qloo facts (names and scores exactly as returned); the server marks each one ✓ or ⚠. The final output is a schema-validated `publish_playbook` tool call, streamed so the UI drafts the playbook live; if the streamed JSON is malformed, the last step is retried once with server-validated input.
- **Honest gaps.** Tools return errors or empty data as such, and the playbook's caveats list what is missing. Place popularity trends are off because the hackathon `/v2/trending` endpoint does not accept places (set `QLOO_PLACE_TRENDS=1` if a key does).
- **Cost and abuse protection.** Live runs are rate-limited per IP, capped per day and limited in concurrency (per server instance). A run uses about US$0.35–0.45 of Claude usage (measured from token counts). If the AI key is rejected or the account runs out of credit, live runs pause with a clear message and the UI offers the recorded runs.

## Qloo data handling

- Qloo responses are cached privately on the server (6 h) and never committed. The API key is only sent from the server in the `X-Api-Key` header; it never reaches the browser, a prompt or a log.
- Recorded runs contain Qloo data, so `src/data/demos.json` is gitignored. Deployments get them as an **encrypted** file downloaded at build time from a private URL (`TASTECRAFT_DEMOS_URL`, AES-256-GCM with `TASTECRAFT_DEMOS_KEY`); without those variables the app simply runs live-only. See [scripts/pack-demos.mjs](scripts/pack-demos.mjs) and [scripts/ensure-demos.mjs](scripts/ensure-demos.mjs).
- Benchmark raw results stay in a gitignored file; [eval/SUMMARY.md](eval/SUMMARY.md) has aggregates only.
- No personal data goes to Qloo: the only signal is the restaurant itself (a public place entity), the city and an optional age/gender *bucket*.

## Known limitations: what the results do not establish

- **Affinity and lift are not demand.** They describe what people who like the restaurant tend to like, in aggregate; they do not say how many covers a dish will sell. The plan is a one-week test for that reason.
- **Qloo's audience is not the till receipt.** The audience is people whose tastes connect to the restaurant in Qloo's graph, not its actual customers.
- **Crowd lift is a proxy built on menu tags.** Dish names are matched to local menu tags by words, so creative names can match nothing (excluded from the score) or a generic word; per-term counts are often single digits. The benchmark covers 8 restaurants with one sample per arm, and its crowd-vs-city arm sees the same contrast it is scored on ([details](eval/SUMMARY.md)).
- **The head-to-head describes positioning, not audiences.** With one place per side, Qloo's compare endpoint returns each place's own tags; Tastecraft shows the ones only one place carries and no score.
- **Coverage varies.** Small or new restaurants may be missing or thin in the graph, menu tags are richer in some cities than others, and a city name can resolve broadly (for example "New York" to the state).
- **The interpretation can be wrong.** Verification checks every cited name and score against Qloo's responses, not the reasoning built on them.
- **Estimates are estimates.** Prices, quantities and costs in the shopping list are realistic estimates, not supplier quotes. Neighbourhood names come from OpenStreetMap and can be approximate.
- **Live events depend on Ticketmaster.** Only listed events appear, and some leagues are not sold there (for example, Spanish football).
- **Run time.** A live run takes about 2 minutes (measured on a local production build; 5 runs, 102–178 s); hosting can add latency.

## Use it from any agent (MCP)

Tastecraft is also an MCP server, so an existing agent — Claude Desktop, Cursor, or a restaurant's own POS assistant — can call it:

```json
{ "tastecraft": { "url": "https://<deployment>/api/mcp" } }
```

| Tool | What it returns | Cost |
|---|---|---|
| `taste_profile` | The restaurant's Qloo entity, places/artists/brands its guests love (0-100 affinity), dishes/cuisines/vibes they lean towards, age/gender skew | Qloo only, seconds |
| `taste_playbook` | The full verified playbook (same as the web app) | Qloo + Claude, about 2 minutes, rate-limited |

## Run it locally

Requires Node.js 22 or newer.

```bash
git clone <this repo> && cd tastecraft
npm install
```

| Mode | Command | Needs |
|---|---|---|
| UI only, replaying a synthetic run | `npm run dev:fixture` | nothing |
| The real agent against a synthetic Qloo API | `npm run dev:mock` | `ANTHROPIC_API_KEY` in `.env.local` |
| Live | `npm run dev` | `ANTHROPIC_API_KEY` and `QLOO_API_KEY` in `.env.local` |

Then open http://localhost:3000. For the live mode, copy the example file and add your keys (`cp .env.example .env.local`):

```
ANTHROPIC_API_KEY=...        # Claude API key
QLOO_API_KEY=...             # Qloo hackathon key
QLOO_BASE_URL=https://hackathon.api.qloo.com
# optional
TASTECRAFT_MODEL=claude-opus-5-5
LIVE_RUNS_DAILY_CAP=8        # live runs per server instance per day
LIVE_RUNS_PER_IP_PER_HOUR=3
LIVE_RUNS_MAX_CONCURRENT=2
LIVE_RUNS_DISABLED=1         # replay-only mode
TICKETMASTER_API_KEY=...     # concerts by your guests' favourite artists + game days nearby
TASTECRAFT_DEMOS_URL=...     # encrypted recorded runs for a deployment (see below)
TASTECRAFT_DEMOS_KEY=...
```

Checks and evaluation:

```bash
npm test                  # unit tests (no keys, no network)
npm run benchmark         # with/without-Qloo benchmark -> eval/SUMMARY.md (needs both keys; ~24 short model calls)
npm run benchmark -- --rescore   # rescore the saved dishes with the current formula, no model calls
```

Recorded runs for instant replays (stored locally, never committed):

```bash
npm run record-demo -- "Casa Lucio" "Madrid" "Launch a new seasonal special" http://localhost:3000
npm run rescore-demos     # recompute the server-derived crowd-lift fields with the current formula (Qloo only)
npm run pack-demos        # encrypt them to .demos/demos.enc.txt with the key in .demos/KEY (both gitignored)
```

To serve them from a deployment, upload `.demos/demos.enc.txt` to a private-by-URL location (for example `gh gist create .demos/demos.enc.txt`, which makes a secret gist) and set `TASTECRAFT_DEMOS_URL` to its raw link and `TASTECRAFT_DEMOS_KEY` to the content of `.demos/KEY`.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Anthropic TypeScript SDK (tool runner, adaptive thinking) · Zod · Leaflet + OpenStreetMap · ngeohash · Qloo official harness.

## Who built it

Antonio González Fernández — Business Administration + Data Science student (CUNEF, Madrid). Tastecraft grows out of building [Supplora](https://www.supplora.app), an AI tool a family-run restaurant in Spain uses to read supplier delivery notes and load them into its management system. Talking to restaurant owners made the gap obvious: they have the purchasing data, but no way to know what their own guests actually want.

## License

MIT — see [LICENSE](LICENSE).
