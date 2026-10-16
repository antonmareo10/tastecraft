// Run Tastecraft locally without the live services, on any OS.
//   node scripts/dev-mode.mjs fixture   UI only: replays a synthetic run (no API keys needed)
//   node scripts/dev-mode.mjs mock      real Claude agent against a synthetic Qloo API (needs ANTHROPIC_API_KEY)
import { spawn, spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "fixture" && mode !== "mock") {
  console.error("Usage: node scripts/dev-mode.mjs <fixture|mock>");
  process.exit(1);
}

spawnSync("node", ["scripts/ensure-demos.mjs"], { stdio: "inherit" });

const children = [];
const run = (cmd, args, env) => {
  const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  children.push(child);
  child.on("exit", (code) => {
    for (const c of children) if (c !== child) c.kill();
    process.exit(code ?? 0);
  });
};

if (mode === "mock") run("node", ["scripts/mock-qloo.mjs"], {});
run("npx", ["next", "dev"], {
  ...(mode === "fixture" ? { TASTECRAFT_FIXTURE: "1" } : {}),
  QLOO_BASE_URL: "http://localhost:4010",
  QLOO_API_KEY: "mock",
  TICKETMASTER_API_KEY: "",
});

process.on("SIGINT", () => {
  for (const c of children) c.kill();
  process.exit(0);
});
