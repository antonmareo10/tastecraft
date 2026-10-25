// Pre-lock feasibility screen for the 30-restaurant held-out run (eval/PREREGISTRATION_30.md).
//
//   npm run eval:heldout:screen        (needs QLOO_API_KEY; makes no model calls)
//
// For each candidate in eval/heldout30.candidates.json, in order, it checks only:
//   1. that the name does not appear in the development material (the restaurants the scoring was built
//      and tested on, the recorded runs, docs and tests), and
//   2. that Qloo search resolves the name to a place with the app's own resolver (exact or close name match),
//      and that a one-page query for the city's most popular restaurants returns places in that city.
// It fetches no crowd set, makes no model call and computes no crowd lift, so it cannot see any result.
// Output goes to the terminal only (it contains Qloo names and addresses, which are not committed).

import { execSync } from "node:child_process";
import fs from "node:fs";
import { entitiesFrom, qlooGet } from "../src/lib/qloo";
import { findRestaurant, resolveRestaurant } from "../src/lib/qloo-tasks";

type Candidate = { restaurant: string; city: string; country: string; cuisine: string; price: string };

const root = new URL("../", import.meta.url);
const candidates = JSON.parse(fs.readFileSync(new URL("eval/heldout30.candidates.json", root), "utf8")) as Candidate[];

// Development material: every tracked text file except the candidate list itself, plus the local recordings.
const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !f.startsWith("eval/heldout30.") && !f.startsWith("scripts/heldout30-") && !f.endsWith("PREREGISTRATION_30.md") && /\.(ts|tsx|mjs|js|json|md)$/.test(f) && f !== "package-lock.json");
const devText = tracked.map((f) => fs.readFileSync(new URL(f, root), "utf8")).join("\n").toLowerCase();
const demosFile = new URL("src/data/demos.json", root);
const demosNames = fs.existsSync(demosFile)
  ? new Set([...fs.readFileSync(demosFile, "utf8").matchAll(/"name":"([^"]+)"/g)].map((m) => m[1].toLowerCase()))
  : new Set<string>();

const plain = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

for (const [i, c] of candidates.entries()) {
  const n = String(i + 1).padStart(2, " ");
  const inDev = devText.includes(c.restaurant.toLowerCase()) || demosNames.has(c.restaurant.toLowerCase());
  if (inDev) {
    console.log(`${n} ${c.restaurant}, ${c.city}: EXCLUDED (appears in development material)`);
    continue;
  }
  try {
    const { selected, resolution } = resolveRestaurant(c.restaurant, c.city, await findRestaurant(c.restaurant, c.city));
    const top = entitiesFrom(
      await qlooGet("/v2/insights", { "filter.type": "urn:entity:place", "filter.location.query": c.city, "filter.tags": "urn:tag:genre:place:restaurant", take: 5 }),
    );
    const cityWord = plain(c.city.split(" ")[0]);
    const addrs = top.map((e) => String(e.properties?.address ?? ""));
    const cityHits = addrs.filter((a) => plain(a).includes(cityWord)).length;
    const ok = selected && (resolution.match === "exact" || resolution.match === "close");
    console.log(
      `${n} ${c.restaurant}, ${c.city}: ${ok ? "resolves" : "NO NAME MATCH"} (${resolution.match}${selected ? `: ${selected.name} | ${selected.subtitle ?? "no address"}` : ""}) · city query: ${cityHits}/${top.length} of the top places mention "${c.city.split(" ")[0]}" | ${addrs.slice(0, 3).join(" ; ")}`,
    );
  } catch (err) {
    console.log(`${n} ${c.restaurant}, ${c.city}: ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}
