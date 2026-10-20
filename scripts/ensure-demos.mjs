// Runs before `next dev` and `next build`. Makes sure src/data/demos.json exists.
//
// The real file holds recorded runs, which contain Qloo response data, so it is never committed
// (Qloo hackathon terms). A deployment gets it by downloading an encrypted copy from
// TASTECRAFT_DEMOS_URL (any HTTPS URL, e.g. a secret gist's raw link) and decrypting it with
// TASTECRAFT_DEMOS_KEY (see scripts/pack-demos.mjs). Without them, or if anything fails, it writes
// an empty list and the app simply runs without instant replays.
//
//   node scripts/ensure-demos.mjs            keep an existing local file, otherwise download or create []
//   node scripts/ensure-demos.mjs --refresh  download again even if a local file exists
import fs from "node:fs";
import { decryptDemos } from "./demos-crypto.mjs";

const file = new URL("../src/data/demos.json", import.meta.url);
const url = process.env.TASTECRAFT_DEMOS_URL?.trim();
const key = process.env.TASTECRAFT_DEMOS_KEY?.trim();
const refresh = process.argv.includes("--refresh");

async function download() {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

if (fs.existsSync(file) && !refresh) {
  // Local development: keep the recordings made with `npm run record-demo`.
} else if (url && key) {
  try {
    const demos = decryptDemos(await download(), key);
    fs.writeFileSync(file, JSON.stringify(demos) + "\n");
    console.log(`[demos] ${demos.length} recorded runs loaded for instant replay.`);
  } catch (err) {
    // Never print the URL or the key.
    console.warn(`[demos] Could not load the encrypted recorded runs (${err instanceof Error ? err.message : err}); continuing without replays.`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n");
  }
} else if (!fs.existsSync(file)) {
  fs.writeFileSync(file, "[]\n");
  console.log("[demos] TASTECRAFT_DEMOS_URL / TASTECRAFT_DEMOS_KEY not set: no instant replays (live runs only).");
}
