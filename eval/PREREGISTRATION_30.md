# Pre-registration: the held-out check on 30 restaurants

Written by Antón González Fernández before running anything. The git history of this file is the proof of order: the candidate list and the selection rule were committed before any Qloo call for them, and the final list, metrics and decision rule were committed before any model call.

## Why

The held-out check in eval/SUMMARY.md (scripts/benchmark-holdout.ts, run on 2026-10-21) found that Qloo's crowd-vs-city contrast, computed on one half of each restaurant set, makes the same model's dishes score ×1.27 higher on the other half than the model alone (95% bootstrap interval ×1.07 to ×1.48), better in 6 of 8 restaurants. Eight restaurants is a small sample, and the scoring rules were written while looking at those eight. This run repeats the same protocol on 22 restaurants that played no part in building Tastecraft, plus the original 8 again, and publishes the result whatever it is.

## Part 1: candidates and how the 22 are picked (fixed before any Qloo call for them)

The ordered candidate list is eval/heldout30.candidates.json (36 restaurants, chosen to spread over cities, countries, cuisines and price levels). Candidates are taken in that order, and the first 22 that pass the screen below form the new set. The rest are not used.

A candidate passes when:

1. its name does not appear in the development material: the restaurants the scoring was built and tested on (eval/restaurants.json, scripts/bench-common.ts), the recorded runs (src/data/demos.json, including every place named in them), docs and tests;
2. Qloo search, through the app's own resolver, matches it by name (exact or close) to a place in the named city (a local-language city name in the address, such as Ciudad de México, counts); and
3. the city query used for the crowd and city sets, with the city written as in the candidate list, returns restaurants in that city (checked on its 5 most popular places).

The screen is `npm run eval:heldout:screen` (scripts/heldout30-screen.ts). It makes no model call, fetches no crowd set and computes no crowd lift, so it cannot see any result. Goals are assigned in list order, cycling through the four goals the original benchmark used: Fill quiet weeknights, Launch a new seasonal special, Win a younger crowd, Grow delivery orders.
