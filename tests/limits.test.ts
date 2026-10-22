import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

// Fresh module state (counters, pause) per test.
async function load() {
  vi.resetModules();
  return import("@/lib/limits");
}

afterEach(() => {
  delete process.env.LIVE_RUNS_DISABLED;
  delete process.env.LIVE_RUNS_DAILY_CAP;
});

describe("live-run gate", () => {
  it("enforces the daily cap", async () => {
    process.env.LIVE_RUNS_DAILY_CAP = "2";
    const { acquireLiveRun } = await load();
    const a = acquireLiveRun("1.1.1.1");
    const b = acquireLiveRun("2.2.2.2");
    expect(a.ok && b.ok).toBe(true);
    const c = acquireLiveRun("3.3.3.3");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toMatch(/budget/);
  });

  it("can be switched off for the whole demo", async () => {
    process.env.LIVE_RUNS_DISABLED = "1";
    const { acquireLiveRun } = await load();
    expect(acquireLiveRun("1.1.1.1").ok).toBe(false);
  });

  it("pauses live runs when the account is out of credit, but not on a rate limit", async () => {
    const { acquireLiveRun, describeLiveFailure, liveRunsDisabled } = await load();
    const limited = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    expect(describeLiveFailure(limited)).toMatch(/rate-limiting/);
    expect(liveRunsDisabled()).toBeNull();
    const broke = new Anthropic.BadRequestError(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
      "Your credit balance is too low to access the Anthropic API.",
      new Headers(),
    );
    expect(describeLiveFailure(broke)).toMatch(/budget is used up/);
    expect(liveRunsDisabled()).toMatch(/paused/);
    expect(acquireLiveRun("9.9.9.9").ok).toBe(false);
  });

  it("rate-limits cheap calls per key within a sliding window", async () => {
    const { allowCall } = await load();
    const t = 1_000_000;
    expect([1, 2, 3].map(() => allowCall("profile:1.1.1.1", 2, 3_600_000, t))).toEqual([true, true, false]);
    expect(allowCall("profile:2.2.2.2", 2, 3_600_000, t)).toBe(true); // other callers are unaffected
    expect(allowCall("profile:1.1.1.1", 2, 3_600_000, t + 3_600_001)).toBe(true); // the window slides
  });

  it("pauses on a rejected key", async () => {
    const { describeLiveFailure, liveRunsDisabled } = await load();
    const denied = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    expect(describeLiveFailure(denied)).toMatch(/key/);
    expect(liveRunsDisabled()).toMatch(/paused/);
  });

  it("pauses live runs when Qloo rejects the key (e.g. the hackathon key expired), with a plain message", async () => {
    const { describeLiveFailure, liveRunsDisabled, acquireLiveRun } = await load();
    const { QlooError } = await import("@/lib/qloo");
    const expired = new QlooError(401, "Qloo rejected the API key (401). Check QLOO_API_KEY; retrying will not help.", "QLOO_AUTH");
    const msg = describeLiveFailure(expired);
    expect(msg).toMatch(/^Live runs are paused/); // the UI turns "paused" into the "watch a recorded run" state
    expect(msg).not.toMatch(/QLOO_API_KEY/); // no server internals in front of a judge
    expect(liveRunsDisabled()).toMatch(/paused/);
    expect(acquireLiveRun("8.8.8.8").ok).toBe(false); // the next visitor goes straight to the replays
  });

  it("does not pause on a Qloo rate limit, which is temporary", async () => {
    const { describeLiveFailure, liveRunsDisabled } = await load();
    const { QlooError } = await import("@/lib/qloo");
    const busy = new QlooError(429, "Qloo rate limit reached (429). Wait a minute before trying again.", "QLOO_RATE_LIMIT", true);
    expect(describeLiveFailure(busy)).toMatch(/rate limit/);
    expect(liveRunsDisabled()).toBeNull();
  });
});
