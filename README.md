# Tastecraft — the taste data team for independent restaurants

> Chains have insight teams. Independent restaurants decide their menu, their events and their marketing on gut feel.
> **Tastecraft is an AI agent that reads Qloo's taste graph around a restaurant and turns it into decisions an owner can act on this week** — three dishes to test, an event, a ready-to-post campaign aimed at the right neighborhoods, and a supplier shopping list — with the Qloo evidence behind every call.

**Live demo:** _link added at submission_ · Built for the Qloo Agentic Hackathon (2026)

---

## Why this needs Qloo (and doesn't work without it)

Ask a general-purpose LLM what a tapas bar in Madrid should add to its menu and you get the same answer every tapas bar gets. Tastecraft starts from **who actually goes to *this* restaurant** — as seen through Qloo's cross-domain taste graph — and only then reasons about food:

| Question an owner has | What Tastecraft asks Qloo | Endpoint |
|---|---|---|
| Is my restaurant in the graph, and how is it tagged? | Entity search for the place | `GET /search` |
| What else do my guests love — nearby places, music, brands, films? | Cross-domain affinity from the restaurant entity (places filtered to the city; other domains localised with a geo signal) | `GET /v2/insights` (`filter.type=urn:entity:*`) |
| Which dishes, cuisines and vibes does my crowd over-index on here? | Taste analysis on tag families (specialty dishes, menu highlights, cuisines, ambience) | `GET /v2/insights` (`filter.type=urn:tag`) |
| Who are my guests? | Age and gender over/under-indexing | `GET /v2/insights` (`filter.type=urn:demographics`) |
| What makes my crowd different from my closest rival's? | Head-to-head audience comparison | `GET /v2/analysis/compare` |
| What do locals love that I don't serve? | **Computed in Tastecraft:** tags over-represented among the ~50 local places my guests love most, weighted by Qloo affinity, minus my own tags | `GET /v2/insights` + local analysis |
| Where in the city does my kind of guest live and go out? | Heatmap of taste affinity by geohash, then the top distinct neighborhoods | `GET /v2/insights` (`filter.type=urn:heatmap`) |

The app shows a **side-by-side of the same model with and without Qloo**, so the difference is visible, not claimed.

## What the owner gets

- **A Taste-Fit score (0–100)** — one headline number for how well the plan fits this crowd, the mean Qloo affinity of the *verified* facts it's built on (and a per-dish score). Computed from Qloo's own numbers, never written by the model.
- **Audience taste DNA** — places, artists, brands and titles their guests love, with Qloo affinity scores.
- **Cravings & crowd** — dishes, cuisines and vibes the audience over-indexes on, plus an age/gender profile.
- **Taste map** — a heatmap of where people with this taste live and go out, with named neighborhoods to target.
- **Head-to-head** — what distinguishes their crowd from the closest rival.
- **Taste gaps** — what locals love that the restaurant doesn't offer yet.
- **Three menu moves** — dishes with price, rationale and the Qloo facts behind them.
- **An event and a playlist** grounded in the audience's music taste.
- **A ready-to-post Instagram caption and collab partners.**
- **A supplier shopping list** for a one-week test (CSV export and a ready-to-send order email).
- Playbook in **English or Spanish**, and **save as PDF**.

## How the agent works

```
Browser ──POST /api/agent──▶ Next.js route (streams NDJSON events)
                               │
                               ├─ Claude (claude-opus-5-5) via the Anthropic SDK tool runner
                               │    tools: find_restaurant · audience_affinity · taste_tags · audience_profile
                               │           compare_rival · taste_gaps · taste_map · publish_playbook
                               │
                               └─ each tool → Qloo hackathon API (cached server-side) → compact JSON for the model
                                                                                     → rich events for the UI
```

- **The right restaurant first.** Names are ambiguous, so each match is labelled exact, close or best guess, and the owner can switch to another candidate before relying on the results ("Not your restaurant?"). Their pick always wins over the agent's.
- **Grounding rules.** The system prompt requires every recommendation to cite concrete Qloo facts (names and affinity scores exactly as returned). The final output is a schema-validated `publish_playbook` tool call, so the UI never parses free text.
- **Visible reasoning.** Every tool call streams to an "agent log" in the UI, together with the model's short progress notes.
- **Honest gaps.** Tools return errors or empty data as such; the agent is instructed not to retry more than once and to list missing data in *caveats*.
- **Cost and abuse protection.** Live runs are rate-limited per IP, capped per day and limited in concurrency. Recorded real runs replay instantly for visitors.
- **Qloo data handling.** Responses are cached privately on the server. Recorded runs (which contain Qloo data) are **not** committed to this public repository, per the hackathon API terms.

## Use it from any agent (MCP)

Tastecraft is also an MCP server, so an existing agent — Claude Desktop, Cursor, or a restaurant's own POS assistant — can call it:

```json
{ "tastecraft": { "url": "https://<deployment>/api/mcp" } }
```

| Tool | What it returns | Cost |
|---|---|---|
| `taste_profile` | The restaurant's Qloo entity, places/artists/brands its guests love (0-100 affinity), dishes/cuisines/vibes they over-index on, age/gender skew | Qloo only, seconds |
| `taste_playbook` | The full verified playbook (same as the web app) | Qloo + Claude, ~1 min, rate-limited |

## Proof, not claims

- `npm run eval` runs an **ablation**: the same model, same restaurant and goal, with and without Qloo, judged blind with randomized order; it also reports the share of cited facts verified against live Qloo responses. Aggregate results land in `eval/SUMMARY.md`.
- `npm test` covers the evidence ledger, the Qloo client (headers, caching, errors), taste-gap scoring, heatmap decoding and hotspot selection, and the streaming protocol. CI runs type-check, lint and tests on every push.

## Responsible by design

- **No personal data goes to Qloo.** The only signal is the restaurant itself, a public place entity, plus the city and an optional age/gender *bucket* for the audience lens. Nothing about any individual guest is collected.
- **Aggregate, not individual.** Scores are presented as what people who like the restaurant tend to like, never as a prediction about one guest, and never used to infer sensitive traits.
- **Facts apart from interpretation.** Each menu move separates *Qloo evidence* (checked against this run's responses, ✓ or ⚠) from *Our read* (Tastecraft's interpretation, framed as a bet to test).
- **Human in the loop.** The owner confirms the matched restaurant, and nothing is posted, ordered or sent automatically: the post, the supplier email and the calendar are drafts the owner chooses to use.
- **Keys stay on the server.** The Qloo key is only sent from the server in the `X-Api-Key` header; it never reaches the browser, a prompt or a log. Failures are explicit (`QLOO_AUTH`, `QLOO_RATE_LIMIT`, …), with at most one retry, and a rejected key stops the run instead of producing a playbook without data.

## Known limitations: what the results do not establish

- **Affinity is not demand.** A high score means the restaurant's audience over-indexes on something; it does not say how many covers a dish will sell. The plan is a one-week test for that reason.
- **Qloo's audience is not the till receipt.** The audience is people whose tastes connect to the restaurant in Qloo's graph, not a list of its actual customers.
- **Coverage varies.** Small or new restaurants may be missing or thin in the graph, and some cities have sparser data. The agent then works at city level and says so in the caveats.
- **The interpretation can be wrong.** Verification checks every cited name and score against Qloo's responses, not the reasoning built on them.
- **Estimates are estimates.** Prices, quantities and costs in the shopping list are realistic estimates, not supplier quotes. Neighbourhood names come from OpenStreetMap and can be approximate.
- **Live events depend on Ticketmaster.** Only listed events appear, and some leagues are not sold there (for example, Spanish football).
- **The evaluation uses an LLM judge.** `npm run eval` randomises order and hides which plan used Qloo, but an LLM judge is still a proxy for an owner's opinion.

## How this submission maps to Qloo's submission guide

| Qloo kit asks for | Where it is |
|---|---|
| A short product problem statement | The top of this README and [/about](src/app/about/page.tsx) |
| The Qloo workflows used and why | [Why this needs Qloo](#why-this-needs-qloo-and-doesnt-work-without-it) |
| A redacted request-to-result explanation, with entity and tag choices | [docs/REQUEST_TO_RESULT.md](docs/REQUEST_TO_RESULT.md) |
| A demo with no credentials or personal data | The live demo and the instant replays of real runs |
| Setup another participant can run from a clean environment | [Run it locally](#run-it-locally), including a no-keys mode |
| Known limitations | [Known limitations](#known-limitations-what-the-results-do-not-establish) |

## Run it locally

Requires Node.js 22 or newer.

```bash
git clone <this repo> && cd tastecraft
npm install
```

Pick a mode:

| Mode | Command | Needs |
|---|---|---|
| UI only, replaying a synthetic run | `npm run dev:fixture` | nothing |
| The real agent against a synthetic Qloo API | `npm run dev:mock` | `ANTHROPIC_API_KEY` in `.env.local` |
| Live | `npm run dev` | `ANTHROPIC_API_KEY` and `QLOO_API_KEY` in `.env.local` |

Then open http://localhost:3000. For the live mode, copy the example file and add your keys:

```bash
cp .env.example .env.local   # add your keys
```

`.env.local`:

```
ANTHROPIC_API_KEY=...        # Claude API key
QLOO_API_KEY=...             # Qloo hackathon key
QLOO_BASE_URL=https://hackathon.api.qloo.com
# optional
TASTECRAFT_MODEL=claude-opus-5-5
LIVE_RUNS_PER_IP_PER_HOUR=4
LIVE_RUNS_DAILY_CAP=80
LIVE_RUNS_MAX_CONCURRENT=3
TICKETMASTER_API_KEY=...     # concerts by your guests' favorite artists + game days nearby
```

Record an instant replay from a real run (stored locally, not committed):

```bash
npm run record-demo -- "Casa Lucio" "Madrid" "Fill quiet weeknights" http://localhost:3000
```

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Anthropic TypeScript SDK (tool runner, adaptive thinking) · Zod · Leaflet + OpenStreetMap · ngeohash.

## Who built it

Antonio González Fernández — Business Administration + Data Science student (CUNEF, Madrid). Tastecraft grows out of building [Supplora](https://www.supplora.app), an AI tool already in daily use by a restaurant in Spain that reads supplier delivery notes and pushes them into the restaurant's ERP. Talking to restaurant owners made the gap obvious: they have the purchasing data, but no way to know what their own guests actually want.

## License

MIT — see [LICENSE](LICENSE).
