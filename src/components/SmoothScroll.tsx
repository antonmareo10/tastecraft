"use client";

import type Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";
import { setLenis } from "@/lib/scroll";

// Smooth wheel scrolling on desktop only: off on touch screens and when the visitor asks for
// reduced motion (and it switches off live if either setting changes).
export default function SmoothScroll() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;
    let disposed = false;
    const sync = async () => {
      const wanted = fine.matches && !reduce.matches;
      if (wanted && !lenis) {
        // Only desktops download it.
        const { default: LenisClass } = await import("lenis");
        if (disposed || lenis || !(fine.matches && !reduce.matches)) return;
        lenis = new LenisClass({ autoRaf: true, lerp: 0.12, allowNestedScroll: true, stopInertiaOnNavigate: true });
        setLenis(lenis);
      } else if (!wanted && lenis) {
        lenis.destroy();
        lenis = null;
        setLenis(null);
      }
    };
    sync();
    fine.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      disposed = true;
      fine.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
      lenis?.destroy();
      setLenis(null);
    };
  }, []);
  return null;
}
