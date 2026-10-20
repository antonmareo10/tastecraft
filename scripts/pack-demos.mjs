// Encrypts the local recorded runs (src/data/demos.json) for a deployment, without ever putting
// readable Qloo data in the public repository.
//
//   node scripts/pack-demos.mjs
//
// Writes .demos/demos.enc.txt (ciphertext) and, the first time, .demos/KEY (a new random key).
// Both are gitignored. Then:
//   1. Upload .demos/demos.enc.txt somewhere private-by-URL, e.g. a secret gist:
//        gh gist create .demos/demos.enc.txt          (gists are secret unless --public)
//      and take its raw link: https://gist.githubusercontent.com/<user>/<gist id>/raw/demos.enc.txt
//   2. In the deployment's environment set TASTECRAFT_DEMOS_URL to that link and
//      TASTECRAFT_DEMOS_KEY to the content of .demos/KEY, then redeploy.
// The build (scripts/ensure-demos.mjs) downloads and decrypts it; the data lives only on the server.
import fs from "node:fs";
import { decryptDemos, encryptDemos, newKey } from "./demos-crypto.mjs";

const src = new URL("../src/data/demos.json", import.meta.url);
const dir = new URL("../.demos/", import.meta.url);
const keyFile = new URL("KEY", dir);
const out = new URL("demos.enc.txt", dir);

const demos = JSON.parse(fs.readFileSync(src, "utf8"));
if (!Array.isArray(demos) || demos.length === 0) {
  console.error("src/data/demos.json has no recorded runs. Record some first: npm run record-demo -- ...");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
let key = process.env.TASTECRAFT_DEMOS_KEY?.trim() || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "");
if (!key) {
  key = newKey();
  fs.writeFileSync(keyFile, key + "\n");
  console.log("New key written to .demos/KEY (keep it secret; it goes into TASTECRAFT_DEMOS_KEY).");
}
const text = encryptDemos(JSON.stringify(demos), key);
decryptDemos(text, key); // round-trip check before anything leaves this machine
fs.writeFileSync(out, text + "\n");
console.log(`Encrypted ${demos.length} recorded runs (${demos.map((d) => d.slug).join(", ")}) -> .demos/demos.enc.txt (${(text.length / 1024).toFixed(0)} KB).`);
