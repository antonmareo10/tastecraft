import { describe, expect, it } from "vitest";
import { smoothedLift } from "@/lib/lift";
import { withMenuDenominators } from "@/lib/recordings";
import type { AgentEvent, Playbook } from "@/lib/types";

// Synthetic events: counts and lifts are invented, only their arithmetic matters.
const r2 = (x: number) => Math.round(x * 100) / 100;
const term = (name: string, crowd: number, city: number, nA: number, nB: number) => ({ term: name, crowd, city, lift: r2(smoothedLift(crowd, nA, city, nB)) });

const playbook = (crowd_n: number, city_n: number) =>
  ({ type: "playbook", playbook: { crowd_lift: { score: 2, matched: 3, total: 3, crowd_n, city_n, city: "Springfield" } } as unknown as Playbook }) as AgentEvent;

const crowdMenu = (n: [number, number], lifts: [number, number]): AgentEvent => ({
  type: "crowd_menu",
  city: "Springfield",
  crowd_n: n[0],
  city_n: n[1],
  favours: [term("Rye bread", 8, 0, ...lifts), term("Pickles", 14, 2, ...lifts)],
  avoids: [term("Milkshakes", 0, 8, ...lifts)],
});

describe("withMenuDenominators", () => {
  it("gives an old recording the menu-data denominators its lifts were computed on", () => {
    const events = [crowdMenu([150, 150], [145, 139]), playbook(145, 139)];
    const fixed = withMenuDenominators(events)[0] as Extract<AgentEvent, { type: "crowd_menu" }>;
    expect([fixed.crowd_n, fixed.city_n]).toEqual([145, 139]);
    expect(fixed.favours).toEqual((events[0] as Extract<AgentEvent, { type: "crowd_menu" }>).favours); // counts and lifts untouched
  });

  it("leaves the event alone when its lifts do not fit the playbook's sets", () => {
    const events = [crowdMenu([150, 150], [150, 150]), playbook(145, 139)];
    expect(withMenuDenominators(events)[0]).toBe(events[0]);
  });

  it("leaves recordings without a crowd-lift block or already correct as they are", () => {
    const noLift = [crowdMenu([150, 150], [145, 139])];
    expect(withMenuDenominators(noLift)).toEqual(noLift);
    const current = [crowdMenu([145, 139], [145, 139]), playbook(145, 139)];
    expect(withMenuDenominators(current)[0]).toBe(current[0]);
  });
});
