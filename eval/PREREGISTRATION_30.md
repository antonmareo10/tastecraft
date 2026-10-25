# Pre-registration: the held-out check on 30 restaurants

Written by Antón González Fernández before running anything. The git history of this file is the proof of order: the candidate list and the selection rule were committed before any Qloo call for them (a7131cd), and the final list, metrics and decision rule below were committed before any model call (the commit that adds eval/heldout30.restaurants.json).

## Why

The held-out check in eval/SUMMARY.md (scripts/benchmark-holdout.ts, run on 2026-10-21) found that Qloo's crowd-vs-city contrast, computed on one half of each restaurant set, makes the same model's dishes score ×1.27 higher on the other half than the model alone (95% bootstrap interval ×1.07 to ×1.48), better in 6 of 8 restaurants. Eight restaurants is a small sample, and the scoring rules were written while looking at those eight. This run repeats the same protocol on 22 restaurants that played no part in building Tastecraft, plus the original 8 again, and publishes the result whatever it is.

## Part 1: candidates and how the 22 are picked (fixed before any Qloo call for them)

The ordered candidate list is eval/heldout30.candidates.json (36 restaurants, chosen to spread over cities, countries, cuisines and price levels). Candidates are taken in that order, and the first 22 that pass the screen below form the new set. The rest are not used.

A candidate passes when:

1. its name does not appear in the development material: the restaurants the scoring was built and tested on (eval/restaurants.json, scripts/bench-common.ts), the recorded runs (src/data/demos.json, including every place named in them), docs and tests;
2. Qloo search, through the app's own resolver, matches it by name (exact or close) to a place in the named city (a local-language city name in the address, such as Ciudad de México, counts); and
3. the city query used for the crowd and city sets, with the city written as in the candidate list, returns restaurants in that city (checked on its 5 most popular places).

The screen is `npm run eval:heldout:screen` (scripts/heldout30-screen.ts). It makes no model call, fetches no crowd set and computes no crowd lift, so it cannot see any result. Goals are assigned in list order, cycling through the four goals the original benchmark used: Fill quiet weeknights, Launch a new seasonal special, Win a younger crowd, Grow delivery orders.

## Part 2: what the screen found (2026-10-25)

Candidates 1 to 24 were needed to reach 22. Two failed:

- Ben's Chili Bowl, Washington (candidate 8): the city query "Washington" returns restaurants in Seattle (Washington State), so it fails rule 3. Per the rule, no other spelling of the city was tried.
- Roscioli, Rome (candidate 11): Qloo's only "Roscioli" is a place in Colleranesco (Teramo), not in Rome, so it fails rule 2.

No candidate appeared in the development material. Notes on the ones that passed:

- Some resolve to a branch or a longer name, as the app would resolve them: Prince's Hot Chicken Shack South, Bouillon Chartier Grands Boulevards, Lotus of Siam (Sahara Ave.), Versailles Restaurant Cuban Cuisine, Cervejaria Ramiro, Don Julio Parrilla, Hodad's Ocean Beach. Owamni resolves to "Indígena by Owamni" in Minneapolis (a close name match), which the rule accepts.
- Addresses in local-language city names count as the city: Lisboa (Lisbon), Ciudad de México (Mexico City), Cdad. Autónoma de Buenos Aires (Buenos Aires). For Sydney the 5 most popular places are in Sydney suburbs (Alexandria, Coogee, Watsons Bay), counted as Sydney.

Candidates 25 to 36 are not used.

## Part 3: the 22 new restaurants

The list the run reads is eval/heldout30.restaurants.json. In the order they run:

| # | Restaurant | City | Country | Cuisine | Price | Goal |
|---|---|---|---|---|---|---|
| 1 | Commander's Palace | New Orleans | US | Creole | $$$$ | Fill quiet weeknights |
| 2 | Contramar | Mexico City | MX | Mexican seafood | $$$ | Launch a new seasonal special |
| 3 | Prince's Hot Chicken Shack | Nashville | US | Nashville hot chicken | $ | Win a younger crowd |
| 4 | Bouillon Chartier | Paris | FR | French bouillon | $ | Grow delivery orders |
| 5 | Zahav | Philadelphia | US | Israeli | $$$ | Fill quiet weeknights |
| 6 | Lotus of Siam | Las Vegas | US | Northern Thai | $$ | Launch a new seasonal special |
| 7 | Cervejaria Ramiro | Lisbon | PT | Portuguese seafood | $$ | Win a younger crowd |
| 8 | Canlis | Seattle | US | Pacific Northwest tasting menu | $$$$ | Grow delivery orders |
| 9 | Versailles Restaurant | Miami | US | Cuban | $$ | Fill quiet weeknights |
| 10 | Neptune Oyster | Boston | US | New England seafood | $$$ | Launch a new seasonal special |
| 11 | Mr. Wong | Sydney | AU | Cantonese | $$$ | Win a younger crowd |
| 12 | The Original Ninfa's on Navigation | Houston | US | Tex-Mex | $$ | Grow delivery orders |
| 13 | Cervecería Catalana | Barcelona | ES | Catalan tapas | $$ | Fill quiet weeknights |
| 14 | Owamni | Minneapolis | US | Indigenous North American | $$$ | Launch a new seasonal special |
| 15 | Vij's | Vancouver | CA | Indian | $$$ | Win a younger crowd |
| 16 | Mary Mac's Tea Room | Atlanta | US | Southern | $$ | Grow delivery orders |
| 17 | Mustafa's Gemüse Kebap | Berlin | DE | Kebab | $ | Fill quiet weeknights |
| 18 | Buddy's Pizza | Detroit | US | Detroit-style pizza | $$ | Launch a new seasonal special |
| 19 | Don Julio | Buenos Aires | AR | Argentine parrilla | $$$ | Win a younger crowd |
| 20 | Hodad's | San Diego | US | Burgers | $ | Grow delivery orders |
| 21 | Sushi Den | Denver | US | Japanese | $$$ | Fill quiet weeknights |
| 22 | Joe Beef | Montreal | CA | Québécois | $$$ | Launch a new seasonal special |

That is 13 in the US and 9 outside it, in 22 cities none of which the original 8 used; 4 at $, 7 at $$, 9 at $$$ and 2 at $$$$. After them the run repeats the original 8 (scripts/bench-common.ts, unchanged): Katz's Delicatessen, Gjelina, Casa Lucio, Au Cheval, Franklin Barbecue, Zuni Café, Dishoom and Mama's Fish House.

## Part 4: protocol (unchanged from the 8-restaurant check)

`npm run eval:heldout` runs scripts/benchmark-holdout.ts with `--eval30`. Per restaurant:

- Qloo gives two sets in the city: the ~150 restaurants this restaurant's audience has the highest affinity for (the crowd) and the city's ~150 most popular restaurants (the city). Only restaurants with menu tags count for scoring.
- Both sets are split in two halves by a seeded hash of the Qloo entity id (scripts/holdout-split.ts), so a restaurant lands in the same half of both sets. The local places the guests love, which both Qloo arms see by name, always go to half A.
- Four arms, each one fresh call of `claude-opus-5-5` at low effort with the app's own no-Qloo prompt ("suggest three dishes to add and one event idea"); they differ only in the Qloo data appended to it:
  - LLM only: no Qloo data;
  - + Qloo affinity: the audience's dish and cuisine tags and loved local places, with affinity;
  - + crowd vs city, all places: the same plus the crowd-vs-city contrast of the full sets (it has seen half B);
  - + crowd vs city, half A only (the held-out arm): the same plus the contrast of half A only.
- Every arm's three dishes are scored on half B only with the crowd-lift formula the app shows (src/lib/lift.ts).
- 5 splits (seeds 1 to 5), one sample per arm per split: 20 model calls per restaurant.

The prompts and the scoring of English answers are the same as in the 10-21 run. The app changed after it (low-count labels, English names for Spanish playbooks, menu-data counts in the interface), but none of those changes touch the prompts these arms send or how an English dish name is scored. The original 8 get fresh model samples, so their numbers will differ from the 10-21 run by sampling alone.

## Part 5: metrics

- A restaurant's score for an arm is the geometric mean, over its 5 splits, of the plan's crowd lift on half B (a split where no dish matches a local menu is left out).
- **Primary metric:** the per-restaurant ratio of the held-out arm to LLM only, as a geometric mean over the new restaurants, with a 95% percentile bootstrap interval over restaurants (10,000 draws, fixed seed 12345: `bootstrapRatio` in scripts/holdout-split.ts).
- Secondary, all reported: the same ratio over the original 8 and over all 30; held out ÷ Qloo affinity; Qloo affinity ÷ LLM only; all places ÷ held out; the number of restaurants and of plans where the held-out arm beats LLM only, with an exact two-sided sign test over restaurants; the geometric mean and median crowd lift of every arm; dishes that matched a local menu.
- Exploratory, with no test attached: the primary ratio for the new restaurants in the US and outside it, and at $ or $$ and at $$$ or $$$$.

## Part 6: decision rule

Applied to the primary metric's 95% interval:

- above ×1 entirely: **confirmed**;
- containing ×1: **not shown** (the sample cannot tell the gain from no difference);
- below ×1 entirely: **reversed**.

What gets published: eval/HELDOUT_30.md with every number above, whatever they are, and a "Where it fails" section naming each restaurant where the held-out arm did not beat LLM only, with one line on why. The headline on the README, the site and the Devpost page becomes the lower of two ratios, the 22 new restaurants' or all 30's, with its interval and its win count, together with the decision in plain words. If the decision is "not shown" or "reversed", the site says so where it now says +27%.

## Part 7: exclusions, failures and replacements

Decided per restaurant before any model call for it:

- excluded if the app's resolver no longer finds a name match (best guess only);
- excluded if either full set has fewer than 40 restaurants with menu tags (about 20 per half), because lifts on so few menus are mostly noise.

A restaurant whose run fails on an API error is run once more (the command resumes where it stopped); if it fails again it is reported as failed. Excluded and failed restaurants are named in the report and are not replaced.

## Part 8: budget rule

The run goes in the order of Part 3, then the original 8. Before the full run, the first restaurant alone is run and its cost measured; its result is kept as part of the run, not repeated. If that cost times 30 is above US$12, restaurants are dropped, first from the end of the original 8 and then from the end of the new list (never below 20 new), until the estimate fits. The model is not switched to a cheaper one, because the check has to measure the model the product uses.

## Part 9: what may change after this commit

Nothing in the list, the prompts, the splits, the scoring or the analysis code. Allowed after the run: the hand-written "Where it fails" lines, wording of the generated report, and the README, site and Devpost text that quote the result.
