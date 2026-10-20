# Tastecraft benchmark: dishes with and without Qloo

Run on 2026-10-20 with `npm run benchmark` (scripts/benchmark.ts), model `claude-opus-5-5`. Scores recomputed on 2026-10-20 with `npm run benchmark -- --rescore` (same saved dishes, no new model calls; the full-agent column reflects the local recordings at that time). 8 of 8 restaurants completed. 24 model calls (the two Qloo-grounded arms used 32699 input and 4059 output tokens in total).

## What is measured

**Crowd lift**, the score Tastecraft shows on every playbook (src/lib/lift.ts): Qloo gives two sets of restaurants in the same city, the ~150 that this restaurant's audience has the highest affinity for (the crowd) and the city's ~150 most popular ones. Each dish name is split into the food terms local Qloo menu tags use; a term's lift is the share of crowd restaurants whose menu tags mention it divided by the share of city restaurants that do (add-one smoothed); dishes and plans use geometric means. ×1.00 = no different from the city; above 1 = this crowd's favourite places serve it more often.

Every arm is scored by the same function against the same two sets. All arms use the same model, the same effort and the app's own baseline prompt ("suggest three dishes to add and one event idea"); they differ only in the Qloo data appended to the prompt:

- **LLM only**: no Qloo data (this is the app's "Same model, no Qloo" panel).
- **+ Qloo affinity**: the audience's dish and cuisine tags and loved local places with Qloo affinity, i.e. what the earlier Taste-Fit score was built on.
- **+ Qloo crowd vs city**: the same, plus Tastecraft's crowd-vs-city contrast (the taste_gaps tool output).
- **Full agent**: the dishes of a real recorded Tastecraft playbook for that restaurant, rescored now (only where a local recording exists).

## Results

| Restaurant | Crowd / city restaurants with menu data | LLM only | + Qloo affinity | + Qloo crowd vs city | Full agent |
|---|---|---|---|---|---|
| Katz's Delicatessen, New York | 143 / 128 | ×0.57 (3/3) | ×0.88 (3/3) | ×2.33 (3/3) | ×2.94 (3/3) |
| Gjelina, Los Angeles | 145 / 139 | ×0.93 (3/3) | ×1.70 (3/3) | ×4.82 (3/3) | ×2.75 (3/3) |
| Casa Lucio, Madrid | 147 / 147 | ×0.85 (3/3) | ×0.47 (3/3) | ×3.81 (3/3) | ×3.16 (3/3) |
| Au Cheval, Chicago | 150 / 141 | ×0.78 (3/3) | ×1.10 (3/3) | ×2.04 (3/3) | — |
| Franklin Barbecue, Austin | 149 / 135 | ×0.56 (3/3) | ×1.04 (3/3) | ×1.49 (3/3) | — |
| Zuni Café, San Francisco | 149 / 145 | ×1.97 (3/3) | ×2.67 (3/3) | ×6.01 (3/3) | — |
| Dishoom, London | 150 / 116 | ×1.27 (3/3) | ×0.66 (3/3) | ×1.26 (3/3) | — |
| Mama's Fish House, Maui | 144 / 143 | ×0.93 (3/3) | ×0.84 (3/3) | ×1.28 (3/3) | — |

(matched = dishes with at least one food term on local menus, out of 3)

| Aggregate over 8 restaurants | LLM only | + Qloo affinity | + Qloo crowd vs city |
|---|---|---|---|
| Geometric mean crowd lift | ×0.91 | ×1.02 | ×2.44 |
| Median crowd lift | ×0.89 | ×0.96 | ×2.19 |
| Restaurants where it beats LLM only | — | 5 / 8 | 7 / 8 |
| Dishes matched on local menus | 24 / 24 | 24 / 24 | 24 / 24 |

Full agent (recorded playbooks, n = 3): geometric mean ×2.95; the same runs' own no-Qloo baselines: ×0.88. Recorded run times: 107 s, 98 s, 119 s.

## Why the old Taste-Fit score could not tell plans apart

For the top 10 dish tags of each audience, the mean Qloo affinity was 99.2 for the restaurant's audience and 99.6 for the city overall (no audience signal), averaged over 8 restaurants. Affinity puts what is popular everywhere near the top for almost any audience, so a mean affinity of cited facts reads ~96-100 for any plan.

## Limitations: what these results do not establish

- **Crowd lift is a proxy, not demand.** It says the crowd's favourite restaurants serve dishes like these more often than the city's most popular ones; it does not predict covers, revenue or whether guests will order the dish here.
- **Partly circular for the "crowd vs city" arm.** That arm sees the same Qloo contrast the score is computed from. Dish names are scored independently of what the model cites, so a high score still requires naming dishes the crowd's places actually serve, but the arm is expected to do well; the informative comparisons are LLM only vs + Qloo affinity, and how far a model gets without the contrast.
- **The term matcher is a heuristic.** Dish names are matched to local menu tags by words (accents, case and simple plurals folded; preparation, season and format words ignored on their own). Creative names can match nothing (excluded from the score) or match a generic word.
- **Small samples.** 8 restaurants, one sample per arm, ~150 restaurants per set; per-term counts are often single digits. Differences per restaurant are noisy; look at the aggregate.
- **Coverage varies by city.** Qloo menu tags are richer in some cities than others.
- **The full-agent column** rescores the dish names of local recordings made during development; it is only shown where one exists.

Raw per-restaurant results (dish names, term counts) contain Qloo-derived data and stay in eval/benchmark.local.json, which is not committed.
