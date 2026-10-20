import { describe, expect, it } from "vitest";
import { decryptDemos, encryptDemos, newKey } from "../scripts/demos-crypto.mjs";

const demos = [{ slug: "a-b", restaurant: "A", city: "B", recordedAt: "2026-10-20", events: [{ type: "done", elapsed_ms: 1, t: 1 }] }];

describe("recorded-runs encryption", () => {
  it("round-trips with the right key and hides the content", () => {
    const key = newKey();
    const text = encryptDemos(JSON.stringify(demos), key);
    expect(text.startsWith("tcdemo1.")).toBe(true);
    expect(text).not.toContain("a-b");
    expect(decryptDemos(text, key)).toEqual(demos);
  });

  it("rejects a wrong key and a tampered file", () => {
    const text = encryptDemos(JSON.stringify(demos), newKey());
    expect(() => decryptDemos(text, newKey())).toThrow();
    const key = newKey();
    const ok = encryptDemos(JSON.stringify(demos), key);
    const parts = ok.split(".");
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    expect(() => decryptDemos(parts.join("."), key)).toThrow();
  });

  it("refuses malformed keys and files", () => {
    expect(() => encryptDemos("[]", "short")).toThrow(/32 bytes/);
    expect(() => decryptDemos("hello", newKey())).toThrow(/Not a Tastecraft/);
  });
});
