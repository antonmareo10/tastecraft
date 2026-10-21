# Tastecraft — the taste data team for independent restaurants

> Chains have insight teams. Independent restaurants decide their menu, their events and their marketing on gut feel.
> **Tastecraft is an AI agent that reads Qloo's taste graph around a restaurant and turns it into decisions an owner can act on this week** — three dishes to test, an event, a ready-to-post campaign aimed at the right neighborhoods, and a supplier shopping list — with the Qloo evidence behind every call.

**Live demo:** **https://tastecraft-xi.vercel.app** · **Video (2:05): https://youtu.be/OrDcTB8xLvM** · Built for the Qloo Agentic Hackathon (2026), from scratch during its submission period (30 Sep – 30 Oct 2026): the repository starts from `create-next-app` on 16 Oct 2026 (`git log --reverse`).

## Judge in 60 seconds

1. Open the live demo and click **Gjelina, Los Angeles** (or any of the three) under *Instant replays of real runs*. Each is a recorded real run (Qloo + Claude), replayed in about 15 seconds.
2. Look at the **crowd lift** badge under the headline (in-sample: the agent saw the contrast it is scored on; the held-out numbers are below): how much more often the restaurants this crowd loves serve the proposed dishes than the city's ~150 most popular restaurants in Qloo, next to the same score for a quick answer from the same model *without* Qloo.
3. Scroll to **Three dishes to test**: each dish shows its lift and the local-menu counts behind it, and each evidence line is marked ✓ when every Qloo name and score it cites was returned in that run (other numbers in the text are not checked).
4. **Generic AI vs. Tastecraft** scores both answers with the same formula. **Cravings** shows what is specific to this crowd ("On your crowd's menus" vs the city), and **Head-to-head** shows what only this restaurant, or only its closest rival, is known for.
5. Want it live? Type any restaurant and city. A live run takes about **2 minutes** (median 128 s over 5 runs, 102–178 s) and live runs are capped per day; replays are always instant.

The numbers behind the claim are in **[eval/SUMMARY.md](eval/SUMMARY.md)**. On 8 restaurants in 8 cities, scored on restaurants the model never saw (a held-out half of each Qloo restaurant set, 5 random splits), the same model's dishes score **×0.90** crowd lift on their own, **×1.00** when given Qloo affinity data, and **×1.15** with Tastecraft's crowd-vs-city contrast computed on the other half: ×1.27 the model alone per restaurant (95% bootstrap interval ×1.07–×1.48), better in 6 of 8 restaurants and 29 of 40 plans, but not distinguishable from affinity data alone with this sample. Scored in-sample, where the model also sees the contrast its dishes are scored on, the same comparison reads ×0.91 / ×1.02 / ×2.44, and recorded full-agent playbooks score ×2.95 vs ×0.88 for their own no-Qloo answers (n = 3); the held-out check shows that most of that larger gap comes from seeing the scored restaurants.

## How this maps to the judging criteria

| Criterion | Where to look |
|---|---|
| **Technological implementation** (how thoroughly and skillfully Qloo is used) | Eight Qloo workflows ([below](#how-tastecraft-uses-qloo)): seven over `/search`, `/entities`, `/v2/insights` (entity, tag, demographics and heatmap outputs) and `/v2/analysis/compare`, and concert ranking through Qloo's official qloo-harness `rank` workflow; a crowd-vs-city contrast built from two Qloo queries that separates what a crowd favours from what is popular everywhere ([src/lib/lift.ts](src/lib/lift.ts)); every cited Qloo name and score checked against the run's own Qloo responses ([src/lib/ledger.ts](src/lib/ledger.ts)); bounded retries and request smoothing like Qloo's official client; unit tests that need no keys or network, and CI. |
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

- **crowd** = the ~150 restaurants in the city this restaurant's audience has the highest Qloo affinity for; **city** = the city's ~150 most popular restaurants (same query, no audience signal). Only restaurants with menu tags in Qloo count (in Los Angeles, for example, 145 of the crowd's and 139 of the city's); the playbook shows both counts.
- A dish name is split into the food terms local Qloo menu tags use (a multi-word term must appear on at least 3 menus; preparation, season and format words never count alone).
- Term lift = share of crowd restaurants whose menu tags mention it ÷ share of city restaurants that do, add-one smoothed (×1.0 = no difference). Dish and plan scores are geometric means.
- Computed on the server from Qloo data and the dish names, never written by the model. The same function scores the no-Qloo baseline, the benchmark ([scripts/benchmark.ts](scripts/benchmark.ts)) and the replays.

## What the owner gets

- **Crowd lift** for the plan and for each dish, with the local-menu counts behind it, next to the same score for a quick no-Qloo answer from the same model (one low-effort call capped at 90 words; the benchmark compares at equal effort).
- **Audience taste DNA** — places, artists, brands and titles their guests love, with Qloo affinity scores.
- **Cravings & crowd** — the menu terms their crowd's favourite restaurants serve far more (or less) often than the city's, Qloo's cuisine and vibe leanings, and an age/gender profile.
- **Taste map** — where people with this taste live and go out, with named neighborhoods to target.
- **Head-to-head** — what only this restaurant, or only its closest rival, is known for.
- **Taste gaps** — cuisines, formats and vibes the crowd's favourite places have that the restaurant lacks.
- **Three menu moves** with price, rationale and the Qloo evidence behind them (cited names and scores checked); **an event and a playlist**; **a ready-to-post Instagram caption and collab partners**; **a supplier shopping list** (CSV and order email); **a 7-day plan**. English or Spanish, and save as PDF.

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
                               └─ publish → cited names and scores checked against this run's Qloo responses → crowd lift (plan + no-Qloo baseline)
```

- **The right restaurant first.** Each match is labelled exact, close or best guess, and the owner can switch to another candidate ("Not your restaurant?"). Their pick always wins over the agent's.
- **Grounding rules.** Every recommendation must cite concrete Qloo facts (names and scores exactly as returned); the server marks each evidence line ✓ when every cited name was returned in the run and every cited score is within 1 of a number Qloo returned for that name, ⚠ otherwise. Other numbers in the prose, such as menu shares, are not checked. The final output is a schema-validated `publish_playbook` tool call, streamed so the UI drafts the playbook live; if the streamed JSON is malformed, the last step is retried once with server-validated input.
- **Honest gaps.** Tools return errors or empty data as such, and the playbook's caveats list what is missing. Place popularity trends are off because the hackathon `/v2/trending` endpoint does not accept places (set `QLOO_PLACE_TRENDS=1` if a key does).
- **Cost and abuse protection.** Live runs are rate-limited per IP, capped per day and limited in concurrency (per server instance). A run uses about US$0.3–0.4 of Claude usage at Claude Opus 5.5 list prices (token counts of two logged runs: 82–93k input tokens, mostly cache reads, and 8.7–9.2k output tokens). If the AI key is rejected or the account runs out of credit, live runs pause with a clear message and the UI offers the recorded runs.

## Qloo data handling

- Qloo responses are cached privately on the server (6 h) and never committed. The API key is only sent from the server in the `X-Api-Key` header; it never reaches the browser, a prompt or a log.
- Recorded runs contain Qloo data, so `src/data/demos.json` is gitignored. Deployments get them as an **encrypted** file downloaded at build time from a private URL (`TASTECRAFT_DEMOS_URL`, AES-256-GCM with `TASTECRAFT_DEMOS_KEY`); without those variables the app simply runs live-only. See [scripts/pack-demos.mjs](scripts/pack-demos.mjs) and [scripts/ensure-demos.mjs](scripts/ensure-demos.mjs).
- Benchmark raw results stay in a gitignored file; [eval/SUMMARY.md](eval/SUMMARY.md) has aggregates only.
- No personal data goes to Qloo: the only signal is the restaurant itself (a public place entity), the city and an optional age/gender *bucket*.

## Known limitations: what the results do not establish

- **Affinity and lift are not demand.** They describe what people who like the restaurant tend to like, in aggregate; they do not say how many covers a dish will sell. The plan is a one-week test for that reason.
- **Qloo's audience is not the till receipt.** The audience is people whose tastes connect to the restaurant in Qloo's graph, not its actual customers.
- **Crowd lift is a proxy built on menu tags.** Dish names are matched to local menu tags by words, so creative names can match nothing (excluded from the score) or a generic word; per-term counts are often single digits. The benchmark covers 8 restaurants. Its in-sample crowd-vs-city arm sees the same contrast it is scored on; on held-out restaurants the gain shrinks from ×2.44 vs ×0.91 to ×1.15 vs ×0.90 and cannot be told apart from Qloo affinity data alone ([details](eval/SUMMARY.md)).
- **The head-to-head describes positioning, not audiences.** With one place per side, Qloo's compare endpoint returns each place's own tags; Tastecraft shows the ones only one place carries and no score.
- **Coverage varies.** Small or new restaurants may be missing or thin in the graph, menu tags are richer in some cities than others, and a city name can resolve broadly (for example "New York" to the state).
- **The interpretation can be wrong.** Verification checks every cited name and score against Qloo's responses, not the reasoning built on them.
- **Estimates are estimates.** Prices, quantities and costs in the shopping list are realistic estimates, not supplier quotes. Neighborhood names come from OpenStreetMap and can be approximate.
- **Live events depend on Ticketmaster.** Only listed events appear, and some leagues are not sold there (for example, Spanish football).
- **Run time.** A live run takes about 2 minutes (measured on a local production build; 5 runs, 102–178 s); hosting can add latency.

## Use it from any agent (MCP)

Tastecraft is also an MCP server, so an existing agent — Claude Desktop, Cursor, or a restaurant's own POS assistant — can call it:

```json
{ "tastecraft": { "url": "https://tastecraft-xi.vercel.app/api/mcp" } }
```

| Tool | What it returns | Cost |
|---|---|---|
| `taste_profile` | The restaurant's Qloo entity, places/artists/brands its guests love (0-100 affinity), dishes/cuisines/vibes they lean towards, age/gender skew | Qloo only, seconds |
| `taste_playbook` | The full verified playbook (same as the web app) | Qloo + Claude, about 2 minutes, rate-limited |

## Run it locally

Requires Node.js 22 or newer.

```bash
git clone https://github.com/antonmareo10/tastecraft.git && cd tastecraft
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
npm run benchmark:holdout # held-out check: contrast from one half of each Qloo set, scored on the other (160 short model calls, ~US$2)
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
