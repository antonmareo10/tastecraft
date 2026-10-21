// Recorded REAL agent runs (Qloo + Claude), replayed instantly so judges don't wait.
// Produced by `npm run record-demo` against the live agent; never hand-written. The JSON holds
// Qloo data, so it is gitignored: deployments download an encrypted copy at build time
// (scripts/ensure-demos.mjs, TASTECRAFT_DEMOS_URL + TASTECRAFT_DEMOS_KEY) and keep it server-side.
import { withMenuDenominators } from "@/lib/recordings";
import type { AgentEvent, AgentRequest } from "@/lib/types";

export type RecordedEvent = AgentEvent & { t: number }; // ms since the run started
export type Demo = AgentRequest & { slug: string; recordedAt: string; events: RecordedEvent[] };

// Populated by the recorder (see scripts/record-demo.mjs).
import recorded from "./demos.json";

// Older recordings are brought in line with the current agent's events (src/lib/recordings.ts).
export const DEMOS: Demo[] = (recorded as Demo[]).map((d) => ({ ...d, events: withMenuDenominators(d.events) }));

export function demoSummaries() {
  return DEMOS.map(({ slug, restaurant, city, goal, recordedAt }) => ({ slug, restaurant, city, goal, recordedAt }));
}
