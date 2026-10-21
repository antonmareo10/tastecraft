import { describe, expect, it } from "vitest";
import { createReveals, isScrollKey, revealStart, STILL, WAIT, type RevealEnv, type RevealOptions, type RevealTarget } from "@/lib/reveal";

const VIEWPORT = 800;
const OPTS: RevealOptions = { amount: 0.15, margin: "0px" };

/** An element whose position the test moves, with the attributes the controller sets. */
function block(top: number, height = 200) {
  const attrs = new Map<string, string>();
  const el = {
    top,
    getBoundingClientRect: () => ({ top: el.top, bottom: el.top + height }),
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
    has: (n: string) => attrs.has(n),
  };
  return el;
}

/** A browser stand-in: the test decides when the person scrolls and when a block comes into view. */
function fakeEnv({ motion = true } = {}) {
  const watching = new Map<RevealTarget, () => void>();
  let intent: (() => void) | null = null;
  let listeners = 0;
  const env: RevealEnv = {
    viewport: () => VIEWPORT,
    motion: () => motion,
    whenInView(el, _opts, onEnter) {
      watching.set(el, onEnter);
      return () => watching.delete(el);
    },
    onScrollIntent(onIntent) {
      intent = onIntent;
      listeners++;
      return () => {
        intent = null;
        listeners--;
      };
    },
  };
  return {
    env,
    scrollIntent: () => intent?.(),
    enterView(el: RevealTarget) {
      const cb = watching.get(el);
      watching.delete(el);
      cb?.();
    },
    isWatching: (el: RevealTarget) => watching.has(el),
    listeners: () => listeners,
  };
}

describe("revealStart", () => {
  it("keeps everything still without motion (reduced motion, automated browsers)", () => {
    expect(revealStart({ top: 2000, bottom: 2200 }, VIEWPORT, false, true)).toBe("still");
    expect(revealStart({ top: 10, bottom: 200 }, VIEWPORT, false, false)).toBe("still");
  });

  it("shows blocks on screen or above it", () => {
    expect(revealStart({ top: 100, bottom: 300 }, VIEWPORT, true, false)).toBe("shown");
    expect(revealStart({ top: 790, bottom: 990 }, VIEWPORT, true, true)).toBe("shown");
    expect(revealStart({ top: -900, bottom: -700 }, VIEWPORT, true, true)).toBe("shown");
  });

  it("leaves blocks below the fold visible until the person scrolls", () => {
    expect(revealStart({ top: 800, bottom: 1000 }, VIEWPORT, true, false)).toBe("pending");
    expect(revealStart({ top: 5000, bottom: 5200 }, VIEWPORT, true, false)).toBe("pending");
    expect(revealStart({ top: 800, bottom: 1000 }, VIEWPORT, true, true)).toBe("wait");
  });
});

describe("isScrollKey", () => {
  it("counts page-scrolling keys, but not typing in a field", () => {
    expect(isScrollKey("PageDown", false)).toBe(true);
    expect(isScrollKey(" ", false)).toBe(true);
    expect(isScrollKey("End", false)).toBe(true);
    expect(isScrollKey(" ", true)).toBe(false);
    expect(isScrollKey("ArrowDown", true)).toBe(false);
    expect(isScrollKey("g", false)).toBe(false);
    expect(isScrollKey("Tab", false)).toBe(false);
  });
});

describe("scroll reveals", () => {
  it("never hides anything in a capture that does not scroll", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    const blocks = [block(100), block(900), block(3000), block(12000)];
    blocks.forEach((b) => r.watch(b, OPTS));
    expect(blocks.some((b) => b.has(WAIT))).toBe(false);
    expect(r.armed).toBe(false);
  });

  it("marks every block still in an automated browser, and never listens for scrolls", () => {
    const f = fakeEnv({ motion: false });
    const r = createReveals(f.env);
    const blocks = [block(100), block(3000)];
    blocks.forEach((b) => r.watch(b, OPTS));
    expect(blocks.every((b) => b.has(STILL) && !b.has(WAIT))).toBe(true);
    expect(f.listeners()).toBe(0);
  });

  it("hides blocks still below the fold when the person starts scrolling, then reveals each in view", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    const onScreen = block(200);
    const near = block(1000);
    const far = block(4000);
    [onScreen, near, far].forEach((b) => r.watch(b, OPTS));
    expect(f.listeners()).toBe(1);

    f.scrollIntent();
    expect(r.armed).toBe(true);
    expect(f.listeners()).toBe(0); // armed once, then the listeners go
    expect(onScreen.has(WAIT)).toBe(false);
    expect(near.has(WAIT) && far.has(WAIT)).toBe(true);

    f.enterView(near);
    expect(near.has(WAIT)).toBe(false);
    expect(far.has(WAIT)).toBe(true);
    expect(f.isWatching(far)).toBe(true);
  });

  it("leaves a block visible if a scripted scroll brought it on screen before the person scrolled", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    const b = block(1500);
    r.watch(b, OPTS);
    b.top = 300; // the page glided down on its own (a run starting)
    f.scrollIntent();
    expect(b.has(WAIT)).toBe(false);
    expect(f.isWatching(b)).toBe(false);
  });

  it("hides a block that mounts below the fold after the person has scrolled", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    r.arm(); // e.g. the act tabs
    const b = block(2000);
    r.watch(b, OPTS);
    expect(b.has(WAIT)).toBe(true);
    const inView = block(100);
    r.watch(inView, OPTS);
    expect(inView.has(WAIT)).toBe(false);
  });

  it("forgets a block that unmounts before the person scrolls", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    const b = block(2000);
    const stop = r.watch(b, OPTS);
    stop();
    f.scrollIntent();
    expect(b.has(WAIT)).toBe(false);
    expect(f.isWatching(b)).toBe(false);
  });

  it("stops watching a waiting block that unmounts", () => {
    const f = fakeEnv();
    const r = createReveals(f.env);
    const b = block(2000);
    const stop = r.watch(b, OPTS);
    f.scrollIntent();
    expect(f.isWatching(b)).toBe(true);
    stop();
    expect(f.isWatching(b)).toBe(false);
  });
});
