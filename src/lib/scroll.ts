// Scrolling helpers shared by the app. On desktop, SmoothScroll registers a Lenis instance here and
// programmatic scrolls go through it, so they glide like wheel scrolls; elsewhere (touch, reduced
// motion) they fall back to the browser.
import type Lenis from "lenis";

let lenis: Lenis | null = null;

export function setLenis(instance: Lenis | null) {
  lenis = instance;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scrolls the page so `el` sits `offset` px (plus its CSS scroll-margin-top, as Lenis does) below the top of the viewport. */
export function scrollToElement(el: HTMLElement, offset = 0) {
  if (lenis) {
    // The page may have just grown (a run starting); measure it again so the target is not clamped.
    lenis.resize();
    lenis.scrollTo(el, { offset: -offset, duration: 1.1 });
    return;
  }
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const top = el.getBoundingClientRect().top + window.scrollY - offset - margin;
  window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
