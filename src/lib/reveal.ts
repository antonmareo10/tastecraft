// Scroll reveals that never hide content from a screenshot.
//
// Blocks marked for a reveal (sections, cards, act headings, bars, the taste map) are visible by
// default: in the server HTML, in print, in a full-page capture, with reduced motion and in automated
// browsers. Each one plays its short entrance when it mounts (CSS in globals.css). A block that sits
// below the fold is hidden and replayed only once the person starts scrolling (wheel, touch drag,
// scroll keys or the act tabs), and only while it is still off screen, so it rises into place as
// they reach it. A capture that never scrolls, or scrolls by script, sees every block as it is.
//
// The decisions live here, free of the DOM, so they can be tested; fx.tsx wires them to the browser.

/** The part of a DOMRect the decisions need. */
export interface Box {
  top: number;
  bottom: number;
}

/**
 * What a block does when it mounts:
 * - "still": no movement at all (reduced motion, automated browser); its mount entrance is cancelled.
 * - "shown": on screen or above it; its mount entrance (or the server HTML's first paint) is enough.
 * - "wait": below the fold after the person has started scrolling; hidden until it scrolls into view.
 * - "pending": below the fold before any scroll; stays visible, and waits only if the person scrolls.
 */
export type RevealStart = "still" | "shown" | "wait" | "pending";

export function revealStart(box: Box, viewport: number, motion: boolean, armed: boolean): RevealStart {
  if (!motion) return "still";
  if (box.top < viewport) return "shown";
  return armed ? "wait" : "pending";
}

/** Keys that scroll the page, when focus is not in a text field (where they move the caret instead). */
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " ", "Spacebar"]);

export function isScrollKey(key: string, inTextField: boolean): boolean {
  return !inTextField && SCROLL_KEYS.has(key);
}

/** IntersectionObserver options for the moment a waiting block rises: share visible and root margin. */
export interface RevealOptions {
  amount: number;
  margin: string;
}

/** The element calls the controller needs (an HTMLElement satisfies it). */
export interface RevealTarget {
  getBoundingClientRect(): Box;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The browser, as the controller sees it (a fake one in the tests). */
export interface RevealEnv {
  viewport(): number;
  /** False with reduced motion or in an automated browser. */
  motion(): boolean;
  /** Calls `onEnter` once, the first time the element is in view by `opts`; returns a function that stops watching. */
  whenInView(el: RevealTarget, opts: RevealOptions, onEnter: () => void): () => void;
  /** Calls `onIntent` when the person starts scrolling; returns a function that stops listening. */
  onScrollIntent(onIntent: () => void): () => void;
}

/** Attribute that hides a block before its entrance (CSS: [data-wait]). */
export const WAIT = "data-wait";
/** Attribute that cancels a block's mount entrance (CSS: [data-still]). */
export const STILL = "data-still";

export function createReveals(env: RevealEnv) {
  let armed = false;
  let stopIntent: (() => void) | null = null;
  // Blocks below the fold that are visible for now; each entry hides its block and starts watching it.
  const pending = new Map<RevealTarget, () => void>();

  function hideUntilInView(el: RevealTarget, opts: RevealOptions): () => void {
    el.setAttribute(WAIT, "");
    return env.whenInView(el, opts, () => el.removeAttribute(WAIT));
  }

  /** The person has started scrolling: blocks still below the fold wait for their entrance. Runs once. */
  function arm() {
    if (armed) return;
    armed = true;
    stopIntent?.();
    stopIntent = null;
    const viewport = env.viewport();
    for (const [el, hide] of pending) if (el.getBoundingClientRect().top >= viewport) hide();
    pending.clear();
  }

  /** Starts handling one block; returns the cleanup for when it unmounts. */
  function watch(el: RevealTarget, opts: RevealOptions): () => void {
    const start = revealStart(el.getBoundingClientRect(), env.viewport(), env.motion(), armed);
    if (start === "still") {
      el.setAttribute(STILL, "");
      return () => {};
    }
    if (start === "shown") return () => {};
    if (start === "wait") return hideUntilInView(el, opts);
    let stop: (() => void) | null = null;
    pending.set(el, () => {
      stop = hideUntilInView(el, opts);
    });
    stopIntent ??= env.onScrollIntent(arm);
    return () => {
      pending.delete(el);
      stop?.();
    };
  }

  return {
    watch,
    arm,
    get armed() {
      return armed;
    },
  };
}
