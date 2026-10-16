// Creates an empty src/data/demos.json when missing (the real file holds Qloo data and is gitignored).
import fs from "node:fs";
const file = new URL("../src/data/demos.json", import.meta.url);
if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n");
