// Best-effort abuse and budget protection for the public demo (per server instance).
// Live runs call paid APIs, so we cap concurrency, per-IP rate and a daily budget, and pause live
// runs when the AI provider rejects the key or the account is out of credit, so visitors are sent
// straight to the recorded runs (offered by the UI next to every error) instead of waiting for a failure.

import Anthropic from "@anthropic-ai/sdk";

// A full playbook run costs roughly US$0.5 of Claude usage (measured, see README), so the default
// daily cap is deliberately small; raise LIVE_RUNS_DAILY_CAP when the API balance allows.
const PER_IP_PER_HOUR = Number(process.env.LIVE_RUNS_PER_IP_PER_HOUR || 3);
const DAILY_CAP = Number(process.env.LIVE_RUNS_DAILY_CAP || 8);
const MAX_CONCURRENT = Number(process.env.LIVE_RUNS_MAX_CONCURRENT || 2);
const PAUSE_MS = 30 * 60 * 1000;

const perIp = new Map<string, number[]>();
let day = new Date().toISOString().slice(0, 10);
let dailyCount = 0;
let running = 0;
let pausedUntil = 0;
let pauseReason = "";

export type Gate = { ok: true; release: () => void } | { ok: false; reason: string };

export function liveRunsDisabled(): string | null {
  if (process.env.LIVE_RUNS_DISABLED === "1") return `Live runs are switched off on this demo.`;
  if (Date.now() < pausedUntil) return pauseReason;
  return null;
}

/** Stop accepting live runs on this instance for a while (e.g. the API key was rejected or credit ran out). */
export function pauseLiveRuns(reason: string, ms = PAUSE_MS): void {
  pausedUntil = Date.now() + ms;
  pauseReason = reason;
}

export function acquireLiveRun(ip: string): Gate {
  const disabled = liveRunsDisabled();
  if (disabled) return { ok: false, reason: disabled };
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dailyCount = 0;
  }
  if (dailyCount >= DAILY_CAP) {
    return { ok: false, reason: `Today's live-run budget for this demo is used up.` };
  }
  if (running >= MAX_CONCURRENT) {
    return { ok: false, reason: `The agent is busy with other live runs. Try again in a minute.` };
  }
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    return { ok: false, reason: `You've reached the hourly limit of live runs.` };
  }
  recent.push(now);
  perIp.set(ip, recent);
  dailyCount += 1;
  running += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (!released) {
        released = true;
        running = Math.max(0, running - 1);
      }
    },
  };
}

/**
 * Turns an Anthropic API failure into an owner-friendly message. Key and credit problems also
 * pause live runs on this instance, because every following run would fail the same way.
 */
export function describeLiveFailure(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    const msg = `Live runs are paused: the AI key for this demo was rejected.`;
    pauseLiveRuns(msg);
    return msg;
  }
  if (err instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(err.message)) {
    const msg = `Live runs are paused: this demo's AI budget is used up.`;
    pauseLiveRuns(msg);
    return msg;
  }
  if (err instanceof Anthropic.RateLimitError) return `The AI provider is rate-limiting this demo. Try again in a minute.`;
  if (err instanceof Anthropic.InternalServerError) return `The AI provider is overloaded right now. Try again shortly.`;
  if (err instanceof Anthropic.APIConnectionError) return `Could not reach the AI provider. Try again shortly.`;
  return err instanceof Error ? err.message : "Unexpected error";
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || request.headers.get("x-real-ip") || "local").trim();
}

// Sliding-window counters for cheap endpoints that still spend the Qloo quota (the MCP taste_profile tool
// makes ~8 Qloo calls per request and uses no LLM, so the live-run gate above doesn't cover it).
const hits = new Map<string, number[]>();

/** True (and counted) if `key` made fewer than `max` calls in the last `windowMs`; false otherwise. */
export function allowCall(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
