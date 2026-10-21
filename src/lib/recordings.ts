// Fixes applied when recorded runs are loaded, so older recordings show what the current agent would.
// Pure (no I/O), so it is tested on synthetic events.

import { smoothedLift } from "./lift";
import type { AgentEvent } from "./types";

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Recordings made before 21 Oct 2026 sent the crowd_menu event with the size of each whole Qloo set
 * (150 / 150), although its counts and lifts are over the restaurants with menu data (e.g. 145 / 139),
 * which the playbook's crowd lift reports. This gives the event the playbook's denominators, but only
 * when every listed lift recomputes exactly from them; otherwise the event is left as recorded.
 */
export function withMenuDenominators<E extends AgentEvent>(events: readonly E[]): E[] {
  const playbook = events.find((e) => e.type === "playbook") as Extract<AgentEvent, { type: "playbook" }> | undefined;
  const cl = playbook?.playbook.crowd_lift;
  if (!cl?.crowd_n || !cl.city_n) return [...events];
  const { crowd_n, city_n } = cl;
  return events.map((e) => {
    if (e.type !== "crowd_menu") return e;
    const menu = e as Extract<AgentEvent, { type: "crowd_menu" }>;
    if (menu.crowd_n === crowd_n && menu.city_n === city_n) return e;
    const rows = [...menu.favours, ...menu.avoids];
    const fits = rows.length > 0 && rows.every((t) => Math.abs(round2(smoothedLift(t.crowd, crowd_n, t.city, city_n)) - t.lift) < 0.006);
    return fits ? ({ ...e, crowd_n, city_n } as E) : e;
  });
}
