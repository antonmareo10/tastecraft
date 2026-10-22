import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The recorded runs are downloaded at build time. If that download fails, a production build must stop
// (Vercel then keeps the live deployment and its replays) instead of shipping a demo without replays.
function run(env: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-demos-"));
  const file = path.join(dir, "demos.json");
  const res = spawnSync(process.execPath, ["scripts/ensure-demos.mjs"], {
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      TASTECRAFT_DEMOS_FILE: file,
      TASTECRAFT_DEMOS_URL: "http://127.0.0.1:9/demos.enc", // nothing listens on port 9: the download fails fast
      TASTECRAFT_DEMOS_KEY: "test-key",
      ...env,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  const written = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: res.status, written, stderr: res.stderr };
}

describe("ensure-demos at build time", () => {
  it("stops a Vercel production build when the recorded runs can't be downloaded", () => {
    const r = run({ VERCEL: "1", VERCEL_ENV: "production" });
    expect(r.status).toBe(1);
    expect(r.written).toBeNull();
    expect(r.stderr).toMatch(/keeps its replays/);
    expect(r.stderr).not.toMatch(/127\.0\.0\.1|test-key/); // never print the URL or the key
  }, 30_000);

  it("keeps local and preview builds going without replays", () => {
    const r = run({ VERCEL: "1", VERCEL_ENV: "preview" });
    expect(r.status).toBe(0);
    expect(r.written?.trim()).toBe("[]");
  }, 30_000);
});
